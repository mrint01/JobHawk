/**
 * Shared Puppeteer browser singleton.
 *
 * We keep one browser alive for the lifetime of the server process to avoid
 * the 3-5 s cold-start penalty on every scrape request.
 *
 * Env vars:
 *   PUPPETEER_HEADLESS=false  — open a real visible browser window
 *   PUPPETEER_SHOW_MOUSE=true — overlay a red cursor dot so you can watch
 *                               mouse movements in the visible window
 *
 * Usage:
 *   const page = await getBrowserPage()
 *   // ... do stuff ...
 *   await page.close()
 *   // DO NOT close the browser — call closeBrowser() only on shutdown.
 */
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Page } from 'puppeteer'

puppeteer.use(StealthPlugin())

let _browser: Browser | null = null
let _browserLaunching: Promise<Browser> | null = null
let _authBrowser: Browser | null = null

const HEADLESS   = process.env.PUPPETEER_HEADLESS   !== 'false'
const SHOW_MOUSE = process.env.PUPPETEER_SHOW_MOUSE === 'true'

function isReusableBlankUrl(url: string): boolean {
  return url === 'about:blank' || url === 'chrome://newtab/' || url === 'edge://newtab/'
}

/**
 * Returns (or lazily creates) a new page from the shared browser instance.
 *
 * @param blockAssets - Pass `false` for auth/scrape pages that need JS+CSS to
 *   render (e.g. LinkedIn SPA). Default `true` blocks images/fonts/media to
 *   speed up plain HTML pages.
 */
export async function getBrowserPage(
  blockAssets = true,
  opts?: { showMouseOverlay?: boolean; reuseBlankPage?: boolean },
): Promise<Page> {
  if (!_browser || !_browser.connected) {
    if (!_browserLaunching) {
      _browserLaunching = puppeteer.launch({
        headless: HEADLESS,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',          // Required in containers — prevents Chrome from crashing when /dev/shm is limited
          '--disable-gpu',                     // Headless containers have no GPU
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-size=1280,800',
        ],
      })
    }
    _browser = await _browserLaunching
    _browserLaunching = null
  }

  let page: Page
  if (opts?.reuseBlankPage) {
    const pages = await _browser.pages()
    const reusable = pages.find((p) => {
      try { return !p.isClosed() && isReusableBlankUrl(p.url()) } catch { return false }
    })
    page = reusable ?? await _browser.newPage()
  } else {
    page = await _browser.newPage()
  }

  await page.setViewport({ width: 1280, height: 800 })
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/129.0.0.0 Safari/537.36',
  )

  if (blockAssets) {
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const type = req.resourceType()
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        req.abort()
      } else {
        req.continue()
      }
    })
  }

  const showMouseOverlay = opts?.showMouseOverlay ?? true

  // ── Visible-mode cursor tracker ─────────────────────────────────────────────
  // When PUPPETEER_SHOW_MOUSE=true a bright red dot follows the mouse so you
  // can watch exactly what Puppeteer is doing in the browser window.
  if (!HEADLESS && SHOW_MOUSE && showMouseOverlay) {
    // Inject on every navigation (the div is wiped on full page loads)
    page.on('load', () => {
      page.evaluate(() => {
        if (document.getElementById('__pptr_cursor__')) return
        const dot = document.createElement('div')
        dot.id = '__pptr_cursor__'
        dot.style.cssText = [
          'position:fixed',
          'top:0',
          'left:0',
          'width:24px',
          'height:24px',
          'background:rgba(255,30,30,0.75)',
          'border:2px solid #fff',
          'border-radius:50%',
          'pointer-events:none',
          'z-index:2147483647',
          'transform:translate(-50%,-50%)',
          'transition:left 60ms linear,top 60ms linear',
          'box-shadow:0 0 6px rgba(0,0,0,0.5)',
        ].join(';')
        document.body.appendChild(dot)
        document.addEventListener('mousemove', (e) => {
          dot.style.left = e.clientX + 'px'
          dot.style.top  = e.clientY + 'px'
        }, { passive: true })
      }).catch(() => { /* ignore if page closed */ })
    })
  }

  return page
}

/**
 * Manual auth page: dedicated headed browser used for human login flows.
 * This is intentionally separate from the scrape browser so scraping can
 * stay headless while auth remains visible.
 */
export async function getAuthBrowserPage(
  opts?: { showMouseOverlay?: boolean; reuseBlankPage?: boolean },
): Promise<Page> {
  if (!_authBrowser || !_authBrowser.connected) {
    _authBrowser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1280,800',
      ],
    })
  }

  let page: Page
  if (opts?.reuseBlankPage) {
    const pages = await _authBrowser.pages()
    const reusable = pages.find((p) => {
      try { return !p.isClosed() && isReusableBlankUrl(p.url()) } catch { return false }
    })
    page = reusable ?? await _authBrowser.newPage()
  } else {
    page = await _authBrowser.newPage()
  }

  await page.setViewport({ width: 1280, height: 800 })
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/129.0.0.0 Safari/537.36',
  )

  const showMouseOverlay = opts?.showMouseOverlay ?? false
  if (SHOW_MOUSE && showMouseOverlay) {
    page.on('load', () => {
      page.evaluate(() => {
        if (document.getElementById('__pptr_cursor__')) return
        const dot = document.createElement('div')
        dot.id = '__pptr_cursor__'
        dot.style.cssText = [
          'position:fixed',
          'top:0',
          'left:0',
          'width:24px',
          'height:24px',
          'background:rgba(255,30,30,0.75)',
          'border:2px solid #fff',
          'border-radius:50%',
          'pointer-events:none',
          'z-index:2147483647',
          'transform:translate(-50%,-50%)',
          'transition:left 60ms linear,top 60ms linear',
          'box-shadow:0 0 6px rgba(0,0,0,0.5)',
        ].join(';')
        document.body.appendChild(dot)
        document.addEventListener('mousemove', (e) => {
          dot.style.left = e.clientX + 'px'
          dot.style.top = e.clientY + 'px'
        }, { passive: true })
      }).catch(() => undefined)
    })
  }

  return page
}

/** Graceful shutdown — call on SIGINT / SIGTERM. */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close()
    _browser = null
  }
  if (_authBrowser) {
    await _authBrowser.close()
    _authBrowser = null
  }
}

/** Closes only the shared scrape browser (keeps auth browser intact). */
export async function closeScrapeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close()
    _browser = null
  }
}

/** Sleep helper */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Random jitter delay between min and max ms */
export function jitter(min = 800, max = 2000): Promise<void> {
  return sleep(min + Math.random() * (max - min))
}
