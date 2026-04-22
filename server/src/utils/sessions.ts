import type { Protocol } from 'puppeteer'
import { supabase } from './supabase'

export type PlatformSession = {
  cookies: Protocol.Network.CookieParam[]
  loggedInAt: Date
  username: string
}

// In-memory cache keyed by `${userId}:${platform}` — keeps scraper reads synchronous
const store = new Map<string, PlatformSession>()

function storeKey(userId: string, platform: string): string {
  return `${userId}:${platform}`
}

export async function loadSessionsFromDB(): Promise<void> {
  const { data, error } = await supabase.from('platform_sessions').select('*')
  if (error) {
    console.error('[sessions] Failed to load from DB:', error.message)
    return
  }
  for (const row of data ?? []) {
    store.set(storeKey(row.user_id, row.platform), {
      cookies: row.cookies as Protocol.Network.CookieParam[],
      loggedInAt: new Date(row.logged_in_at),
      username: row.username,
    })
  }
  console.log(`[sessions] loaded ${store.size} session(s) from DB`)
}

export async function saveSession(userId: string, platform: string, session: PlatformSession): Promise<void> {
  store.set(storeKey(userId, platform), session)
  const { error } = await supabase.from('platform_sessions').upsert(
    {
      user_id: userId,
      platform,
      username: session.username,
      cookies: session.cookies,
      logged_in_at: session.loggedInAt.toISOString(),
    },
    { onConflict: 'user_id,platform' },
  )
  if (error) console.error('[sessions] Failed to save to DB:', error.message)
}

export function getSession(userId: string, platform: string): PlatformSession | undefined {
  return store.get(storeKey(userId, platform))
}

export function hasSession(userId: string, platform: string): boolean {
  return store.has(storeKey(userId, platform))
}

export async function clearSession(userId: string, platform: string): Promise<void> {
  store.delete(storeKey(userId, platform))
  const { error } = await supabase
    .from('platform_sessions')
    .delete()
    .eq('user_id', userId)
    .eq('platform', platform)
  if (error) console.error('[sessions] Failed to delete from DB:', error.message)
}

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

export function allSessions(): Record<string, { loggedInAt: string; username: string }> {
  const result: Record<string, { loggedInAt: string; username: string }> = {}
  for (const [k, session] of store.entries()) {
    result[k] = { loggedInAt: session.loggedInAt.toISOString(), username: session.username }
  }
  return result
}
