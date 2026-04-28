/**
 * Thin wrapper around fetch for all API calls to the backend.
 * In dev: Vite proxies /api → localhost:3001
 * In prod: VITE_API_URL is set to the Railway backend URL
 */
import type { Job, JobStatus } from '../types'

export const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export type PlatformId = 'linkedin' | 'stepstone' | 'xing' | 'indeed' | 'jobriver'

export interface ConnectResult {
  ok: boolean
  username?: string
  error?: string
  requiresLinkedInCookie?: boolean
  noSession?: boolean   // LinkedIn: no session file on server
  expired?: boolean     // LinkedIn: session file exists but expired/rejected
}

export interface HealthResult {
  online: boolean
  connectedPlatforms: PlatformId[]
  authMode: 'manual' | 'headless'
}

export interface ConnectPayload {
  email?: string
  password?: string
  token?: string
}

export interface AuthUser {
  id: string
  username: string
  email: string
  role: 'admin' | 'user'
  status: 'active' | 'disabled'
}

function userHeaders(userId?: string): HeadersInit {
  return userId ? { 'x-user-id': userId } : {}
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function fetchHealth(userId?: string): Promise<HealthResult> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000), headers: userHeaders(userId) })
    if (!res.ok) return { online: false, connectedPlatforms: [], authMode: 'manual' }
    const data = await res.json() as { connectedPlatforms?: PlatformId[]; authMode?: 'manual' | 'headless' }
    return {
      online: true,
      connectedPlatforms: data.connectedPlatforms ?? [],
      authMode: data.authMode ?? 'manual',
    }
  } catch {
    return { online: false, connectedPlatforms: [], authMode: 'manual' }
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function connectPlatformApi(
  platform: PlatformId,
  payload?: ConnectPayload,
  userId?: string,
): Promise<ConnectResult> {
  try {
    const res = await fetch(`${BASE}/api/auth/${platform}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userHeaders(userId) },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(15 * 60_000), // allow manual login flow
    })
    return await res.json() as ConnectResult
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function disconnectPlatformApi(platform: PlatformId, userId?: string): Promise<void> {
  await fetch(`${BASE}/api/auth/${platform}/disconnect`, { method: 'POST', headers: userHeaders(userId) }).catch(() => undefined)
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

/** Returns null when the request failed (do not treat as “zero jobs” and wipe UI). */
export async function fetchJobsApi(userId?: string): Promise<Job[] | null> {
  try {
    const res = await fetch(`${BASE}/api/jobs`, { headers: userHeaders(userId) })
    if (!res.ok) return null
    return await res.json() as Job[]
  } catch {
    return null
  }
}

export async function markJobAppliedApi(id: string, userId?: string): Promise<Job[]> {
  try {
    const res = await fetch(`${BASE}/api/jobs/${id}/apply`, { method: 'PATCH', headers: userHeaders(userId) })
    if (!res.ok) return []
    return await res.json() as Job[]
  } catch {
    return []
  }
}

export async function markJobUnappliedApi(id: string, userId?: string): Promise<Job[]> {
  try {
    const res = await fetch(`${BASE}/api/jobs/${id}/unapply`, { method: 'PATCH', headers: userHeaders(userId) })
    if (!res.ok) return []
    return await res.json() as Job[]
  } catch {
    return []
  }
}

export async function updateJobStatusApi(id: string, status: JobStatus, userId?: string): Promise<Job[]> {
  try {
    const res = await fetch(`${BASE}/api/jobs/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...userHeaders(userId) },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) return []
    return await res.json() as Job[]
  } catch {
    return []
  }
}

export async function clearJobsApi(userId?: string): Promise<void> {
  await fetch(`${BASE}/api/jobs`, { method: 'DELETE', headers: userHeaders(userId) }).catch(() => undefined)
}

/** Deletes open offers only; returns updated job list or null on failure. */
export async function clearJobOffersApi(userId?: string): Promise<Job[] | null> {
  try {
    const res = await fetch(`${BASE}/api/jobs/offers`, { method: 'DELETE', headers: userHeaders(userId) })
    if (!res.ok) return null
    return await res.json() as Job[]
  } catch {
    return null
  }
}

export async function deleteJobApi(id: string, userId?: string): Promise<Job[] | null> {
  try {
    const res = await fetch(`${BASE}/api/jobs/${id}`, { method: 'DELETE', headers: userHeaders(userId) })
    if (!res.ok) return null
    return await res.json() as Job[]
  } catch {
    return null
  }
}

export async function loginApi(usernameOrEmail: string, password: string): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  try {
    const res = await fetch(`${BASE}/api/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail, password }),
    })
    return await res.json() as { ok: boolean; user?: AuthUser; error?: string }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

export async function signupApi(username: string, email: string, password: string): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  try {
    const res = await fetch(`${BASE}/api/users/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    })
    return await res.json() as { ok: boolean; user?: AuthUser; error?: string }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

export async function changePasswordApi(userId: string, currentPassword: string, nextPassword: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/users/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userHeaders(userId) },
      body: JSON.stringify({ currentPassword, nextPassword }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchUsersApi(adminId?: string): Promise<AuthUser[]> {
  try {
    const res = await fetch(`${BASE}/api/users`, { headers: userHeaders(adminId) })
    if (!res.ok) return []
    return await res.json() as AuthUser[]
  } catch {
    return []
  }
}

export async function deleteUserApi(id: string, adminId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/users/${id}`, {
      method: 'DELETE',
      headers: userHeaders(adminId),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function setUserStatusApi(id: string, status: 'active' | 'disabled', adminId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/users/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...userHeaders(adminId) },
      body: JSON.stringify({ status }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function fetchAnalyticsSeriesApi(userId: string, from: string, targetUserId?: string): Promise<Array<{ date: string; appliedCount: number }>> {
  try {
    const params = new URLSearchParams({ from })
    if (targetUserId) params.set('targetUserId', targetUserId)
    const res = await fetch(`${BASE}/api/jobs/analytics/series?${params}`, {
      headers: userHeaders(userId),
    })
    if (!res.ok) return []
    return await res.json() as Array<{ date: string; appliedCount: number }>
  } catch {
    return []
  }
}

export async function fetchAnalyticsUsersApi(userId: string, from: string, to?: string): Promise<Array<{ userId: string; username: string; appliedCount: number }>> {
  try {
    const params = new URLSearchParams({ from })
    if (to) params.set('to', to)
    const res = await fetch(`${BASE}/api/jobs/analytics/users?${params}`, {
      headers: userHeaders(userId),
    })
    if (!res.ok) return []
    return await res.json() as Array<{ userId: string; username: string; appliedCount: number }>
  } catch {
    return []
  }
}

export interface LinkedInAgentStatus {
  connected: boolean
  hasSession: boolean
  username: string
}

export async function fetchLinkedInAgentStatus(userId: string): Promise<LinkedInAgentStatus> {
  try {
    const res = await fetch(`${BASE}/api/linkedin/agent-status`, { headers: userHeaders(userId) })
    if (!res.ok) return { connected: false, hasSession: false, username: '' }
    return await res.json() as LinkedInAgentStatus
  } catch {
    return { connected: false, hasSession: false, username: '' }
  }
}

export async function checkLinkedInAgentSession(userId: string): Promise<LinkedInAgentStatus> {
  try {
    const res = await fetch(`${BASE}/api/linkedin/agent/check-session`, {
      method: 'POST',
      headers: userHeaders(userId),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { connected: false, hasSession: false, username: '' }
    return await res.json() as LinkedInAgentStatus
  } catch {
    return { connected: false, hasSession: false, username: '' }
  }
}

export async function wakeAndCheckLinkedInAgent(userId: string): Promise<LinkedInAgentStatus> {
  try {
    const res = await fetch(`${BASE}/api/linkedin/agent/wake-check`, {
      method: 'POST',
      headers: userHeaders(userId),
      signal: AbortSignal.timeout(40_000),
    })
    if (!res.ok) return { connected: false, hasSession: false, username: '' }
    return await res.json() as LinkedInAgentStatus
  } catch {
    return { connected: false, hasSession: false, username: '' }
  }
}

export function getLinkedInAgentDownloadUrl(): string {
  return `${BASE}/api/linkedin/agent/download`
}
