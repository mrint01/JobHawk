/**
 * Platform authentication routes.
 *
 * POST /api/auth/:platform/connect     — log in and capture session cookies
 * POST /api/auth/:platform/disconnect  — clear stored session
 * GET  /api/auth/status                — connection status for all platforms
 *
 * Flow:
 *  1. Client sends { email, password } to /connect
 *  2. Server opens a Puppeteer page, fills and submits the login form
 *  3. On success, cookies are stored in the in-memory session store
 *  4. Response: { ok: true, username }
 *  5. On failure (wrong creds / CAPTCHA): { ok: false, error: string }
 *
 * Credentials are used once and immediately discarded — they are never
 * logged, stored, or forwarded anywhere.
 */
import { Router, type Request, type Response } from 'express'
import { getAuthBrowserPage, sleep } from '../utils/browser'
import { saveSession, clearSession, allSessions } from '../utils/sessions'
import type { Protocol } from 'puppeteer'

const router = Router()
const MANUAL_LOGIN_WAIT_MS = 10 * 60 * 1000
const activeConnectLocks = new Set<'linkedin' | 'stepstone' | 'xing'>()

type ManualLoginOutcome = 'success' | 'closed' | 'timeout'

async function waitForManualPlatformLogin(
  page: import('puppeteer').Page,
  opts: {
    label: string
    loginIndicators: string[]
    requiredCookieNames?: string[]
    maxWaitMs?: number
  },
): Promise<ManualLoginOutcome> {
  const maxWaitMs = opts.maxWaitMs ?? MANUAL_LOGIN_WAIT_MS
  const started = Date.now()
  console.log(`[auth/${opts.label}] Waiting for manual login...`)

  while (Date.now() - started < maxWaitMs) {
    if (page.isClosed()) {
      console.log(`[auth/${opts.label}] Login window was closed by user.`)
      return 'closed'
    }

    await sleep(2000)
    if (page.isClosed()) {
      console.log(`[auth/${opts.label}] Login window was closed by user.`)
      return 'closed'
    }

    const url = page.url().toLowerCase()
    const cookies = await page.cookies().catch(() => [])
    const stillOnLoginLikePage = opts.loginIndicators.some((i) => url.includes(i))
    const hasRequiredCookies = (opts.requiredCookieNames?.length ?? 0) === 0
      ? cookies.length > 0
      : opts.requiredCookieNames!.every((name) => cookies.some((c) => c.name === name))

    if (!stillOnLoginLikePage && hasRequiredCookies) {
      console.log(`[auth/${opts.label}] Manual login detected successfully.`)
      return 'success'
    }
  }

  console.log(`[auth/${opts.label}] Timed out waiting for manual login.`)
  return 'timeout'
}

// ─────────────────────────────────────────────────────────────────────────────
// Status — which platforms have an active session
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', (_req: Request, res: Response) => {
  res.json(allSessions())
})

// ─────────────────────────────────────────────────────────────────────────────
// Disconnect
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:platform/disconnect', (req: Request, res: Response) => {
  const platform = String(req.params.platform)
  clearSession(platform)
  res.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// Connect — LinkedIn
// ─────────────────────────────────────────────────────────────────────────────
router.post('/linkedin/connect', async (_req: Request, res: Response) => {
  if (activeConnectLocks.has('linkedin')) {
    res.json({ ok: false, error: 'LinkedIn connection is already in progress. Please finish that window first.' })
    return
  }
  activeConnectLocks.add('linkedin')

  let page: import('puppeteer').Page | null = null
  try {
    page = await getAuthBrowserPage({ showMouseOverlay: false, reuseBlankPage: true })

    // LinkedIn login — use a realistic language + Accept header
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
    await page.goto('https://www.linkedin.com/login?fromSignIn=true&trk=guest_homepage-basic_nav-header-signin', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.bringToFront().catch(() => undefined)

    const outcome = await waitForManualPlatformLogin(page, {
      label: 'linkedin',
      loginIndicators: ['/login', '/uas/login', 'checkpoint', 'challenge', 'verification'],
      requiredCookieNames: ['li_at'],
    })
    if (outcome === 'closed') {
      res.json({ ok: false, error: 'Login window was closed. Click Connect and try again.' })
      return
    }
    if (outcome === 'timeout') {
      res.json({ ok: false, error: 'Timed out waiting for manual LinkedIn login.' })
      return
    }

    const cookies = await page.cookies() as unknown as Protocol.Network.CookieParam[]
    saveSession('linkedin', { cookies, loggedInAt: new Date(), username: 'manual-linkedin' })
    res.json({ ok: true, username: 'manual-linkedin' })
  } catch (err) {
    res.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Login failed',
    })
  } finally {
    activeConnectLocks.delete('linkedin')
    if (page) await page.close().catch(() => undefined)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Connect — StepStone
// ─────────────────────────────────────────────────────────────────────────────
router.post('/stepstone/connect', async (_req: Request, res: Response) => {
  if (activeConnectLocks.has('stepstone')) {
    res.json({ ok: false, error: 'StepStone connection is already in progress. Please finish that window first.' })
    return
  }
  activeConnectLocks.add('stepstone')

  let page = null
  try {
    page = await getAuthBrowserPage({ showMouseOverlay: false, reuseBlankPage: true })

    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' })
    await page.goto('https://www.stepstone.de/de-DE/candidate/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.bringToFront().catch(() => undefined)

    const outcome = await waitForManualPlatformLogin(page, {
      label: 'stepstone',
      loginIndicators: ['kandidaten/login', '/login'],
    })
    if (outcome === 'closed') {
      res.json({ ok: false, error: 'Login window was closed. Click Connect and try again.' })
      return
    }
    if (outcome === 'timeout') {
      res.json({ ok: false, error: 'Timed out waiting for manual StepStone login.' })
      return
    }

    const cookies = await page.cookies() as unknown as Protocol.Network.CookieParam[]
    saveSession('stepstone', { cookies, loggedInAt: new Date(), username: 'manual-stepstone' })
    res.json({ ok: true, username: 'manual-stepstone' })
  } catch (err) {
    res.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Login failed',
    })
  } finally {
    activeConnectLocks.delete('stepstone')
    if (page) await page.close().catch(() => undefined)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Connect — Xing
// ─────────────────────────────────────────────────────────────────────────────
router.post('/xing/connect', async (_req: Request, res: Response) => {
  if (activeConnectLocks.has('xing')) {
    res.json({ ok: false, error: 'Xing connection is already in progress. Please finish that window first.' })
    return
  }
  activeConnectLocks.add('xing')

  let page = null
  try {
    page = await getAuthBrowserPage({ showMouseOverlay: false, reuseBlankPage: true })

    await page.goto('https://login.xing.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.bringToFront().catch(() => undefined)

    const outcome = await waitForManualPlatformLogin(page, {
      label: 'xing',
      loginIndicators: ['login.xing.com', '/login'],
    })
    if (outcome === 'closed') {
      res.json({ ok: false, error: 'Login window was closed. Click Connect and try again.' })
      return
    }
    if (outcome === 'timeout') {
      res.json({ ok: false, error: 'Timed out waiting for manual Xing login.' })
      return
    }

    const cookies = await page.cookies() as unknown as Protocol.Network.CookieParam[]
    saveSession('xing', { cookies, loggedInAt: new Date(), username: 'manual-xing' })
    res.json({ ok: true, username: 'manual-xing' })
  } catch (err) {
    res.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Login failed',
    })
  } finally {
    activeConnectLocks.delete('xing')
    if (page) await page.close().catch(() => undefined)
  }
})

export default router
