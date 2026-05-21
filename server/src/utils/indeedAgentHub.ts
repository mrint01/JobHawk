import type { WebSocket } from 'ws'
import { nanoid } from './nanoid'
import type { ScrapedJob, ProgressCallback } from '../scrapers/types'
import { updateJobDescriptionByUrl } from './jobStore'

interface IndeedAgentConnection {
  ws: WebSocket
  hasSession: boolean
  connectedAt: Date
  lastSeen: Date
  version: string
}

interface PendingScrape {
  resolve: (jobs: ScrapedJob[]) => void
  onProgress: ProgressCallback
  timer: ReturnType<typeof setTimeout>
}

interface PendingSessionCheck {
  resolve: (status: IndeedAgentStatus) => void
  timer: ReturnType<typeof setTimeout>
}

let agent: IndeedAgentConnection | null = null
const pendingScrapes = new Map<string, PendingScrape>()
const pendingEnrichments = new Map<string, string>() // requestId → userId
let pendingSessionCheck: PendingSessionCheck | null = null

export interface IndeedAgentStatus {
  connected: boolean
  hasSession: boolean
}

export function registerIndeedAgent(ws: WebSocket, hasSession: boolean, version: string) {
  agent = { ws, hasSession, connectedAt: new Date(), lastSeen: new Date(), version }
  console.log(`[indeed-agent] connected: hasSession=${hasSession} v=${version}`)
}

export function unregisterIndeedAgent(ws?: WebSocket) {
  if (ws && agent && agent.ws !== ws) return
  agent = null
  if (pendingSessionCheck) {
    clearTimeout(pendingSessionCheck.timer)
    pendingSessionCheck.resolve({ connected: false, hasSession: false })
    pendingSessionCheck = null
  }
  for (const [reqId, pending] of pendingScrapes) {
    clearTimeout(pending.timer)
    pending.onProgress({ type: 'error', platform: 'indeed', error: 'Indeed agent disconnected during scrape.' })
    pending.resolve([])
    pendingScrapes.delete(reqId)
  }
  console.log('[indeed-agent] disconnected')
}

export function getIndeedAgentStatus(): IndeedAgentStatus {
  if (!agent) return { connected: false, hasSession: false }
  return { connected: true, hasSession: agent.hasSession }
}

export function isIndeedAgentReady(): boolean {
  return !!(agent && agent.hasSession)
}

export function requestIndeedAgentSessionCheck(timeoutMs = 8_000): Promise<IndeedAgentStatus> {
  if (!agent) return Promise.resolve({ connected: false, hasSession: false })

  if (pendingSessionCheck) {
    clearTimeout(pendingSessionCheck.timer)
    pendingSessionCheck.resolve(getIndeedAgentStatus())
    pendingSessionCheck = null
  }

  return new Promise<IndeedAgentStatus>((resolve) => {
    const timer = setTimeout(() => {
      pendingSessionCheck = null
      resolve(getIndeedAgentStatus())
    }, timeoutMs)

    pendingSessionCheck = { resolve, timer }
    try {
      agent!.ws.send(JSON.stringify({ type: 'check_session' }))
    } catch {
      clearTimeout(timer)
      pendingSessionCheck = null
      resolve(getIndeedAgentStatus())
    }
  })
}

export async function waitForIndeedAgentConnection(timeoutMs = 20_000, pollMs = 1_000): Promise<IndeedAgentStatus> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (agent) return getIndeedAgentStatus()
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
  }
  return getIndeedAgentStatus()
}

export function dispatchIndeedScrapeToAgent(
  params: { keywords: string; location: string; maxJobs: number },
  onProgress: ProgressCallback,
): Promise<ScrapedJob[]> {
  if (!agent || !agent.hasSession) {
    onProgress({
      type: 'error',
      platform: 'indeed',
      error: agent
        ? 'Indeed agent is connected but not logged in. Restart jobhawk_agent.py and log in to Indeed.'
        : 'Indeed agent not connected. Run jobhawk_agent.py locally, then enable Indeed in Settings.',
    })
    return Promise.resolve([])
  }

  const requestId = nanoid()

  return new Promise<ScrapedJob[]>((resolve) => {
    const timer = setTimeout(() => {
      pendingScrapes.delete(requestId)
      onProgress({ type: 'error', platform: 'indeed', error: 'Indeed agent scrape timed out (10 min).' })
      resolve([])
    }, 10 * 60_000)

    pendingScrapes.set(requestId, { resolve, onProgress, timer })
    agent!.ws.send(JSON.stringify({ type: 'scrape_start', requestId, params }))
    onProgress({ type: 'progress', platform: 'indeed', progress: 5 })
  })
}

export function sendDescribeIndeedJobs(jobs: { url: string }[], userId: string): void {
  if (!agent || !agent.hasSession) return
  const requestId = nanoid()
  pendingEnrichments.set(requestId, userId)
  agent.ws.send(JSON.stringify({
    type: 'describe_jobs',
    requestId,
    jobs,
    ttl: 90 * 60,
  }))
  setTimeout(() => pendingEnrichments.delete(requestId), 90 * 60 * 1000)
}

export function handleIndeedAgentMessage(ws: WebSocket, raw: string) {
  if (!agent || agent.ws !== ws) return
  let data: Record<string, unknown>
  try { data = JSON.parse(raw) } catch { return }

  if (agent) agent.lastSeen = new Date()

  switch (data.type) {
    case 'pong':
      break

    case 'session_status':
      if (agent) agent.hasSession = Boolean(data.hasSession)
      if (pendingSessionCheck) {
        clearTimeout(pendingSessionCheck.timer)
        pendingSessionCheck.resolve(getIndeedAgentStatus())
        pendingSessionCheck = null
      }
      break

    case 'scrape_progress': {
      const p = pendingScrapes.get(String(data.requestId ?? ''))
      if (p) p.onProgress({ type: 'progress', platform: 'indeed', progress: Number(data.progress ?? 50) })
      break
    }

    case 'scrape_result': {
      const p = pendingScrapes.get(String(data.requestId ?? ''))
      if (p) {
        clearTimeout(p.timer)
        pendingScrapes.delete(String(data.requestId))
        p.onProgress({ type: 'progress', platform: 'indeed', progress: 100 })
        p.resolve((data.jobs as ScrapedJob[]) ?? [])
      }
      break
    }

    case 'scrape_error': {
      const p = pendingScrapes.get(String(data.requestId ?? ''))
      if (p) {
        clearTimeout(p.timer)
        pendingScrapes.delete(String(data.requestId))
        p.onProgress({ type: 'error', platform: 'indeed', error: String(data.error ?? 'Unknown error') })
        p.resolve([])
      }
      break
    }

    case 'description_update': {
      const requestId = String(data.requestId ?? '')
      const url = String(data.url ?? '')
      const description = String(data.description ?? '')
      const userId = pendingEnrichments.get(requestId)
      if (userId && url && description) {
        updateJobDescriptionByUrl(userId, url, description).catch(console.error)
      }
      break
    }
  }
}
