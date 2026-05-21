/**
 * Xing headless connect via Playwright Firefox.
 * Playwright locators pierce shadow DOM — required for Usercentrics button#accept.
 *
 * Cookie: poll up to 60s every 5s; click accept when found.
 * Login: up to 5 attempts; 5s wait on retryable errors; wait for outcome after submit.
 */
import type { Frame, Page } from 'playwright'
import { saveSession } from './sessions'
import { sleep } from './browser'
import {
  closeXingFirefoxBrowser,
  getXingFirefoxPage,
  highlightXingClickTarget,
  protocolCookiesFromPlaywright,
  XING_AUTH_VIEWPORT,
  XING_SHOW_MOUSE,
} from './xingFirefox'

const XING_COOKIE_MAX_WAIT_MS = 60_000
const XING_COOKIE_POLL_INTERVAL_MS = 5_000
const XING_COOKIE_DISMISS_MAX_ATTEMPTS = 5
const XING_COOKIE_DISMISS_RETRY_MS = 1_500
const XING_COOKIE_DISMISS_SETTLE_MS = 800
const XING_LOGIN_MAX_ATTEMPTS = 5
const XING_LOGIN_RETRY_WAIT_MS = 5_000
const XING_LOGIN_OUTCOME_WAIT_MS = 45_000
const XING_LOGIN_SUCCESS_GRACE_MS = 10_000

const XING_LOGIN_FIELD_SELECTORS = [
  'input[type="email"]',
  'input[name="username"]',
  'input[name="email"]',
  '#username',
  '#login-email',
]

/** Usercentrics CMP on Xing login — not data-testid uc-accept-all-button. */
const XING_ACCEPT_LOCATOR =
  'button#accept, button.uc-accept-button, button[data-action-type="accept"], ' +
  '#uc-cmp-footer button.accept, #uc-main-dialog button#accept, button.accept.uc-accept-button'

const XING_ACCEPT_SHADOW_SELECTORS = [
  'button#accept',
  'button.uc-accept-button',
  'button[data-action-type="accept"]',
  '#uc-cmp-footer button.accept',
]

const XING_RETRYABLE_ERROR_SNIPPETS = [
  "unfortunately, that didn't work out",
  'sorry, something went wrong',
]

const XING_LOGIN_BUTTON_SELECTORS = [
  'button[type="submit"]',
  'button[name="btn_login"]',
  'button[data-testid*="login"]',
  'button[data-xds="Button"][type="submit"]',
  'button.login-form-styled__SubmitButton-sc-d86d19cd-9',
  'button[id*="login"]',
  'button[class*="login"]',
  'input[type="submit"]',
]

const XING_LOGIN_BUTTON_TEXT = ['log in', 'login', 'anmelden', 'einloggen', 'sign in']

type LoginOutcome = 'success' | 'retryable_error' | 'fatal_error' | 'timeout'

type AcceptTarget = { root: Page | Frame; hint: string }

const XING_CMP_DIALOG_LOCATOR = '#uc-main-dialog, .cmp-wrapper.cmp, #usercentrics-root'

async function isLocatorVisible(root: Page | Frame, selector: string): Promise<boolean> {
  const loc = root.locator(selector).first()
  if ((await loc.count().catch(() => 0)) === 0) return false
  return loc.isVisible().catch(() => false)
}

async function isShadowAcceptVisible(root: Page | Frame): Promise<boolean> {
  return root.evaluate((selectors) => {
    const isVisible = (el: Element): boolean => {
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      const rect = el.getBoundingClientRect()
      return rect.width > 8 && rect.height > 8
    }
    const scan = (r: Document | ShadowRoot): boolean => {
      for (const sel of selectors) {
        try {
          for (const el of Array.from(r.querySelectorAll(sel))) {
            if (isVisible(el)) return true
          }
        } catch {
          // invalid selector
        }
      }
      for (const el of Array.from(r.querySelectorAll('*')) as Array<Element & { shadowRoot?: ShadowRoot | null }>) {
        if (el.shadowRoot && scan(el.shadowRoot)) return true
      }
      return false
    }
    return scan(document)
  }, XING_ACCEPT_SHADOW_SELECTORS).catch(() => false)
}

/** True when accept button or CMP dialog is visible and blocking the login form. */
async function isCookieBannerBlocking(page: Page): Promise<boolean> {
  if (await isLocatorVisible(page, XING_ACCEPT_LOCATOR)) return true
  if (await isLocatorVisible(page, XING_CMP_DIALOG_LOCATOR)) return true

  const acceptRole = page.getByRole('button', {
    name: /accept all|alles akzeptieren|alle akzeptieren|alles erlauben/i,
  }).first()
  if (await acceptRole.isVisible().catch(() => false)) return true

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    if (await isLocatorVisible(frame, XING_ACCEPT_LOCATOR)) return true
    if (await isLocatorVisible(frame, XING_CMP_DIALOG_LOCATOR)) return true
    if (await isShadowAcceptVisible(frame)) return true
  }

  return isShadowAcceptVisible(page)
}

/** Login form usable: email visible and no visible accept button (ignore hidden iframe DOM). */
async function isLoginFormReady(page: Page): Promise<boolean> {
  const email = page.locator(XING_LOGIN_FIELD_SELECTORS.join(', ')).first()
  if (!(await email.isVisible().catch(() => false))) return false

  if (await isLocatorVisible(page, XING_ACCEPT_LOCATOR)) return false
  if (await isLocatorVisible(page, XING_CMP_DIALOG_LOCATOR)) return false

  const acceptRole = page.getByRole('button', {
    name: /accept all|alles akzeptieren|alle akzeptieren|alles erlauben/i,
  }).first()
  if (await acceptRole.isVisible().catch(() => false)) return false

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    if (await isLocatorVisible(frame, XING_ACCEPT_LOCATOR)) return false
    if (await isLocatorVisible(frame, XING_CMP_DIALOG_LOCATOR)) return false
  }

  return true
}

async function findVisibleAcceptTarget(page: Page): Promise<AcceptTarget | null> {
  if (await isLocatorVisible(page, XING_ACCEPT_LOCATOR)) {
    return { root: page, hint: 'usercentrics locator (main)' }
  }

  const acceptRole = page.getByRole('button', {
    name: /accept all|alles akzeptieren|alle akzeptieren|alles erlauben/i,
  }).first()
  if (await acceptRole.isVisible().catch(() => false)) {
    return { root: page, hint: 'getByRole accept (main)' }
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    if (await isLocatorVisible(frame, XING_ACCEPT_LOCATOR)) {
      return { root: frame, hint: `usercentrics locator (frame: ${frame.url().slice(0, 60)})` }
    }
  }

  return null
}

async function clickShadowAcceptInRoot(root: Page | Frame): Promise<boolean> {
  return root.evaluate((selectors) => {
    const forceClick = (el: HTMLElement): void => {
      try {
        el.scrollIntoView({ block: 'center', inline: 'center' })
      } catch {
        // ignore
      }
      const footer = document.querySelector('#uc-cmp-footer') as HTMLElement | null
      if (footer) {
        try {
          footer.scrollIntoView({ block: 'end', inline: 'nearest' })
        } catch {
          // ignore
        }
      }
      const ev = { bubbles: true, cancelable: true, view: window }
      el.dispatchEvent(new MouseEvent('pointerdown', ev))
      el.dispatchEvent(new MouseEvent('mousedown', ev))
      el.dispatchEvent(new MouseEvent('pointerup', ev))
      el.dispatchEvent(new MouseEvent('mouseup', ev))
      el.dispatchEvent(new MouseEvent('click', ev))
      if (typeof el.click === 'function') el.click()
    }

    const tryRoot = (root: Document | ShadowRoot): boolean => {
      for (const sel of selectors) {
        for (const el of Array.from(root.querySelectorAll(sel)) as HTMLElement[]) {
          try {
            forceClick(el)
            return true
          } catch {
            // continue
          }
        }
      }
      for (const el of Array.from(root.querySelectorAll('*')) as Array<Element & { shadowRoot?: ShadowRoot | null }>) {
        if (el.shadowRoot && tryRoot(el.shadowRoot)) return true
      }
      return false
    }

    const clickByText = (root: Document | ShadowRoot): boolean => {
      const phrases = ['accept all', 'alles akzeptieren', 'alle akzeptieren']
      const nodes = Array.from(root.querySelectorAll('button, [role="button"]')) as HTMLElement[]
      for (const node of nodes) {
        const txt = (node.innerText || node.textContent || '').trim().toLowerCase()
        if (phrases.some((p) => txt === p || txt.includes(p))) {
          try {
            forceClick(node)
            return true
          } catch {
            // continue
          }
        }
      }
      for (const el of Array.from(root.querySelectorAll('*')) as Array<Element & { shadowRoot?: ShadowRoot | null }>) {
        if (el.shadowRoot && clickByText(el.shadowRoot)) return true
      }
      return false
    }

    return tryRoot(document) || clickByText(document)
  }, XING_ACCEPT_SHADOW_SELECTORS).catch(() => false)
}

async function clickXingAcceptEverywhere(page: Page): Promise<boolean> {
  if (await clickXingAcceptButton(page)) return true

  const childFrames = page.frames().filter((f) => f !== page.mainFrame())
  childFrames.sort((a, b) => {
    const aStan = a.url().includes('stan.xing') ? 1 : 0
    const bStan = b.url().includes('stan.xing') ? 1 : 0
    return bStan - aStan
  })

  for (const frame of childFrames) {
    const label = frame.url().slice(0, 50)
    const btn = frame.locator(XING_ACCEPT_LOCATOR).first()
    if (await btn.isVisible().catch(() => false)) {
      try {
        await btn.click({ force: true, timeout: 15_000 })
        console.log(`[auth/xing/ff] accept clicked in frame ${label}`)
        return true
      } catch {
        // try evaluate in this frame
      }
    }
    if (await clickShadowAcceptInRoot(frame)) {
      console.log(`[auth/xing/ff] accept clicked via evaluate in frame ${label}`)
      return true
    }
  }

  if (await clickShadowAcceptInRoot(page)) {
    console.log('[auth/xing/ff] accept clicked via evaluate (main)')
    return true
  }

  return false
}

async function clickXingAcceptButton(page: Page): Promise<boolean> {
  const target = await findVisibleAcceptTarget(page)
  console.log(`[auth/xing/ff] click accept: target=${target?.hint ?? 'none'}`)

  const tryLocatorClick = async (root: Page | Frame, label: string): Promise<boolean> => {
    const btn = root.locator(XING_ACCEPT_LOCATOR).first()
    if (!(await btn.isVisible().catch(() => false))) return false

    console.log(`[auth/xing/ff] clicking accept-all (${label})`)
    await btn.scrollIntoViewIfNeeded().catch(() => undefined)
    if (XING_SHOW_MOUSE && root === page) {
      await highlightXingClickTarget(page, 'button#accept', 'click: Accept all')
    }
    try {
      await btn.click({ force: true, timeout: 15_000 })
      console.log(`[auth/xing/ff] accept-all click dispatched (${label})`)
      return true
    } catch (err) {
      console.log(
        `[auth/xing/ff] locator click failed (${label}): ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }
  }

  if (target?.hint.startsWith('usercentrics locator')) {
    if (await tryLocatorClick(target.root, target.hint)) return true
  }

  if (await tryLocatorClick(page, 'main fallback')) return true

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    if (await tryLocatorClick(frame, `frame ${frame.url().slice(0, 50)}`)) return true
  }

  const roleBtn = page.getByRole('button', {
    name: /accept all|alles akzeptieren|alle akzeptieren/i,
  }).first()
  if (await roleBtn.isVisible().catch(() => false)) {
    try {
      await roleBtn.click({ force: true, timeout: 15_000 })
      console.log('[auth/xing/ff] accept-all clicked via getByRole')
      return true
    } catch {
      // fall through
    }
  }

  return false
}

async function waitForXingLoginPageVisible(page: Page): Promise<void> {
  console.log('[auth/xing/ff] waiting for login page')
  try {
    await page.waitForSelector(XING_LOGIN_FIELD_SELECTORS.join(', '), { timeout: 25_000 })
    console.log('[auth/xing/ff] login page visible')
  } catch {
    console.log('[auth/xing/ff] login page loaded (fields not detected yet)')
  }
}

async function waitForXingCookiePopupAtLogin(page: Page): Promise<void> {
  const maxChecks = Math.ceil(XING_COOKIE_MAX_WAIT_MS / XING_COOKIE_POLL_INTERVAL_MS)

  // Phase 1: wait until popup actually appears (do not fill credentials before this)
  console.log('[auth/xing/ff] phase 1: wait up to 60s for cookie popup to appear (every 5s)')
  let popupSeen = false

  for (let check = 1; check <= maxChecks; check++) {
    console.log(`[auth/xing/ff] popup appear check ${check}/${maxChecks}`)
    if (await isCookieBannerBlocking(page)) {
      const target = await findVisibleAcceptTarget(page)
      console.log(`[auth/xing/ff] cookie popup visible (${target?.hint ?? 'dialog/shadow'})`)
      popupSeen = true
      break
    }
    if (check < maxChecks) {
      console.log(`[auth/xing/ff] popup not visible yet, waiting 5s`)
      await sleep(XING_COOKIE_POLL_INTERVAL_MS)
    }
  }

  if (!popupSeen) {
    console.log('[auth/xing/ff] no cookie popup within 60s — continuing to login form')
    return
  }

  // Phase 2: click accept and retry until popup is really closed
  console.log(
    `[auth/xing/ff] phase 2: click accept until popup closes (up to ${XING_COOKIE_DISMISS_MAX_ATTEMPTS} tries, every ${XING_COOKIE_DISMISS_RETRY_MS / 1000}s)`,
  )

  for (let attempt = 1; attempt <= XING_COOKIE_DISMISS_MAX_ATTEMPTS; attempt++) {
    if (await isLoginFormReady(page)) {
      console.log('[auth/xing/ff] login form ready (cookie popup gone)')
      return
    }

    console.log(`[auth/xing/ff] dismiss attempt ${attempt}/${XING_COOKIE_DISMISS_MAX_ATTEMPTS}`)
    const clicked = await clickXingAcceptEverywhere(page)
    console.log(`[auth/xing/ff] dismiss attempt ${attempt}: click ${clicked ? 'sent' : 'failed'}`)

    await sleep(XING_COOKIE_DISMISS_SETTLE_MS)

    if (await isLoginFormReady(page)) {
      console.log(`[auth/xing/ff] login form ready after attempt ${attempt}`)
      return
    }

    if (attempt < XING_COOKIE_DISMISS_MAX_ATTEMPTS) {
      await sleep(XING_COOKIE_DISMISS_RETRY_MS)
    }
  }

  if (await isLoginFormReady(page)) {
    console.log('[auth/xing/ff] login form ready on final check')
    return
  }

  console.log('[auth/xing/ff] warning: cookie popup may still be open after all dismiss attempts')
}

async function typeIntoFirstSelector(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first()
    if ((await loc.count()) === 0) continue
    try {
      await loc.waitFor({ state: 'visible', timeout: 3000 })
      if (XING_SHOW_MOUSE) await highlightXingClickTarget(page, sel, 'fill')
      await loc.click({ timeout: 5000 })
      await loc.fill(value, { timeout: 8000 })
      return true
    } catch {
      // try next
    }
  }
  return false
}

async function clickLoginButton(page: Page): Promise<boolean> {
  for (const sel of XING_LOGIN_BUTTON_SELECTORS) {
    const loc = page.locator(sel).first()
    if ((await loc.count()) === 0) continue
    try {
      await loc.waitFor({ state: 'visible', timeout: 3000 })
      if (XING_SHOW_MOUSE) await highlightXingClickTarget(page, sel, 'click: login')
      await loc.click({ timeout: 10_000 })
      return true
    } catch {
      // try next
    }
  }

  return page.evaluate((hints) => {
    for (const node of Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')) as HTMLElement[]) {
      const t = (node.innerText || node.textContent || '').trim().toLowerCase()
      if (hints.some((h: string) => t.includes(h))) {
        node.click()
        return true
      }
    }
    return false
  }, XING_LOGIN_BUTTON_TEXT).catch(() => false)
}

function pageHasRetryableLoginError(text: string): boolean {
  const lower = text.toLowerCase()
  return XING_RETRYABLE_ERROR_SNIPPETS.some((s) => lower.includes(s))
}

async function detectXingLoggedIn(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase()
  if (!url.includes('login.xing.com')) {
    const cookies = await page.context().cookies()
    if (cookies.some((c) => /xing/i.test(c.domain || '') && c.name.length > 2)) return true
  }

  return page.evaluate(() => {
    const href = location.href.toLowerCase()
    if (!href.includes('login.xing.com')) return true

    const hints = [
      '[data-testid="nav-profile"]',
      'a[href*="/profile"]',
      '[class*="GlobalNavigation"]',
      'nav a[href*="xing.com/jobs"]',
    ]
    for (const sel of hints) {
      if (document.querySelector(sel)) return true
    }

    const body = (document.body?.innerText || '').toLowerCase()
    return body.includes('my jobs') || body.includes('meine jobs')
  }).catch(() => false)
}

async function readVisibleLoginError(page: Page): Promise<string | null> {
  return page.evaluate(({ retryable }) => {
    const nodes = Array.from(document.querySelectorAll('[role="alert"], .error, [class*="error"], [class*="Error"]'))
    for (const node of nodes) {
      const text = (node.textContent || '').trim()
      if (!text || text.length > 300) continue
      const lower = text.toLowerCase()
      if (retryable.some((s: string) => lower.includes(s))) return text
      if (/invalid|incorrect|wrong|ungültig|falsch|credentials/i.test(text)) return text
    }

    const body = (document.body?.innerText || '').toLowerCase()
    for (const s of retryable) {
      if (body.includes(s)) {
        const idx = body.indexOf(s)
        return document.body.innerText.slice(Math.max(0, idx - 20), idx + s.length + 40).trim()
      }
    }
    return null
  }, { retryable: XING_RETRYABLE_ERROR_SNIPPETS }).catch(() => null)
}

async function waitForXingLoginOutcome(page: Page): Promise<LoginOutcome> {
  const started = Date.now()
  console.log('[auth/xing/ff] waiting for login outcome after submit')

  while (Date.now() - started < XING_LOGIN_OUTCOME_WAIT_MS) {
    if (page.isClosed()) return 'timeout'

    if (await detectXingLoggedIn(page)) {
      console.log('[auth/xing/ff] logged in detected')
      return 'success'
    }

    const errText = await readVisibleLoginError(page)
    if (errText) {
      if (pageHasRetryableLoginError(errText)) {
        console.log(`[auth/xing/ff] retryable error: ${errText.slice(0, 80)}`)
        const graceStart = Date.now()
        while (Date.now() - graceStart < XING_LOGIN_SUCCESS_GRACE_MS) {
          await sleep(1000)
          if (await detectXingLoggedIn(page)) {
            console.log('[auth/xing/ff] logged in during grace after retryable error')
            return 'success'
          }
        }
        return 'retryable_error'
      }
      console.log(`[auth/xing/ff] fatal login error: ${errText.slice(0, 120)}`)
      return 'fatal_error'
    }

    await sleep(1000)
  }

  if (await detectXingLoggedIn(page)) return 'success'
  console.log('[auth/xing/ff] login outcome wait timed out')
  return 'timeout'
}

async function submitXingLoginWithRetries(page: Page): Promise<LoginOutcome> {
  for (let attempt = 1; attempt <= XING_LOGIN_MAX_ATTEMPTS; attempt++) {
    console.log(`[auth/xing/ff] login attempt ${attempt}/${XING_LOGIN_MAX_ATTEMPTS}`)

    const clicked = await clickLoginButton(page)
    if (!clicked) {
      await page.keyboard.press('Enter').catch(() => undefined)
      console.log('[auth/xing/ff] submitted via Enter fallback')
    } else {
      console.log('[auth/xing/ff] clicked login button')
    }

    const outcome = await waitForXingLoginOutcome(page)
    if (outcome === 'success') return 'success'
    if (outcome === 'fatal_error') return 'fatal_error'

    if (outcome === 'retryable_error' && attempt < XING_LOGIN_MAX_ATTEMPTS) {
      console.log(`[auth/xing/ff] waiting ${XING_LOGIN_RETRY_WAIT_MS / 1000}s before retry`)
      await sleep(XING_LOGIN_RETRY_WAIT_MS)
      continue
    }

    if (outcome === 'timeout' && attempt < XING_LOGIN_MAX_ATTEMPTS) {
      if (await detectXingLoggedIn(page)) return 'success'
      console.log(`[auth/xing/ff] timeout on attempt ${attempt}, retrying`)
      await sleep(XING_LOGIN_RETRY_WAIT_MS)
      continue
    }

    return outcome
  }

  if (await detectXingLoggedIn(page)) return 'success'
  return 'timeout'
}

export async function connectXingFirefox(
  email: string,
  password: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  let page: Page | null = null
  try {
    page = await getXingFirefoxPage()
    await page.setViewportSize(XING_AUTH_VIEWPORT)

    console.log(
      `[auth/xing/ff] opening login page (Firefox ${XING_AUTH_VIEWPORT.width}x${XING_AUTH_VIEWPORT.height})`,
    )
    await page.goto('https://login.xing.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    })

    await waitForXingLoginPageVisible(page)
    await waitForXingCookiePopupAtLogin(page)

    console.log('[auth/xing/ff] filling email')
    const filledEmail = await typeIntoFirstSelector(page, XING_LOGIN_FIELD_SELECTORS, email)
    console.log(`[auth/xing/ff] email ${filledEmail ? 'filled' : 'not found'}`)

    console.log('[auth/xing/ff] filling password')
    const filledPassword = await typeIntoFirstSelector(page, [
      'input[type="password"]',
      'input[name="password"]',
      '#password',
      '#login-password',
    ], password)
    console.log(`[auth/xing/ff] password ${filledPassword ? 'filled' : 'not found'}`)

    if (!filledEmail || !filledPassword) {
      return { ok: false, error: 'Could not find Xing login fields. Please try again.' }
    }

    const loginOutcome = await submitXingLoginWithRetries(page)

    if (loginOutcome !== 'success' && !(await detectXingLoggedIn(page))) {
      if (loginOutcome === 'retryable_error') {
        return {
          ok: false,
          error: 'Xing login failed after several attempts. Please try again in a moment.',
        }
      }
      return { ok: false, error: 'Xing login failed. Check your credentials and try again.' }
    }

    const allCookies = await page.context().cookies()
    const xingCookies = protocolCookiesFromPlaywright(
      allCookies.filter((c) => /xing/i.test(c.domain || '')),
    )

    if (xingCookies.length === 0) {
      return { ok: false, error: 'Xing login failed — no session cookies saved.' }
    }

    await saveSession(userId, 'xing', {
      cookies: xingCookies,
      loggedInAt: new Date(),
      username: email,
    })
    console.log(`[auth/xing/ff] session saved (${xingCookies.length} cookies)`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Xing login failed' }
  } finally {
    if (page) await page.close().catch(() => undefined)
    await closeXingFirefoxBrowser().catch(() => undefined)
  }
}
