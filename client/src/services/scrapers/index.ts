/**
 * Client-side scraper orchestrator.
 *
 * Calls the Express backend via Server-Sent Events (SSE) so the UI shows
 * real-time per-platform progress while the server scrapes.
 *
 * Dev:        Vite proxies /api → http://localhost:3001
 * Production: set VITE_API_URL=https://your-api.railway.app in Vercel env vars
 */
import type { Job, ScrapeParams, ScrapeProgress, PlatformProgress, Platform } from '../../types'
import { nanoid } from '../nanoid'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export type ProgressCallback = (progress: ScrapeProgress) => void

const ALL_PLATFORMS: Platform[] = ['linkedin', 'stepstone', 'xing']

function initState(platforms: Platform[]): Record<Platform, PlatformProgress> {
  return {
    linkedin:  { platform: 'linkedin',  status: platforms.includes('linkedin')  ? 'pending' : 'idle', progress: 0, jobsFound: 0 },
    stepstone: { platform: 'stepstone', status: platforms.includes('stepstone') ? 'pending' : 'idle', progress: 0, jobsFound: 0 },
    xing:      { platform: 'xing',      status: platforms.includes('xing')      ? 'pending' : 'idle', progress: 0, jobsFound: 0 },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJob(raw: Record<string, any>): Job {
  return {
    id: (raw.id as string | undefined) ?? nanoid(),
    title: (raw.title as string | undefined) ?? '',
    company: (raw.company as string | undefined) ?? '',
    location: (raw.location as string | undefined) ?? '',
    platform: (raw.platform as Platform | undefined) ?? 'stepstone',
    url: (raw.url as string | undefined) ?? '',
    postedDate: (raw.postedDate as string | undefined) ?? new Date().toISOString(),
    description: raw.description as string | undefined,
    jobType: raw.jobType as string | undefined,
    scrapedAt: new Date().toISOString(),
    status: 'new',
  }
}

export function scrapeAll(
  params: ScrapeParams,
  platforms: Platform[],
  onProgress: ProgressCallback,
): Promise<Job[]> {
  if (platforms.length === 0) return Promise.resolve([])

  return new Promise<Job[]>((resolve, reject) => {
    const state = initState(platforms)
    const startedAt = Date.now()
    const collectedJobs: Job[] = []

    function emit(isRunning: boolean) {
      const active = ALL_PLATFORMS.map((p) => state[p]).filter((p) => p.status !== 'idle')
      const overall =
        active.length > 0
          ? Math.round(active.reduce((s, p) => s + p.progress, 0) / active.length)
          : 0
      const elapsed = (Date.now() - startedAt) / 1000
      const eta = Math.max(0, Math.round((15 - elapsed) * (1 - overall / 100)))
      onProgress({
        isRunning,
        overall,
        estimatedSecondsLeft: eta,
        platforms: ALL_PLATFORMS.map((p) => state[p]),
        startedAt,
      })
    }

    // Server executes scrapers sequentially; keep others pending until their first progress event.
    if (platforms.length > 0) state[platforms[0]].status = 'running'
    emit(true)

    const qs = new URLSearchParams({
      jobTitle: params.jobTitle,
      location: params.location,
      platforms: platforms.join(','),
    })
    const url = `${API_BASE}/api/scrape/stream?${qs}`

    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Server responded ${response.status}`)
        if (!response.body) throw new Error('No response body')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''

          for (const part of parts) {
            const line = part.replace(/^data:\s*/, '').trim()
            if (!line) continue

            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const evt = JSON.parse(line) as Record<string, any>
              const platform = evt.platform as Platform | undefined

              switch (evt.type as string) {
                case 'progress':
                  if (platform) {
                    if (state[platform].status === 'pending') state[platform].status = 'running'
                    state[platform].progress = (evt.progress as number | undefined) ?? state[platform].progress
                    emit(true)
                  }
                  break

                case 'jobs':
                  if (platform) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const incoming = ((evt.jobs as any[] | undefined) ?? []).map(toJob)
                    collectedJobs.push(...incoming)
                    state[platform].status = 'done'
                    state[platform].progress = 100
                    state[platform].jobsFound = incoming.length
                    emit(true)
                  }
                  break

                case 'error':
                  if (platform) {
                    state[platform].status = 'error'
                    state[platform].error = evt.error as string | undefined
                    emit(true)
                  }
                  break

                case 'done': {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const finalJobs = ((evt.jobs as any[] | undefined) ?? collectedJobs).map(toJob)
                  emit(false)
                  resolve(finalJobs)
                  return
                }
              }
            } catch {
              // malformed SSE line — skip
            }
          }
        }

        emit(false)
        resolve(collectedJobs)
      })
      .catch((err: Error) => {
        for (const p of platforms) {
          if (state[p].status === 'running') {
            state[p].status = 'error'
            state[p].error = err.message
          }
        }
        emit(false)
        reject(err)
      })
  })
}
