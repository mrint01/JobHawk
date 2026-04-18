import type { Cookie } from 'playwright'
import type { Protocol } from 'puppeteer'
import { sanitizeLinkedInCookiesForReplay } from './linkedinCookies'

/** Apply stored session cookies to Playwright (Firefox) — same logical jar as Chromium path. */
export function protocolCookiesToPlaywright(cookies: Protocol.Network.CookieParam[]): Cookie[] {
  const out: Cookie[] = []
  for (const c of cookies) {
    if (!c?.name || c.value == null) continue
    const domain = c.domain && String(c.domain).includes('linkedin') ? c.domain : '.linkedin.com'
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

export function playwrightCookiesToProtocol(cookies: Cookie[]): Protocol.Network.CookieParam[] {
  const raw: Protocol.Network.CookieParam[] = cookies.map((c) => {
    const p: Protocol.Network.CookieParam = {
      name: c.name,
      value: c.value,
      domain: c.domain && c.domain.includes('linkedin') ? c.domain : '.linkedin.com',
      path: c.path && c.path.length > 0 ? c.path : '/',
      secure: c.secure !== false,
      httpOnly: !!c.httpOnly,
    }
    if (typeof c.expires === 'number' && c.expires > 0) p.expires = c.expires
    if (c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None') p.sameSite = c.sameSite
    return p
  })
  return sanitizeLinkedInCookiesForReplay(raw)
}
