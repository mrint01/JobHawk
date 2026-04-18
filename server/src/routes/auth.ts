/**
 * Platform authentication routes.
 *
 * Modes:
 * - AUTH_MANUAL_CONNECT=true  -> current dev behavior (visible browser window)
 * - AUTH_MANUAL_CONNECT=false -> headless credential mode
 *
 * In headless mode:
 * - StepStone / Xing use { email, password }
 * - LinkedIn tries { email, password }; if the post-login URL is not /feed,
 *   responds with requiresLinkedInCookie=true so the UI can ask for li_at token.
 */
import fs from 'fs'
import path from 'path'
import { Router, type Request, type Response } from 'express'
import type { Page, Protocol } from 'puppeteer'
import { getAuthBrowserPage, getBrowserPage, sleep } from '../utils/browser'
import { saveSession, clearSession, allSessions } from '../utils/sessions'
import {
  readLinkedInSessionFile,
  writeLinkedInSessionFile,
  isLinkedInSessionExpired,
} from '../utils/linkedinSession'

const router = Router()
const MANUAL_LOGIN_WAIT_MS = 10 * 60 * 1000
const activeConnectLocks = new Set<'linkedin' | 'stepstone' | 'xing'>()

const manualFlag = process.env.AUTH_MANUAL_CONNECT
export const AUTH_MODE: 'manual' | 'headless' =
  manualFlag === 'true' || (manualFlag !== 'false' && process.env.NODE_ENV !== 'production')
    ? 'manual'
    : 'headless'

type PlatformId = 'linkedin' | 'stepstone' | 'xing'
type ManualLoginOutcome = 'success' | 'closed' | 'timeout'
type ConnectBody = { email?: unknown; password?: unknown; token?: unknown }

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseCredentials(body: ConnectBody): { email: string; password: string } | null {
  const email = asString(body.email)
  const password = asString(body.password)
  if (!email || !password) return null
  return { email, password }
}


async function typeIntoFirstAvailableSelector(
  page: Page,
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const selector of selectors) {
    const handle = await page.$(selector).catch(() => null)
    if (!handle) continue
    await page.click(selector, { clickCount: 3 }).catch(() => undefined)
    await page.type(selector, value, { delay: 45 }).catch(() => undefined)
    return true
  }
  return false
}

async function clickFirstAvailableSelector(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const handle = await page.$(selector).catch(() => null)
    if (!handle) continue
    const clicked = await page.click(selector).then(() => true).catch(async () => {
      // Fallback when overlays block normal pointer click.
      return page.$eval(selector, (el) => {
        const target = el as HTMLElement
        target.click()
      }).then(() => true).catch(() => false)
    })
    if (clicked) return true
  }
  return false
}

async function clickTextMatchInPage(page: Page, includeWords: string[], excludeWords: string[] = []): Promise<boolean> {
  return page.evaluate(
    ({ includeWords, excludeWords }) => {
      const nodes = Array.from(
        document.querySelectorAll('button, [role="button"], a, input[type="submit"], div, span'),
      ) as HTMLElement[]

      for (const node of nodes) {
        const text = (node.innerText || node.textContent || '').trim().toLowerCase()
        if (!text) continue
        if (excludeWords.some((w) => text.includes(w))) continue
        if (!includeWords.some((w) => text.includes(w))) continue

        const style = window.getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue

        node.click()
        return true
      }
      return false
    },
    { includeWords, excludeWords },
  ).catch(() => false)
}

async function clickFirstAvailableSelectorInAnyFrame(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const handle = await page.$(selector).catch(() => null)
    if (handle) {
      const clicked = await page.click(selector).then(() => true).catch(async () => {
        return page.$eval(selector, (el) => {
          const target = el as HTMLElement
          target.click()
        }).then(() => true).catch(() => false)
      })
      if (clicked) return true
    }
  }

  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const handle = await frame.$(selector).catch(() => null)
      if (!handle) continue
      const clicked = await frame.click(selector).then(() => true).catch(async () => {
        return frame.$eval(selector, (el) => {
          const target = el as HTMLElement
          target.click()
        }).then(() => true).catch(() => false)
      })
      if (clicked) return true
    }
  }

  return false
}

/** StepStone / Xing: fixed wait after login page load before handling cookies. */
const STEPSTONE_COOKIE_SETTLE_MS = 7000
const XING_COOKIE_SETTLE_MS = 7000

const COOKIE_ACCEPT_SELECTORS = [
  'button[data-testid="uc-accept-all-button"]',
  '#ccmgt_explicit_accept',
  '#onetrust-accept-btn-handler',
  'button[data-testid*="accept"]',
  'button[id*="accept"]',
  'button[class*="accept"]',
  'button[aria-label*="Accept"]',
  'button[aria-label*="Akzept"]',
  '[data-accept-all]',
  '[aria-label*="Alle akzeptieren"]',
]

const COOKIE_ACCEPT_INCLUDE_WORDS = [
  'accept',
  'accept all',
  'allow all',
  'i agree',
  'agree',
  'akzeptieren',
  'alles akzeptieren',
  'alle akzeptieren',
  'zustimmen',
  'alles erlauben',
]

const COOKIE_ACCEPT_EXCLUDE_WORDS = [
  'reject',
  'decline',
  'necessary',
  'settings',
  'manage',
  'ablehnen',
  'nur notwendige',
  'einstellungen',
]

async function tryXingShadowCookieAccept(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const targets: HTMLElement[] = []
    const stack: (Document | ShadowRoot | Element)[] = [document]

    while (stack.length > 0) {
      const root = stack.pop()!
      const children = Array.from(root.querySelectorAll('*'))
      for (const node of children) {
        const el = node as Element & { shadowRoot?: ShadowRoot | null }
        if (el.shadowRoot) stack.push(el.shadowRoot)

        if (node.matches('button[data-testid="uc-accept-all-button"], #ccmgt_explicit_accept')) {
          targets.push(node as HTMLElement)
        }
      }
    }

    for (const target of targets) {
      try {
        target.click()
        return true
      } catch {
        // continue
      }
    }

    const clickByTextInRoot = (root: Document | ShadowRoot | Element): boolean => {
      const nodes = Array.from(root.querySelectorAll('button, [role="button"], a, div, span')) as HTMLElement[]
      for (const node of nodes) {
        const txt = (node.innerText || node.textContent || '').trim().toLowerCase()
        if (txt.includes('accept all') || txt.includes('alles akzeptieren') || txt === 'accept') {
          try {
            node.click()
            return true
          } catch {
            // continue
          }
        }
      }
      return false
    }

    const roots: (Document | ShadowRoot | Element)[] = [document]
    while (roots.length > 0) {
      const root = roots.pop()!
      if (clickByTextInRoot(root)) return true
      for (const el of Array.from(root.querySelectorAll('*')) as Array<Element & { shadowRoot?: ShadowRoot | null }>) {
        if (el.shadowRoot) roots.push(el.shadowRoot)
      }
    }
    return false
  }).catch(() => false)
}

/**
 * StepStone: wait 7s for page + cookie UI, then try to dismiss (same pattern as Xing — no polling loop).
 */
async function acceptCookieConsentIfPresentStepStone(page: Page): Promise<void> {
  await sleep(STEPSTONE_COOKIE_SETTLE_MS)

  const explicit = await page.$('#ccmgt_explicit_accept')
  if (explicit) {
    await explicit.click().catch(async () => {
      await page.$eval('#ccmgt_explicit_accept', (el) => {
        const t = el as HTMLElement
        t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
        t.click()
      })
    })
    console.log('[auth/stepstone] clicked #ccmgt_explicit_accept (Alles akzeptieren)')
    await sleep(800)
    return
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await clickFirstAvailableSelectorInAnyFrame(page, COOKIE_ACCEPT_SELECTORS)) {
      console.log(`[auth/stepstone] accepted cookie banner via selector (attempt ${attempt})`)
      await sleep(700)
      return
    }
    if (await clickTextMatchInAnyFrame(page, COOKIE_ACCEPT_INCLUDE_WORDS, COOKIE_ACCEPT_EXCLUDE_WORDS)) {
      console.log(`[auth/stepstone] accepted cookie banner via text match (attempt ${attempt})`)
      await sleep(700)
      return
    }
    await sleep(1200)
  }
}

/**
 * Xing: previous behavior — fixed wait for page/cookie UI, shadow-dom accept first, then selector/text retries (no polling loop).
 */
async function acceptCookieConsentIfPresentXing(page: Page): Promise<void> {
  await sleep(XING_COOKIE_SETTLE_MS)

  if (await tryXingShadowCookieAccept(page)) {
    console.log('[auth/xing] accepted cookie banner via xing shadow-dom fallback')
    await sleep(900)
    return
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await clickFirstAvailableSelectorInAnyFrame(page, COOKIE_ACCEPT_SELECTORS)) {
      console.log(`[auth/xing] accepted cookie banner via selector (attempt ${attempt})`)
      await sleep(700)
      return
    }
    if (await clickTextMatchInAnyFrame(page, COOKIE_ACCEPT_INCLUDE_WORDS, COOKIE_ACCEPT_EXCLUDE_WORDS)) {
      console.log(`[auth/xing] accepted cookie banner via text match (attempt ${attempt})`)
      await sleep(700)
      return
    }
    await sleep(1200)
  }
}

/** StepStone "Einloggen": span[data-genesis-element="BASE"] inside submit button — use force click + form.requestSubmit. */
async function clickStepStoneEinloggenButton(page: Page): Promise<boolean> {
  const clicked = await page.evaluate(() => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

    const forceClick = (el: HTMLElement): void => {
      try {
        el.scrollIntoView({ block: 'center', inline: 'center' })
      } catch {
        // ignore
      }
      const ev = { bubbles: true, cancelable: true, view: window }
      el.dispatchEvent(new MouseEvent('pointerdown', ev))
      el.dispatchEvent(new MouseEvent('mousedown', ev))
      el.dispatchEvent(new MouseEvent('pointerup', ev))
      el.dispatchEvent(new MouseEvent('mouseup', ev))
      el.dispatchEvent(new MouseEvent('click', ev))
      if (typeof (el as HTMLButtonElement).click === 'function') (el as HTMLButtonElement).click()
    }

    const findEinloggenNodes = (): HTMLElement[] => {
      const out: HTMLElement[] = []
      for (const sel of [
        'span[data-genesis-element="BASE"]',
        'span.gp-kyg8or',
        'button[type="submit"]',
        '[class*="login-form"] button',
        '[class*="SubmitButton"]',
      ]) {
        for (const el of Array.from(document.querySelectorAll(sel)) as HTMLElement[]) {
          const t = norm(el.innerText || el.textContent || '')
          if (t === 'einloggen' || (t.length <= 48 && t.includes('einloggen'))) out.push(el)
        }
      }
      return out
    }

    for (const node of findEinloggenNodes()) {
      const btn = node.closest('button') ?? (node.tagName === 'BUTTON' ? node : null)
      if (btn) {
        forceClick(btn as HTMLElement)
        return true
      }
    }

    for (const btn of Array.from(document.querySelectorAll('button[type="submit"], button')) as HTMLElement[]) {
      const t = norm(btn.innerText || btn.textContent || '')
      if (t.includes('einloggen')) {
        forceClick(btn)
        return true
      }
    }

    const pwd = document.querySelector('input[type="password"]') as HTMLInputElement | null
    const form = pwd?.form ?? document.querySelector('form')
    if (form && typeof (form as HTMLFormElement).requestSubmit === 'function') {
      try {
        ;(form as HTMLFormElement).requestSubmit()
        return true
      } catch {
        // continue
      }
    }
    if (form) {
      try {
        ;(form as HTMLFormElement).submit()
        return true
      } catch {
        // continue
      }
    }

    return false
  }).catch(() => false)

  if (clicked) {
    console.log('[auth/stepstone] clicked Einloggen / requestSubmit')
    return true
  }

  const xpathOk = await page.evaluate(() => {
    const xp = '//button[.//span[contains(normalize-space(.),"Einloggen")]] | //button[contains(normalize-space(.),"Einloggen")]'
    const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    const n = r.singleNodeValue as HTMLElement | null
    if (!n) return false
    n.scrollIntoView({ block: 'center', inline: 'center' })
    n.click()
    return true
  }).catch(() => false)

  if (xpathOk) {
    console.log('[auth/stepstone] clicked Einloggen via XPath')
    return true
  }

  return false
}

async function clickTextMatchInAnyFrame(
  page: Page,
  includeWords: string[],
  excludeWords: string[] = [],
): Promise<boolean> {
  const mainClicked = await clickTextMatchInPage(page, includeWords, excludeWords)
  if (mainClicked) return true

  for (const frame of page.frames()) {
    const clicked = await frame.evaluate(
      ({ includeWords, excludeWords }) => {
        const nodes = Array.from(
          document.querySelectorAll('button, [role="button"], a, input[type="submit"], div, span'),
        ) as HTMLElement[]

        for (const node of nodes) {
          const text = (node.innerText || node.textContent || '').trim().toLowerCase()
          if (!text) continue
          if (excludeWords.some((w) => text.includes(w))) continue
          if (!includeWords.some((w) => text.includes(w))) continue

          const style = window.getComputedStyle(node)
          if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue

          node.click()
          return true
        }
        return false
      },
      { includeWords, excludeWords },
    ).catch(() => false)
    if (clicked) return true
  }

  return false
}

async function submitLoginForm(
  page: Page,
  platform: PlatformId,
  buttonSelectors: string[],
  buttonTextHints: string[],
): Promise<boolean> {
  const selectorClicked = await clickFirstAvailableSelector(page, buttonSelectors)
  if (selectorClicked) {
    console.log(`[auth/${platform}] clicked login button via selector`)
    return true
  }

  const textClicked = await clickTextMatchInPage(page, buttonTextHints)
  if (textClicked) {
    console.log(`[auth/${platform}] clicked login button via text`)
    return true
  }

  await page.keyboard.press('Enter').catch(() => undefined)
  console.log(`[auth/${platform}] submitted login via Enter fallback`)
  return false
}

async function submitStepStoneLogin(page: Page): Promise<void> {
  if (await clickStepStoneEinloggenButton(page)) return
  await submitLoginForm(page, 'stepstone', [
    'button[type="submit"]',
    'button[id*="login"]',
    'button[class*="login"]',
    'button[data-testid*="login"]',
    'button[name="submit"]',
    'input[type="submit"]',
  ], [
    'einloggen',
    'login',
    'log in',
    'anmelden',
  ])
}

async function waitForManualPlatformLogin(
  page: Page,
  opts: {
    label: string
    loginIndicators: string[]
    requiredCookieNames?: string[]
    maxWaitMs?: number
  },
): Promise<ManualLoginOutcome> {
  const maxWaitMs = opts.maxWaitMs ?? MANUAL_LOGIN_WAIT_MS
  const started = Date.now()
  console.log(`[auth/${opts.label}] waiting for manual login`)

  while (Date.now() - started < maxWaitMs) {
    if (page.isClosed()) return 'closed'
    await sleep(2000)
    if (page.isClosed()) return 'closed'

    const url = page.url().toLowerCase()
    const cookies = await page.cookies().catch(() => [])
    const stillOnLoginLikePage = opts.loginIndicators.some((i) => url.includes(i))
    const hasRequiredCookies = (opts.requiredCookieNames?.length ?? 0) === 0
      ? cookies.length > 0
      : opts.requiredCookieNames!.every((name) => cookies.some((c) => c.name === name))

    if (!stillOnLoginLikePage && hasRequiredCookies) return 'success'
  }

  return 'timeout'
}

async function runManualConnect(
  platform: PlatformId,
  setupPage: (page: Page) => Promise<void>,
  waitOpts: { label: string; loginIndicators: string[]; requiredCookieNames?: string[] },
  username: string,
): Promise<{ ok: boolean; username?: string; error?: string }> {
  let page: Page | null = null
  try {
    page = await getAuthBrowserPage({ showMouseOverlay: false, reuseBlankPage: true })
    await setupPage(page)

    const outcome = await waitForManualPlatformLogin(page, waitOpts)
    if (outcome === 'closed') return { ok: false, error: 'Login window was closed. Click Connect and try again.' }
    if (outcome === 'timeout') return { ok: false, error: `Timed out waiting for manual ${waitOpts.label} login.` }

    const cookies = await page.cookies() as unknown as Protocol.Network.CookieParam[]
    saveSession(platform, { cookies, loggedInAt: new Date(), username })
    return { ok: true, username }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Login failed' }
  } finally {
    if (page) await page.close().catch(() => undefined)
  }
}

async function connectStepStoneHeadless(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  let page: Page | null = null
  try {
    page = await getBrowserPage(false, { showMouseOverlay: false, reuseBlankPage: true })
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' })
    await page.goto('https://www.stepstone.de/de-DE/candidate/login', {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    })
    await sleep(400)
    await acceptCookieConsentIfPresentStepStone(page)

    const filledEmail = await typeIntoFirstAvailableSelector(page, [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      '#email',
    ], email)
    const filledPassword = await typeIntoFirstAvailableSelector(page, [
      'input[type="password"]',
      'input[name="password"]',
      '#password',
    ], password)
    if (!filledEmail || !filledPassword) {
      return { ok: false, error: 'Could not find StepStone login fields. Please try again.' }
    }

    await submitStepStoneLogin(page)

    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined)
    await sleep(2200)

    const cookies = await page.cookies('https://www.stepstone.de') as unknown as Protocol.Network.CookieParam[]
    if (cookies.length === 0 || page.url().toLowerCase().includes('/login')) {
      return { ok: false, error: 'StepStone login failed. Check your credentials and try again.' }
    }

    saveSession('stepstone', { cookies, loggedInAt: new Date(), username: email })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'StepStone login failed' }
  } finally {
    if (page) await page.close().catch(() => undefined)
  }
}

async function connectXingHeadless(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  let page: Page | null = null
  try {
    page = await getBrowserPage(false, { showMouseOverlay: false, reuseBlankPage: true })
    await page.goto('https://login.xing.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    })
    await sleep(400)
    await acceptCookieConsentIfPresentXing(page)

    const filledEmail = await typeIntoFirstAvailableSelector(page, [
      'input[type="email"]',
      'input[name="username"]',
      'input[name="email"]',
      '#username',
      '#login-email',
    ], email)
    const filledPassword = await typeIntoFirstAvailableSelector(page, [
      'input[type="password"]',
      'input[name="password"]',
      '#password',
      '#login-password',
    ], password)
    if (!filledEmail || !filledPassword) {
      return { ok: false, error: 'Could not find Xing login fields. Please try again.' }
    }

    await submitLoginForm(page, 'xing', [
      'button[type="submit"]',
      'button[name="btn_login"]',
      'button[data-testid*="login"]',
      'button[data-xds="Button"][type="submit"]',
      'button.login-form-styled__SubmitButton-sc-d86d19cd-9',
      'button[id*="login"]',
      'button[class*="login"]',
      'input[type="submit"]',
    ], [
      'log in',
      'login',
      'anmelden',
      'einloggen',
      'sign in',
    ])

    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined)
    await sleep(2500)

    const cookies = await page.cookies('https://www.xing.com', 'https://login.xing.com') as unknown as Protocol.Network.CookieParam[]
    const currentUrl = page.url().toLowerCase()
    if (cookies.length === 0 || currentUrl.includes('login.xing.com')) {
      return { ok: false, error: 'Xing login failed. Check your credentials and try again.' }
    }

    saveSession('xing', { cookies, loggedInAt: new Date(), username: email })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Xing login failed' }
  } finally {
    if (page) await page.close().catch(() => undefined)
  }
}

// Status - which platforms have an active session
router.get('/status', (_req: Request, res: Response) => {
  res.json(allSessions())
})

// Disconnect
router.post('/:platform/disconnect', (req: Request, res: Response) => {
  clearSession(String(req.params.platform))
  res.json({ ok: true })
})

// Download Python capture script
router.get('/linkedin/capture-script', (_req: Request, res: Response) => {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'linkedin_capture.py')
  if (!fs.existsSync(scriptPath)) {
    res.status(404).json({ error: 'Script not found' })
    return
  }
  const content = fs.readFileSync(scriptPath)
  res.setHeader('Content-Type', 'text/x-python')
  res.setHeader('Content-Disposition', 'attachment; filename="linkedin_capture.py"')
  res.setHeader('Content-Length', content.length)
  res.end(content)
})

// Import session — called by the local capture script
router.post('/linkedin/import-session', async (req: Request, res: Response) => {
  const { liAt, username } = req.body as { liAt?: unknown; username?: unknown }

  const token    = typeof liAt === 'string' ? liAt.trim() : ''
  const uname    = typeof username === 'string' ? username.trim() : 'linkedin-user'

  if (!token) {
    res.json({ ok: false, error: 'liAt token is required.' })
    return
  }

  writeLinkedInSessionFile({ liAt: token, capturedAt: new Date().toISOString(), username: uname })

  // Pre-load into memory immediately
  saveSession('linkedin', {
    cookies: [{ name: 'li_at', value: token, domain: '.linkedin.com', path: '/', secure: true, httpOnly: true }],
    loggedInAt: new Date(),
    username: uname,
  })

  console.log(`[auth/linkedin] session imported via capture script (user: ${uname})`)
  res.json({ ok: true })
})

// Connect - LinkedIn
// In headless mode: reads data/linkedin-session.json, validates token, loads into memory.
// In manual mode: opens a visible browser window for manual login.
router.post('/linkedin/connect', async (_req: Request, res: Response) => {
  if (activeConnectLocks.has('linkedin')) {
    res.json({ ok: false, error: 'LinkedIn connection is already in progress. Please wait.' })
    return
  }
  activeConnectLocks.add('linkedin')

  try {
    // ── Manual mode (dev only) ─────────────────────────────────────────────────
    if (AUTH_MODE === 'manual') {
      const result = await runManualConnect(
        'linkedin',
        async (page) => {
          await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
          await page.goto(
            'https://www.linkedin.com/login?fromSignIn=true&trk=guest_homepage-basic_nav-header-signin',
            { waitUntil: 'domcontentloaded', timeout: 30_000 },
          )
          await page.bringToFront().catch(() => undefined)
        },
        {
          label: 'linkedin',
          loginIndicators: ['/login', '/uas/login', 'checkpoint', 'challenge', 'verification'],
          requiredCookieNames: ['li_at'],
        },
        'manual-linkedin',
      )
      res.json(result)
      return
    }

    // ── Headless mode: read session file ───────────────────────────────────────
    const fileSession = readLinkedInSessionFile()

    if (!fileSession) {
      res.json({
        ok: false,
        noSession: true,
        error: 'No LinkedIn session found. Run the capture script locally first.',
      })
      return
    }

    if (isLinkedInSessionExpired(fileSession)) {
      res.json({
        ok: false,
        expired: true,
        error: 'LinkedIn session has expired (>330 days). Run the capture script again.',
      })
      return
    }

    // Load into memory
    saveSession('linkedin', {
      cookies: [{ name: 'li_at', value: fileSession.liAt, domain: '.linkedin.com', path: '/', secure: true, httpOnly: true }],
      loggedInAt: new Date(fileSession.capturedAt),
      username: fileSession.username,
    })

    console.log(`[auth/linkedin] session loaded from file (user: ${fileSession.username})`)
    res.json({ ok: true, username: fileSession.username })
  } finally {
    activeConnectLocks.delete('linkedin')
  }
})

// Connect - StepStone
router.post('/stepstone/connect', async (req: Request<unknown, unknown, ConnectBody>, res: Response) => {
  if (activeConnectLocks.has('stepstone')) {
    res.json({ ok: false, error: 'StepStone connection is already in progress. Please wait.' })
    return
  }
  activeConnectLocks.add('stepstone')

  try {
    if (AUTH_MODE === 'manual') {
      const result = await runManualConnect(
        'stepstone',
        async (page) => {
          await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' })
          await page.goto('https://www.stepstone.de/de-DE/candidate/login', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          })
          await page.bringToFront().catch(() => undefined)
        },
        {
          label: 'stepstone',
          loginIndicators: ['kandidaten/login', '/login'],
        },
        'manual-stepstone',
      )
      res.json(result)
      return
    }

    const creds = parseCredentials(req.body)
    if (!creds) {
      res.json({ ok: false, error: 'Email and password are required.' })
      return
    }

    const result = await connectStepStoneHeadless(creds.email, creds.password)
    res.json(result.ok ? { ok: true, username: creds.email } : result)
  } finally {
    activeConnectLocks.delete('stepstone')
  }
})

// Connect - Xing
router.post('/xing/connect', async (req: Request<unknown, unknown, ConnectBody>, res: Response) => {
  if (activeConnectLocks.has('xing')) {
    res.json({ ok: false, error: 'Xing connection is already in progress. Please wait.' })
    return
  }
  activeConnectLocks.add('xing')

  try {
    if (AUTH_MODE === 'manual') {
      const result = await runManualConnect(
        'xing',
        async (page) => {
          await page.goto('https://login.xing.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          })
          await page.bringToFront().catch(() => undefined)
        },
        {
          label: 'xing',
          loginIndicators: ['login.xing.com', '/login'],
        },
        'manual-xing',
      )
      res.json(result)
      return
    }

    const creds = parseCredentials(req.body)
    if (!creds) {
      res.json({ ok: false, error: 'Email and password are required.' })
      return
    }

    const result = await connectXingHeadless(creds.email, creds.password)
    res.json(result.ok ? { ok: true, username: creds.email } : result)
  } finally {
    activeConnectLocks.delete('xing')
  }
})

export default router
