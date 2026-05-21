/**
 * Xing login + scrape via Playwright Firefox.
 *
 * Env:
 *   XING_SHOW_MOUSE=true      — slowMo + red cursor + click highlights
 *   PUPPETEER_HEADLESS=false  — visible Firefox window
 */
import { firefox, type Browser, type BrowserContext, type Cookie, type Page } from 'playwright'
import type { Protocol } from 'puppeteer'

export const XING_HEADLESS = process.env.PUPPETEER_HEADLESS !== 'false'
export const XING_SHOW_MOUSE =
  process.env.XING_SHOW_MOUSE === 'true'
  || (process.env.XING_SHOW_MOUSE !== 'false' && process.env.PUPPETEER_SHOW_MOUSE === 'true')

export const XING_AUTH_VIEWPORT = { width: 1280, height: 1100 }

const MOUSE_OVERLAY_INIT = () => {
  if (document.getElementById('__xing_cursor__')) return
  const dot = document.createElement('div')
  dot.id = '__xing_cursor__'
  dot.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'width:28px', 'height:28px',
    'background:rgba(255,30,30,0.85)', 'border:3px solid #fff', 'border-radius:50%',
    'pointer-events:none', 'z-index:2147483647', 'transform:translate(-50%,-50%)',
    'transition:left 80ms linear,top 80ms linear', 'box-shadow:0 0 10px rgba(255,30,30,0.9)',
  ].join(';')
  document.body.appendChild(dot)
  document.addEventListener('mousemove', (e) => {
    dot.style.left = `${e.clientX}px`
    dot.style.top = `${e.clientY}px`
  }, { passive: true })
}

let _browser: Browser | null = null
let _context: BrowserContext | null = null
let _contextLaunching: Promise<BrowserContext> | null = null

async function getOrCreateXingContext(): Promise<BrowserContext> {
  if (_context) return _context
  if (!_contextLaunching) {
    _contextLaunching = (async () => {
      _browser = await firefox.launch({
        headless: XING_HEADLESS,
        slowMo: XING_SHOW_MOUSE && !XING_HEADLESS ? 120 : 0,
        firefoxUserPrefs: { 'dom.webdriver.enabled': false },
      })
      _context = await _browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
        viewport: XING_AUTH_VIEWPORT,
        locale: 'en-US',
        ignoreHTTPSErrors: true,
      })
      await _context.addInitScript(MOUSE_OVERLAY_INIT)
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

export async function getXingFirefoxPage(): Promise<Page> {
  const ctx = await getOrCreateXingContext()
  return ctx.newPage()
}

export async function closeXingFirefoxBrowser(): Promise<void> {
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

export function playwrightCookiesFromProtocol(cookies: Protocol.Network.CookieParam[]): Cookie[] {
  const out: Cookie[] = []
  for (const c of cookies) {
    if (!c?.name || c.value == null) continue
    const domain = c.domain && /xing/i.test(c.domain) ? c.domain : '.xing.com'
    const cookie = {
      name: c.name,
      value: c.value,
      domain,
      path: c.path && c.path.length > 0 ? c.path : '/',
      secure: c.secure !== false,
      httpOnly: !!c.httpOnly,
      ...(typeof c.expires === 'number' && c.expires > 0 ? { expires: c.expires } : {}),
      ...(c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None'
        ? { sameSite: c.sameSite as 'Strict' | 'Lax' | 'None' }
        : {}),
    } as Cookie
    out.push(cookie)
  }
  return out
}

export function protocolCookiesFromPlaywright(cookies: Cookie[]): Protocol.Network.CookieParam[] {
  return cookies
    .filter((c) => /xing/i.test(c.domain || ''))
    .map((c) => {
      const p: Protocol.Network.CookieParam = {
        name: c.name,
        value: c.value,
        domain: c.domain || '.xing.com',
        path: c.path || '/',
        secure: c.secure ?? true,
        httpOnly: !!c.httpOnly,
      }
      if (typeof c.expires === 'number' && c.expires > 0) p.expires = c.expires
      if (c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None') {
        p.sameSite = c.sameSite
      }
      return p
    })
}

export async function highlightXingClickTarget(page: Page, selector: string, label: string): Promise<void> {
  if (!XING_SHOW_MOUSE || XING_HEADLESS) return
  await page.evaluate(
    ({ selector, label }) => {
      const el = document.querySelector(selector)
      if (!el) return
      const r = el.getBoundingClientRect()
      const ring = document.createElement('div')
      ring.style.cssText = [
        'position:fixed', `left:${r.left - 4}px`, `top:${r.top - 4}px`,
        `width:${r.width + 8}px`, `height:${r.height + 8}px`,
        'border:3px solid #ff1e1e', 'border-radius:8px', 'pointer-events:none',
        'z-index:2147483646', 'box-shadow:0 0 12px rgba(255,30,30,0.8)',
      ].join(';')
      const tag = document.createElement('div')
      tag.textContent = label
      tag.style.cssText = [
        'position:fixed', `left:${r.left}px`, `top:${Math.max(0, r.top - 22)}px`,
        'background:#ff1e1e', 'color:#fff', 'font:12px sans-serif', 'padding:2px 6px',
        'border-radius:4px', 'z-index:2147483647', 'pointer-events:none',
      ].join(';')
      document.body.appendChild(ring)
      document.body.appendChild(tag)
      setTimeout(() => {
        ring.remove()
        tag.remove()
      }, 1800)
    },
    { selector, label },
  ).catch(() => undefined)
}
