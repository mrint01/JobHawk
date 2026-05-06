import type { WebSocket } from 'ws'
import { nanoid } from './nanoid'
import type { ScrapedJob, ProgressCallback } from '../scrapers/types'

interface IndeedAgentConnection {
  ws: WebSocket
  connectedAt: Date
  lastSeen: Date
  version: string
}

interface PendingScrape {
  resolve: (jobs: ScrapedJob[]) => void
  onProgress: ProgressCallback
  timer: ReturnType<typeof setTimeout>
}

let agent: IndeedAgentConnection | null = null
const pendingScrapes = new Map<string, PendingScrape>()

export interface IndeedAgentStatus {
  connected: boolean
}

export function registerIndeedAgent(ws: WebSocket, version: string) {
  agent = { ws, connectedAt: new Date(), lastSeen: new Date(), version }
  console.log(`[indeed-agent] connected v=${version}`)
}

export function unregisterIndeedAgent(ws?: WebSocket) {
  if (ws && agent && agent.ws !== ws) return
  agent = null
  for (const [reqId, pending] of pendingScrapes) {
    clearTimeout(pending.timer)
    pending.onProgress({ type: 'error', platform: 'indeed', error: 'Indeed agent disconnected during scrape.' })
    pending.resolve([])
    pendingScrapes.delete(reqId)
  }
  console.log('[indeed-agent] disconnected')
}

export function getIndeedAgentStatus(): IndeedAgentStatus {
  return { connected: !!agent }
}

export function isIndeedAgentReady(): boolean {
  return !!agent
}

export async function waitForIndeedAgentConnection(timeoutMs = 20_000, pollMs = 1_000): Promise<IndeedAgentStatus> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (agent) return { connected: true }
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
  }
  return { connected: !!agent }
}

export function dispatchIndeedScrapeToAgent(
  params: { keywords: string; location: string; maxJobs: number; browser?: string },
  onProgress: ProgressCallback,
): Promise<ScrapedJob[]> {
  if (!agent) {
    onProgress({
      type: 'error',
      platform: 'indeed',
      error: 'Indeed agent not connected. Run jobhawk_agent.py locally, then enable Indeed in Settings.',
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

export function handleIndeedAgentMessage(ws: WebSocket, raw: string) {
  if (!agent || agent.ws !== ws) return
  let data: Record<string, unknown>
  try { data = JSON.parse(raw) } catch { return }

  if (agent) agent.lastSeen = new Date()

  switch (data.type) {
    case 'pong':
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
  }
}
