/**
 * LinkedIn scraper — uses the Voyager API (pure HTTP, no Puppeteer).
 *
 * The li_at token is stored in the in-memory session (loaded from
 * data/linkedin-session.json on server startup, or after the user
 * runs scripts/linkedin-capture.ts and clicks Connect).
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
      error: 'LinkedIn is not connected. Go to Settings → Connect.',
    })
    return []
  }

  // li_at is stored as a single cookie in the session
  const liAt = (session.cookies as Array<{ name: string; value: string }>)
    .find((c) => c.name === 'li_at')?.value

  if (!liAt) {
    clearSession('linkedin')
    onProgress({
      type: 'error',
      platform: 'linkedin',
      error: 'LinkedIn session is missing the token. Click Connect in Settings to refresh.',
    })
    return []
  }

  onProgress({ type: 'progress', platform: 'linkedin', progress: 5 })

  const { jobs, error, code } = await scrapeLinkedInViaApi(
    liAt,
    jobTitle,
    location,
    (pct) => onProgress({ type: 'progress', platform: 'linkedin', progress: pct }),
  )

  if (error) {
    if (code === 'UNAUTHORIZED') {
      clearSession('linkedin')
    }
    onProgress({ type: 'error', platform: 'linkedin', error })
    return []
  }

  onProgress({ type: 'progress', platform: 'linkedin', progress: 100 })
  return limitScrapedJobs(jobs)
}
