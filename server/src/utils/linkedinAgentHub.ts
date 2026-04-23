import type { WebSocket } from 'ws'
import { nanoid } from './nanoid'
import type { ScrapedJob, ProgressCallback } from '../scrapers/types'

interface AgentConnection {
  ws: WebSocket
  hasSession: boolean
  username: string
  connectedAt: Date
  lastSeen: Date
  version: string
}

interface PendingScrape {
  resolve: (jobs: ScrapedJob[]) => void
  onProgress: ProgressCallback
  timer: ReturnType<typeof setTimeout>
}

let agent: AgentConnection | null = null
const pendingScrapes = new Map<string, PendingScrape>()

export interface AgentStatus {
  connected: boolean
  hasSession: boolean
  username: string
}

export function registerAgent(ws: WebSocket, hasSession: boolean, username: string, version: string) {
  agent = { ws, hasSession, username, connectedAt: new Date(), lastSeen: new Date(), version }
  console.log(`[linkedin-agent] connected: hasSession=${hasSession} v=${version}`)
}

export function unregisterAgent() {
  agent = null
  for (const [reqId, pending] of pendingScrapes) {
    clearTimeout(pending.timer)
    pending.onProgress({ type: 'error', platform: 'linkedin', error: 'LinkedIn agent disconnected during scrape.' })
    pending.resolve([])
    pendingScrapes.delete(reqId)
  }
  console.log('[linkedin-agent] disconnected')
}

export function getAgentStatus(): AgentStatus {
  if (!agent) return { connected: false, hasSession: false, username: '' }
  return { connected: true, hasSession: agent.hasSession, username: agent.username }
}

export function isAgentReady(): boolean {
  return !!(agent && agent.hasSession)
}

export function dispatchScrapeToAgent(
  params: { keywords: string; location: string; maxJobs: number },
  onProgress: ProgressCallback,
): Promise<ScrapedJob[]> {
  if (!agent || !agent.hasSession) {
    onProgress({ type: 'error', platform: 'linkedin', error: 'LinkedIn agent not connected.' })
    return Promise.resolve([])
  }

  const requestId = nanoid()

  return new Promise<ScrapedJob[]>((resolve) => {
    const timer = setTimeout(() => {
      pendingScrapes.delete(requestId)
      onProgress({ type: 'error', platform: 'linkedin', error: 'LinkedIn agent scrape timed out (10 min).' })
      resolve([])
    }, 10 * 60_000)

    pendingScrapes.set(requestId, { resolve, onProgress, timer })
    agent!.ws.send(JSON.stringify({ type: 'scrape_start', requestId, params }))
    onProgress({ type: 'progress', platform: 'linkedin', progress: 5 })
  })
}

export function handleAgentMessage(raw: string) {
  let data: Record<string, unknown>
  try { data = JSON.parse(raw) } catch { return }

  if (agent) agent.lastSeen = new Date()

  switch (data.type) {
    case 'pong':
      break

    case 'session_status':
      if (agent) {
        agent.hasSession = Boolean(data.hasSession)
        agent.username = String(data.username ?? '')
      }
      break

    case 'scrape_progress': {
      const p = pendingScrapes.get(String(data.requestId ?? ''))
      if (p) p.onProgress({ type: 'progress', platform: 'linkedin', progress: Number(data.progress ?? 50) })
      break
    }

    case 'scrape_result': {
      const p = pendingScrapes.get(String(data.requestId ?? ''))
      if (p) {
        clearTimeout(p.timer)
        pendingScrapes.delete(String(data.requestId))
        p.onProgress({ type: 'progress', platform: 'linkedin', progress: 100 })
        p.resolve((data.jobs as ScrapedJob[]) ?? [])
      }
      break
    }

    case 'scrape_error': {
      const p = pendingScrapes.get(String(data.requestId ?? ''))
      if (p) {
        clearTimeout(p.timer)
        pendingScrapes.delete(String(data.requestId))
        p.onProgress({ type: 'error', platform: 'linkedin', error: String(data.error ?? 'Unknown error') })
        p.resolve([])
      }
      break
    }
  }
}
