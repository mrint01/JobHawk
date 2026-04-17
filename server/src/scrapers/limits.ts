import type { ScrapedJob } from './types'

/**
 * How many jobs to keep per platform per scrape. The site may render more rows in the DOM
 * (virtual lists, lazy load, how far the list scrolled before extract); capping makes counts stable.
 */
export const SCRAPE_JOBS_PER_PLATFORM_LIMIT = 25

/** Newest first by postedDate, then take the first N (invalid dates sort last). */
export function limitScrapedJobs(jobs: ScrapedJob[]): ScrapedJob[] {
  if (jobs.length <= SCRAPE_JOBS_PER_PLATFORM_LIMIT) {
    return [...jobs].sort((a, b) => dateSortKey(b.postedDate) - dateSortKey(a.postedDate))
  }
  return [...jobs]
    .sort((a, b) => dateSortKey(b.postedDate) - dateSortKey(a.postedDate))
    .slice(0, SCRAPE_JOBS_PER_PLATFORM_LIMIT)
}

function dateSortKey(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}
