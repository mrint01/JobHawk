/**
 * File-based LinkedIn session persistence for the Playwright Firefox scrape browser.
 *
 * Python/Selenium cookies must never be replayed here — only jars produced by
 * this same Firefox profile (materializeLinkedInSessionFromLiAt, or post-scrape persist).
 */
import fs from 'fs'
import path from 'path'
import type { Protocol } from 'puppeteer'
import { sanitizeLinkedInCookiesForReplay } from './linkedinCookies'

const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const FILE_PATH = path.join(DATA_DIR, 'linkedin-session.json')

const SESSION_TTL_MS = 330 * 24 * 60 * 60 * 1000

export type LinkedInCookieFileEntry = {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  /** CDP cookie expiry, Unix seconds */
  expires?: number
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export interface LinkedInSessionFile {
  liAt: string
  capturedAt: string
  username: string
  /** Written only by server-side Puppeteer (jarVersion >= 2). */
  jarVersion?: number
  puppeteerCookies?: LinkedInCookieFileEntry[]
}

/** @deprecated Alias for legacy typings — do not use for new data */
export type LinkedInCookieEntry = LinkedInCookieFileEntry

export function puppeteerCookiesToFileEntries(cookies: Protocol.Network.CookieParam[]): LinkedInCookieFileEntry[] {
  const out: LinkedInCookieFileEntry[] = []
  for (const c of cookies) {
    if (!c?.name || c.value == null) continue
    const e: LinkedInCookieFileEntry = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
    }
    if (typeof c.expires === 'number' && c.expires > 0) e.expires = c.expires
    if (c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None') e.sameSite = c.sameSite
    out.push(e)
  }
  return out
}

function fileEntriesToProtocol(entries: LinkedInCookieFileEntry[]): Protocol.Network.CookieParam[] {
  const raw: Protocol.Network.CookieParam[] = entries.map((e) => {
    const c: Protocol.Network.CookieParam = {
      name: e.name,
      value: e.value,
      domain: e.domain && e.domain.includes('linkedin') ? e.domain : '.linkedin.com',
      path: e.path && e.path.length > 0 ? e.path : '/',
      secure: e.secure !== false,
      httpOnly: !!e.httpOnly,
    }
    if (typeof e.expires === 'number' && e.expires > 0) c.expires = e.expires
    if (e.sameSite === 'Strict' || e.sameSite === 'Lax' || e.sameSite === 'None') c.sameSite = e.sameSite
    return c
  })
  return sanitizeLinkedInCookiesForReplay(raw)
}

/**
 * Build the cookie jar for Puppeteer from the session file.
 * Prefer a full jar materialized in Chromium; otherwise fall back to li_at only.
 */
export function sessionFileToPuppeteerCookies(file: LinkedInSessionFile): Protocol.Network.CookieParam[] {
  const jar = file.puppeteerCookies
  if (file.jarVersion && file.jarVersion >= 2 && jar && jar.length > 0) {
    return fileEntriesToProtocol(jar)
  }
  if (jar && jar.length > 0) {
    return fileEntriesToProtocol(jar)
  }

  const token = typeof file.liAt === 'string' ? file.liAt.trim() : ''
  if (!token) return []
  return [
    {
      name: 'li_at',
      value: token,
      domain: '.linkedin.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]
}

export function readLinkedInSessionFile(): LinkedInSessionFile | null {
  try {
    if (!fs.existsSync(FILE_PATH)) return null
    const parsed = JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8')) as LinkedInSessionFile
    if (!parsed?.liAt) return null
    return parsed
  } catch {
    return null
  }
}

export function writeLinkedInSessionFile(data: LinkedInSessionFile): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

export function deleteLinkedInSessionFile(): void {
  try {
    if (fs.existsSync(FILE_PATH)) fs.unlinkSync(FILE_PATH)
  } catch {
    /* ignore */
  }
}

export function isLinkedInSessionExpired(session: LinkedInSessionFile): boolean {
  const capturedAt = new Date(session.capturedAt).getTime()
  if (isNaN(capturedAt)) return true
  return Date.now() > capturedAt + SESSION_TTL_MS
}

export function sessionNeedsPuppeteerMaterialization(file: LinkedInSessionFile | null): boolean {
  if (!file?.liAt?.trim()) return false
  const jar = file.puppeteerCookies
  return !file.jarVersion || file.jarVersion < 2 || !jar || jar.length === 0
}
