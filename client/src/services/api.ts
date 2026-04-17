/**
 * Thin wrapper around fetch for all API calls to the backend.
 * In dev: Vite proxies /api → localhost:3001
 * In prod: VITE_API_URL is set to the Railway backend URL
 */
import type { Job } from '../types'

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export type PlatformId = 'linkedin' | 'stepstone' | 'xing'

export interface ConnectResult {
  ok: boolean
  username?: string
  error?: string
}

export interface HealthResult {
  online: boolean
  connectedPlatforms: PlatformId[]
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<HealthResult> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { online: false, connectedPlatforms: [] }
    const data = await res.json() as { connectedPlatforms?: PlatformId[] }
    return { online: true, connectedPlatforms: data.connectedPlatforms ?? [] }
  } catch {
    return { online: false, connectedPlatforms: [] }
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function connectPlatformApi(
  platform: PlatformId,
  email?: string,
  password?: string,
): Promise<ConnectResult> {
  try {
    const res = await fetch(`${BASE}/api/auth/${platform}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15 * 60_000), // allow manual login flow
    })
    return await res.json() as ConnectResult
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function disconnectPlatformApi(platform: PlatformId): Promise<void> {
  await fetch(`${BASE}/api/auth/${platform}/disconnect`, { method: 'POST' }).catch(() => undefined)
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

/** Returns null when the request failed (do not treat as “zero jobs” and wipe UI). */
export async function fetchJobsApi(): Promise<Job[] | null> {
  try {
    const res = await fetch(`${BASE}/api/jobs`)
    if (!res.ok) return null
    return await res.json() as Job[]
  } catch {
    return null
  }
}

export async function markJobAppliedApi(id: string): Promise<Job[]> {
  try {
    const res = await fetch(`${BASE}/api/jobs/${id}/apply`, { method: 'PATCH' })
    if (!res.ok) return []
    return await res.json() as Job[]
  } catch {
    return []
  }
}

export async function markJobUnappliedApi(id: string): Promise<Job[]> {
  try {
    const res = await fetch(`${BASE}/api/jobs/${id}/unapply`, { method: 'PATCH' })
    if (!res.ok) return []
    return await res.json() as Job[]
  } catch {
    return []
  }
}

export async function clearJobsApi(): Promise<void> {
  await fetch(`${BASE}/api/jobs`, { method: 'DELETE' }).catch(() => undefined)
}

/** Deletes open offers only; returns updated job list or null on failure. */
export async function clearJobOffersApi(): Promise<Job[] | null> {
  try {
    const res = await fetch(`${BASE}/api/jobs/offers`, { method: 'DELETE' })
    if (!res.ok) return null
    return await res.json() as Job[]
  } catch {
    return null
  }
}
