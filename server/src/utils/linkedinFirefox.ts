/**
 * LinkedIn-only automation via Playwright Firefox (separate from Chromium/StepStone/Xing).
 *
 * Env: PUPPETEER_HEADLESS=false opens a visible Firefox window for login/scrape.
 */
import { firefox, type Browser, type BrowserContext, type Page } from 'playwright'

const HEADLESS = process.env.PUPPETEER_HEADLESS !== 'false'

let _browser: Browser | null = null
let _context: BrowserContext | null = null
let _contextLaunching: Promise<BrowserContext> | null = null

async function getOrCreateLinkedInContext(): Promise<BrowserContext> {
  if (_context) return _context
  if (!_contextLaunching) {
    _contextLaunching = (async () => {
      _browser = await firefox.launch({
        headless: HEADLESS,
        firefoxUserPrefs: {
          'dom.webdriver.enabled': false,
        },
      })
      _context = await _browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
        ignoreHTTPSErrors: true,
      })
      await _context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })
      return _context
    })()
  }
  _context = await _contextLaunching
  _contextLaunching = null
  return _context
}

export async function getLinkedInFirefoxPage(): Promise<Page> {
  const ctx = await getOrCreateLinkedInContext()
  return ctx.newPage()
}

export async function closeLinkedInFirefoxBrowser(): Promise<void> {
  try {
    await _context?.close()
  } catch {
    /* ignore */
  }
  _context = null
  try {
    await _browser?.close()
  } catch {
    /* ignore */
  }
  _browser = null
  _contextLaunching = null
}
