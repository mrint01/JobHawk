/**
 * LinkedIn scraper
 *
 * LinkedIn blocks direct browser fetches (CORS + auth).
 * A real implementation requires either:
 *   (a) LinkedIn OAuth token + official Jobs API (requires partner access), OR
 *   (b) A backend proxy that handles the authenticated session.
 *
 * For now we simulate the scraping with realistic mock data.
 * Swap the body of `scrapeLinkedIn` with a real fetch once a proxy is available.
 */
import type { Job, ScrapeParams } from '../../types'
import { generateMockJobs } from './mock-data'

/** Simulates a realistic network delay (ms) */
function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function scrapeLinkedIn(
  params: ScrapeParams,
  onProgress?: (pct: number) => void,
): Promise<Job[]> {
  // Simulate phased progress
  onProgress?.(10)
  await delay(600)
  onProgress?.(35)
  await delay(700)
  onProgress?.(65)
  await delay(600)
  onProgress?.(90)
  await delay(400)

  const jobs = generateMockJobs('linkedin', params.jobTitle, params.location, 10)

  onProgress?.(100)
  return jobs
}
