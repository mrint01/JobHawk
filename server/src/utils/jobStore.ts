/**
 * Server-side job persistence — reads and writes server/data/jobs.json.
 *
 * Synchronous fs calls are intentional: this is a single-process personal
 * app with very infrequent writes, so async complexity would add no value.
 */
import fs from 'fs'
import path from 'path'
import type { Job, ScrapedJob } from '../scrapers/types'
import { readUsers } from './userStore'

const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json')

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function readJobs(): Job[] {
  try {
    ensureDir()
    if (!fs.existsSync(JOBS_FILE)) return []
    const parsed = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8')) as Array<Job & { userId?: string }>
    return parsed.map((j) => ({ ...j, userId: j.userId ?? 'admin' }))
  } catch {
    return []
  }
}

export function readJobsForUser(userId: string): Job[] {
  return readJobs().filter((j) => j.userId === userId)
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
  return mergeJobsForUser('admin', incoming)
}

export function mergeJobsForUser(userId: string, incoming: ScrapedJob[]): Job[] {
  const existing = readJobs()
  const ownJobs = existing.filter((j) => j.userId === userId)
  const foreignJobs = existing.filter((j) => j.userId !== userId)
  // Use normalized URL as the dedup key per user
  const map = new Map(ownJobs.map((j) => [normalizeUrl(j.url), j]))

  for (const job of incoming) {
    const key = normalizeUrl(job.url)
    const existingJob = map.get(key)
    if (!existingJob) {
      map.set(key, {
        ...job,
        url: key,                            // store the clean URL
        scrapedAt: new Date().toISOString(),
        status: 'new',
        userId,
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
        userId,
      })
    }
  }

  const merged = Array.from(map.values()).sort(
    (a, b) => new Date(b.postedDate).getTime() - new Date(a.postedDate).getTime(),
  )
  const all = [...foreignJobs, ...merged].sort(
    (a, b) => new Date(b.postedDate || b.scrapedAt).getTime() - new Date(a.postedDate || a.scrapedAt).getTime(),
  )
  writeJobs(all)
  return merged
}

export function markApplied(id: string): Job[] {
  return markAppliedForUser('admin', id)
}

export function markAppliedForUser(userId: string, id: string): Job[] {
  const jobs = readJobs().map((j) =>
    j.id === id && j.userId === userId ? { ...j, status: 'applied' as const, appliedAt: new Date().toISOString() } : j,
  )
  writeJobs(jobs)
  return jobs.filter((j) => j.userId === userId)
}

export function markUnapplied(id: string): Job[] {
  return markUnappliedForUser('admin', id)
}

export function markUnappliedForUser(userId: string, id: string): Job[] {
  const jobs = readJobs().map((j) => {
    if (j.id !== id || j.userId !== userId) return j
    const { appliedAt: _removed, ...rest } = j
    return { ...rest, status: 'new' as const }
  })
  writeJobs(jobs)
  return jobs.filter((j) => j.userId === userId)
}

export function clearJobs(): void {
  writeJobs([])
}

/** Remove only open offers (status `new`); keeps applied jobs. */
export function clearNewJobOffers(): Job[] {
  return clearNewJobOffersForUser('admin')
}

export function clearNewJobOffersForUser(userId: string): Job[] {
  const all = readJobs()
  const kept = all.filter((j) => j.userId !== userId || j.status !== 'new')
  writeJobs(kept)
  return kept.filter((j) => j.userId === userId)
}

export function clearJobsForUser(userId: string): void {
  const kept = readJobs().filter((j) => j.userId !== userId)
  writeJobs(kept)
}

export function deleteJobForUser(userId: string, id: string): Job[] {
  const kept = readJobs().filter((j) => !(j.userId === userId && j.id === id))
  writeJobs(kept)
  return kept.filter((j) => j.userId === userId)
}

export interface AnalyticsBucket {
  date: string
  appliedCount: number
}

export function analyticsByUser(userId: string, from: Date): AnalyticsBucket[] {
  const buckets = new Map<string, number>()
  for (const job of readJobsForUser(userId)) {
    if (job.status !== 'applied' || !job.appliedAt) continue
    const ts = new Date(job.appliedAt)
    if (Number.isNaN(ts.getTime()) || ts < from) continue
    const day = ts.toISOString().slice(0, 10)
    buckets.set(day, (buckets.get(day) ?? 0) + 1)
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, appliedCount]) => ({ date, appliedCount }))
}

export function analyticsAllUsersSeries(from: Date): AnalyticsBucket[] {
  const buckets = new Map<string, number>()
  for (const job of readJobs()) {
    if (job.status !== 'applied' || !job.appliedAt) continue
    const ts = new Date(job.appliedAt)
    if (Number.isNaN(ts.getTime()) || ts < from) continue
    const day = ts.toISOString().slice(0, 10)
    buckets.set(day, (buckets.get(day) ?? 0) + 1)
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, appliedCount]) => ({ date, appliedCount }))
}

export function analyticsAllUsers(from: Date): Array<{ userId: string; username: string; appliedCount: number }> {
  const users = readUsers()
  const counts = new Map<string, number>()
  for (const job of readJobs()) {
    if (job.status !== 'applied' || !job.appliedAt) continue
    const ts = new Date(job.appliedAt)
    if (Number.isNaN(ts.getTime()) || ts < from) continue
    counts.set(job.userId, (counts.get(job.userId) ?? 0) + 1)
  }
  return users.map((u) => ({
    userId: u.id,
    username: u.username,
    appliedCount: counts.get(u.id) ?? 0,
  }))
}
