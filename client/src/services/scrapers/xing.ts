/**
 * Xing scraper
 *
 * Real scraping requires a server-side proxy. Xing's SPA-rendered pages are
 * also harder to parse — their GraphQL API endpoint is preferable.
 *
 * Architecture when proxy is ready:
 *   POST /proxy/xing-graphql
 *   → extract jobSearchResults nodes
 *   → map to Job interface
 *
 * For now we simulate with realistic mock data.
 */
import type { Job, ScrapeParams } from '../../types'
import { generateMockJobs } from './mock-data'

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function scrapeXing(
  params: ScrapeParams,
  onProgress?: (pct: number) => void,
): Promise<Job[]> {
  onProgress?.(20)
  await delay(450)
  onProgress?.(55)
  await delay(500)
  onProgress?.(85)
  await delay(350)

  const jobs = generateMockJobs('xing', params.jobTitle, params.location, 8)

  onProgress?.(100)
  return jobs
}
