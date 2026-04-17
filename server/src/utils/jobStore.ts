/**
 * Server-side job persistence — reads and writes server/data/jobs.json.
 *
 * Synchronous fs calls are intentional: this is a single-process personal
 * app with very infrequent writes, so async complexity would add no value.
 */
import fs from 'fs'
import path from 'path'
import type { Job, ScrapedJob } from '../scrapers/types'

const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json')

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function readJobs(): Job[] {
  try {
    ensureDir()
    if (!fs.existsSync(JOBS_FILE)) return []
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8')) as Job[]
  } catch {
    return []
  }
}

function writeJobs(jobs: Job[]): void {
  ensureDir()
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf-8')
}

/** Strip tracking/session params from job URLs so the same job always maps to the same key. */
function normalizeUrl(url: string): string {
  // LinkedIn: /jobs/view/1234567890/?refId=...&trackingId=... → /jobs/view/1234567890/
  const linkedInMatch = url.match(/https:\/\/www\.linkedin\.com\/jobs\/view\/(\d+)/)
  if (linkedInMatch) return `https://www.linkedin.com/jobs/view/${linkedInMatch[1]}/`
  // Generic: strip query string
  try { return new URL(url).origin + new URL(url).pathname } catch { return url }
}

/** Merge newly scraped jobs with persisted ones. Existing statuses are preserved. */
export function mergeJobs(incoming: ScrapedJob[]): Job[] {
  const existing = readJobs()
  // Use normalized URL as the dedup key
  const map = new Map(existing.map((j) => [normalizeUrl(j.url), j]))

  for (const job of incoming) {
    const key = normalizeUrl(job.url)
    const existingJob = map.get(key)
    if (!existingJob) {
      map.set(key, {
        ...job,
        url: key,                            // store the clean URL
        scrapedAt: new Date().toISOString(),
        status: 'new',
      })
    } else {
      // Refresh scrape-derived fields (title/company/location/postedDate/platform)
      // while preserving user workflow fields (status/appliedAt/id).
      map.set(key, {
        ...existingJob,
        ...job,
        id: existingJob.id,
        url: key,
        status: existingJob.status,
        appliedAt: existingJob.appliedAt,
        scrapedAt: new Date().toISOString(),
      })
    }
  }

  const merged = Array.from(map.values()).sort(
    (a, b) => new Date(b.postedDate).getTime() - new Date(a.postedDate).getTime(),
  )
  writeJobs(merged)
  return merged
}

export function markApplied(id: string): Job[] {
  const jobs = readJobs().map((j) =>
    j.id === id ? { ...j, status: 'applied' as const, appliedAt: new Date().toISOString() } : j,
  )
  writeJobs(jobs)
  return jobs
}

export function markUnapplied(id: string): Job[] {
  const jobs = readJobs().map((j) => {
    if (j.id !== id) return j
    const { appliedAt: _removed, ...rest } = j
    return { ...rest, status: 'new' as const }
  })
  writeJobs(jobs)
  return jobs
}

export function clearJobs(): void {
  writeJobs([])
}

/** Remove only open offers (status `new`); keeps applied jobs. */
export function clearNewJobOffers(): Job[] {
  const kept = readJobs().filter((j) => j.status !== 'new')
  writeJobs(kept)
  return kept
}
