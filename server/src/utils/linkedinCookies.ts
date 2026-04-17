import type { Protocol } from 'puppeteer'

/** Normalize cookie jar for Puppeteer replay (drops Chrome-only fields that break setCookie). */
export function sanitizeLinkedInCookiesForReplay(cookies: Protocol.Network.CookieParam[]): Protocol.Network.CookieParam[] {
  const out: Protocol.Network.CookieParam[] = []
  for (const raw of cookies) {
    if (!raw?.name || raw.value == null) continue
    const c: Protocol.Network.CookieParam = {
      name: raw.name,
      value: raw.value,
      domain: raw.domain && String(raw.domain).includes('linkedin') ? raw.domain : '.linkedin.com',
      path: raw.path && raw.path.length > 0 ? raw.path : '/',
      secure: raw.secure !== false,
      httpOnly: !!raw.httpOnly,
    }
    if (typeof raw.expires === 'number' && raw.expires > 0) c.expires = raw.expires
    if (raw.sameSite === 'Strict' || raw.sameSite === 'Lax' || raw.sameSite === 'None') c.sameSite = raw.sameSite
    out.push(c)
  }
  return out
}

/** Accept raw li_at value or `li_at=...; ...` pasted from DevTools. */
export function parseLiAtTokenInput(rawInput: string): string | null {
  const raw = rawInput.trim()
  const cleanToken = raw.startsWith('li_at=')
    ? raw.slice('li_at='.length).split(';')[0].trim()
    : raw.split(';')[0].trim()
  return cleanToken.length > 0 ? cleanToken : null
}
