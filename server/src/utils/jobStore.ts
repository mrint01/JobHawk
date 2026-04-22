import { supabase } from './supabase'
import type { Job, ScrapedJob } from '../scrapers/types'

function normalizeUrl(url: string): string {
  const linkedInMatch = url.match(/https:\/\/www\.linkedin\.com\/jobs\/view\/(\d+)/)
  if (linkedInMatch) return `https://www.linkedin.com/jobs/view/${linkedInMatch[1]}/`
  try { return new URL(url).origin + new URL(url).pathname } catch { return url }
}

export async function readJobsForUser(userId: string): Promise<Job[]> {
  const { data } = await supabase
    .from('jobs')
    .select('*')
    .eq('user_id', userId)
    .order('posted_date', { ascending: false, nullsFirst: false })
  return (data ?? []).map(dbRowToJob)
}

function safeDate(val: string | undefined | null): string | null {
  if (!val) return null
  const d = new Date(val)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export async function mergeJobsForUser(userId: string, incoming: ScrapedJob[]): Promise<Job[]> {
  const { data: existing } = await supabase.from('jobs').select('*').eq('user_id', userId)
  const existingJobs = (existing ?? []).map(dbRowToJob)
  const map = new Map(existingJobs.map((j) => [normalizeUrl(j.url), j]))

  // Deduplicate incoming by normalized URL — scrapers sometimes return the same job twice
  const deduped = Array.from(
    new Map(incoming.map((j) => [normalizeUrl(j.url), j])).values()
  )

  const upserts: Record<string, unknown>[] = []
  for (const job of deduped) {
    const key = normalizeUrl(job.url)
    const existingJob = map.get(key)
    if (!existingJob) {
      upserts.push({
        user_id: userId,
        title: job.title,
        company: job.company,
        location: job.location || null,
        platform: job.platform,
        url: key,
        posted_date: safeDate(job.postedDate),
        description: job.description || null,
        salary: job.salary || null,
        job_type: job.jobType || null,
        scraped_at: new Date().toISOString(),
        status: 'new',
        applied_at: null,
      })
    } else {
      upserts.push({
        id: existingJob.id,
        user_id: userId,
        title: job.title,
        company: job.company,
        location: job.location || null,
        platform: job.platform,
        url: key,
        posted_date: safeDate(job.postedDate),
        description: job.description || null,
        salary: job.salary || null,
        job_type: job.jobType || null,
        scraped_at: new Date().toISOString(),
        status: existingJob.status,
        applied_at: existingJob.appliedAt || null,
      })
    }
  }

  if (upserts.length > 0) {
    const { error } = await supabase.from('jobs').upsert(upserts, { onConflict: 'user_id,url' })
    if (error) {
      console.error('[jobStore] upsert failed:', error.message, error.details)
      throw new Error(`Failed to save jobs: ${error.message}`)
    }
    console.log(`[jobStore] saved ${upserts.length} jobs for user ${userId}`)
  }

  return readJobsForUser(userId)
}

export async function markAppliedForUser(userId: string, id: string): Promise<Job[]> {
  await supabase
    .from('jobs')
    .update({ status: 'applied', applied_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
  return readJobsForUser(userId)
}

export async function markUnappliedForUser(userId: string, id: string): Promise<Job[]> {
  await supabase
    .from('jobs')
    .update({ status: 'new', applied_at: null })
    .eq('id', id)
    .eq('user_id', userId)
  return readJobsForUser(userId)
}

export async function clearJobsForUser(userId: string): Promise<void> {
  await supabase.from('jobs').delete().eq('user_id', userId)
}

export async function clearNewJobOffersForUser(userId: string): Promise<Job[]> {
  await supabase.from('jobs').delete().eq('user_id', userId).eq('status', 'new')
  return readJobsForUser(userId)
}

export async function deleteJobForUser(userId: string, id: string): Promise<Job[]> {
  await supabase.from('jobs').delete().eq('id', id).eq('user_id', userId)
  return readJobsForUser(userId)
}

export interface AnalyticsBucket {
  date: string
  appliedCount: number
}

export async function analyticsByUser(userId: string, from: Date): Promise<AnalyticsBucket[]> {
  const { data } = await supabase
    .from('jobs')
    .select('applied_at')
    .eq('user_id', userId)
    .eq('status', 'applied')
    .gte('applied_at', from.toISOString())
  return buildBuckets((data ?? []).map((r) => r.applied_at as string))
}

export async function analyticsAllUsersSeries(from: Date): Promise<AnalyticsBucket[]> {
  const { data } = await supabase
    .from('jobs')
    .select('applied_at')
    .eq('status', 'applied')
    .gte('applied_at', from.toISOString())
  return buildBuckets((data ?? []).map((r) => r.applied_at as string))
}

export async function analyticsAllUsers(
  from: Date,
): Promise<Array<{ userId: string; username: string; appliedCount: number }>> {
  const [{ data: jobs }, { data: users }] = await Promise.all([
    supabase.from('jobs').select('user_id').eq('status', 'applied').gte('applied_at', from.toISOString()),
    supabase.from('users').select('id, username'),
  ])
  const counts = new Map<string, number>()
  for (const j of jobs ?? []) counts.set(j.user_id, (counts.get(j.user_id) ?? 0) + 1)
  return (users ?? []).map((u) => ({ userId: u.id, username: u.username, appliedCount: counts.get(u.id) ?? 0 }))
}

function buildBuckets(appliedAts: string[]): AnalyticsBucket[] {
  const buckets = new Map<string, number>()
  for (const ts of appliedAts) {
    const day = ts.slice(0, 10)
    buckets.set(day, (buckets.get(day) ?? 0) + 1)
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, appliedCount]) => ({ date, appliedCount }))
}

function dbRowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    company: row.company as string,
    location: (row.location as string) ?? '',
    platform: row.platform as Job['platform'],
    url: row.url as string,
    postedDate: (row.posted_date as string) ?? '',
    description: row.description as string | undefined,
    salary: row.salary as string | undefined,
    jobType: row.job_type as string | undefined,
    scrapedAt: row.scraped_at as string,
    status: row.status as Job['status'],
    appliedAt: row.applied_at as string | undefined,
  }
}
