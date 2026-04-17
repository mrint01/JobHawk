/**
 * StepStone scraper
 *
 * Real scraping requires a server-side CORS proxy because browsers block
 * cross-origin requests to stepstone.de.
 *
 * Architecture when proxy is ready:
 *   GET /proxy?url=https://www.stepstone.de/jobs/{title}/in-{location}.html
 *   → parse HTML with DOMParser
 *   → extract job cards (article[data-at="job-item"])
 *
 * For now we simulate with realistic mock data.
 */
import type { Job, ScrapeParams } from '../../types'
import { generateMockJobs } from './mock-data'

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function scrapeStepStone(
  params: ScrapeParams,
  onProgress?: (pct: number) => void,
): Promise<Job[]> {
  onProgress?.(15)
  await delay(500)
  onProgress?.(50)
  await delay(600)
  onProgress?.(80)
  await delay(400)

  const jobs = generateMockJobs('stepstone', params.jobTitle, params.location, 9)

  onProgress?.(100)
  return jobs
}
