/**
 * Per-user, disk-persisted session store for platform cookies.
 *
 * Sessions are keyed by `${userId}:${platform}` in memory and persisted
 * to server/data/sessions.json so connections survive server restarts.
 */
import fs from 'fs'
import path from 'path'
import type { Protocol } from 'puppeteer'

export type PlatformSession = {
  cookies: Protocol.Network.CookieParam[]
  loggedInAt: Date
  username: string
}

const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json')

// In-memory store keyed by `${userId}:${platform}`
const store = new Map<string, PlatformSession>()

function storeKey(userId: string, platform: string): string {
  return `${userId}:${platform}`
}

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

type SerializedSessions = Record<string, Record<string, {
  cookies: Protocol.Network.CookieParam[]
  loggedInAt: string
  username: string
}>>

function persistToDisk(): void {
  try {
    ensureDir()
    const data: SerializedSessions = {}
    for (const [k, session] of store.entries()) {
      const colonIdx = k.indexOf(':')
      const userId = k.slice(0, colonIdx)
      const platform = k.slice(colonIdx + 1)
      if (!data[userId]) data[userId] = {}
      data[userId][platform] = {
        cookies: session.cookies,
        loggedInAt: session.loggedInAt.toISOString(),
        username: session.username,
      }
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    // non-fatal
  }
}

export function loadSessionsFromDisk(): void {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8')) as SerializedSessions
    for (const [userId, platforms] of Object.entries(data)) {
      for (const [platform, s] of Object.entries(platforms)) {
        store.set(storeKey(userId, platform), {
          cookies: s.cookies,
          loggedInAt: new Date(s.loggedInAt),
          username: s.username,
        })
      }
    }
    console.log(`[sessions] loaded ${store.size} session(s) from disk`)
  } catch {
    // non-fatal
  }
}

export function saveSession(userId: string, platform: string, session: PlatformSession): void {
  store.set(storeKey(userId, platform), session)
  persistToDisk()
}

export function getSession(userId: string, platform: string): PlatformSession | undefined {
  return store.get(storeKey(userId, platform))
}

export function hasSession(userId: string, platform: string): boolean {
  return store.has(storeKey(userId, platform))
}

export function clearSession(userId: string, platform: string): void {
  store.delete(storeKey(userId, platform))
  persistToDisk()
}

/** Returns connected platforms for a single user. */
export function sessionsForUser(userId: string): Record<string, { loggedInAt: string; username: string }> {
  const result: Record<string, { loggedInAt: string; username: string }> = {}
  const prefix = `${userId}:`
  for (const [k, session] of store.entries()) {
    if (!k.startsWith(prefix)) continue
    const platform = k.slice(prefix.length)
    result[platform] = { loggedInAt: session.loggedInAt.toISOString(), username: session.username }
  }
  return result
}

/** Returns all sessions across all users (admin/debug). */
export function allSessions(): Record<string, { loggedInAt: string; username: string }> {
  const result: Record<string, { loggedInAt: string; username: string }> = {}
  for (const [k, session] of store.entries()) {
    result[k] = { loggedInAt: session.loggedInAt.toISOString(), username: session.username }
  }
  return result
}
