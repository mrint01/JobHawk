/**
 * In-memory session store for platform cookies.
 *
 * Cookies are captured once after a successful Puppeteer login and kept for
 * the lifetime of the server process. They are never written to disk.
 *
 * On restart the user must re-connect each platform — this is intentional
 * (no credentials or cookies stored on disk).
 */
import type { Protocol } from 'puppeteer'

export type PlatformSession = {
  cookies: Protocol.Network.CookieParam[]
  loggedInAt: Date
  username: string   // email used — displayed in UI only, never re-used
}

const store = new Map<string, PlatformSession>()

export function saveSession(platform: string, session: PlatformSession): void {
  store.set(platform, session)
}

export function getSession(platform: string): PlatformSession | undefined {
  return store.get(platform)
}

export function hasSession(platform: string): boolean {
  return store.has(platform)
}

export function clearSession(platform: string): void {
  store.delete(platform)
}

export function allSessions(): Record<string, { loggedInAt: string; username: string }> {
  const result: Record<string, { loggedInAt: string; username: string }> = {}
  for (const [platform, session] of store.entries()) {
    result[platform] = {
      loggedInAt: session.loggedInAt.toISOString(),
      username: session.username,
    }
  }
  return result
}
