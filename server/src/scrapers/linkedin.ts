/**
 * LinkedIn scraper — HTTP-only via LinkedIn's internal Voyager API.
 *
 * Why not Puppeteer: Headless Chromium sessions are fingerprinted by LinkedIn's
 * anti-bot system (CDP protocol detection, missing browser APIs, etc.). Once
 * detected, LinkedIn revokes the li_at token server-side, logging the user out
 * everywhere. Plain HTTP fetch() with li_at + a fake JSESSIONID is treated as
 * a normal in-browser XHR call and does NOT trigger token revocation.
 */
import { clearSession, getSession } from '../utils/sessions'
import { scrapeLinkedInViaApi } from '../utils/linkedinApi'
import type { ScrapedJob, ProgressCallback } from './types'
import { limitScrapedJobs } from './limits'

export async function scrapeLinkedIn(
  jobTitle: string,
  location: string,
  onProgress: ProgressCallback,
): Promise<ScrapedJob[]> {
  const session = getSession('linkedin')
  if (!session) {
    onProgress({
      type: 'error',
      platform: 'linkedin',
      error: 'LinkedIn is not connected. Go to Settings → connect with your li_at token.',
    })
    return []
  }

  const liAtCookie = session.cookies.find((c) => c.name === 'li_at')
  if (!liAtCookie?.value) {
    clearSession('linkedin')
    onProgress({
      type: 'error',
      platform: 'linkedin',
      error: 'Stored LinkedIn token is missing. Reconnect LinkedIn in Settings.',
    })
    return []
  }

  onProgress({ type: 'progress', platform: 'linkedin', progress: 10 })

  const { jobs, error, code } = await scrapeLinkedInViaApi(
    liAtCookie.value,
    jobTitle,
    location,
    (pct) => onProgress({ type: 'progress', platform: 'linkedin', progress: pct }),
  )

  if (error) {
    if (code === 'UNAUTHORIZED') {
      clearSession('linkedin')
      onProgress({
        type: 'error',
        platform: 'linkedin',
        error:
          'LinkedIn token has expired. Go to Settings → disconnect → paste a fresh li_at token.',
      })
    } else if (code === 'RATE_LIMITED') {
      onProgress({
        type: 'error',
        platform: 'linkedin',
        error: 'LinkedIn rate limit hit (HTTP 429). Wait 15–30 minutes before scraping again.',
      })
    } else {
      onProgress({ type: 'error', platform: 'linkedin', error })
    }
    return []
  }

  if (jobs.length === 0) {
    onProgress({
      type: 'error',
      platform: 'linkedin',
      error:
        'No jobs found for this search. Try broader keywords or a different location.',
    })
    return []
  }

  onProgress({ type: 'progress', platform: 'linkedin', progress: 100 })
  return limitScrapedJobs(jobs)
}
