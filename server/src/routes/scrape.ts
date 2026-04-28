import { Router, type Request, type Response } from 'express'
import { scrapeStepStone } from '../scrapers/stepstone'
import { scrapeXing } from '../scrapers/xing'
import { scrapeIndeed } from '../scrapers/indeed'
import { scrapeJobriver } from '../scrapers/jobriver'
import type { Platform, ScrapedJob, ScrapeEvent, ProgressCallback } from '../scrapers/types'
import { closeScrapeBrowser } from '../utils/browser'
import { mergeJobsForUser } from '../utils/jobStore'
import { resolveUserId } from '../utils/userStore'
import { isAgentReady, dispatchScrapeToAgent } from '../utils/linkedinAgentHub'

const router = Router()

function getUserId(req: Request): string {
  return resolveUserId(String(req.header('x-user-id') || 'admin'))
}

function parsePlatforms(raw: string | undefined): Platform[] {
  const ALL: Platform[] = ['linkedin', 'stepstone', 'xing', 'indeed', 'jobriver']
  if (!raw) return ALL
  return raw.split(',').filter((p): p is Platform => ALL.includes(p as Platform))
}

type ScraperFn = (title: string, location: string, cb: ProgressCallback, userId: string) => Promise<ScrapedJob[]>

function buildScrapers(platforms: Platform[]): Record<Platform, ScraperFn | null> {
  const linkedinFn: ScraperFn | null = platforms.includes('linkedin')
    ? (title, location, cb) => {
        if (!isAgentReady()) {
          cb({ type: 'error', platform: 'linkedin', error: 'LinkedIn agent is not connected or session expired. Open Settings and click Connect on LinkedIn Agent.' })
          return Promise.resolve([])
        }
        return dispatchScrapeToAgent({ keywords: title, location, maxJobs: 100 }, cb)
      }
    : null

  return {
    linkedin: linkedinFn,
    stepstone: platforms.includes('stepstone') ? scrapeStepStone : null,
    xing: platforms.includes('xing') ? scrapeXing : null,
    indeed: platforms.includes('indeed') ? scrapeIndeed : null,
    jobriver: platforms.includes('jobriver') ? scrapeJobriver : null,
  }
}

router.post('/', async (req: Request, res: Response) => {
  const userId = getUserId(req)
  const { jobTitle, location = '', platforms: rawPlatforms } = req.body as {
    jobTitle?: string
    location?: string
    platforms?: string
  }

  if (!jobTitle?.trim()) {
    res.status(400).json({ error: 'jobTitle is required' })
    return
  }

  const platforms = parsePlatforms(rawPlatforms)
  const scrapers = buildScrapers(platforms)
  const events: ScrapeEvent[] = []
  const allJobs: ScrapedJob[] = []

  try {
    for (const platform of platforms) {
      const fn = scrapers[platform]
      if (!fn) continue
      try {
        const jobs = await fn(jobTitle.trim(), location.trim(), (evt) => events.push(evt), userId)
        allJobs.push(...jobs)
      } catch (err) {
        events.push({ type: 'error', platform, error: err instanceof Error ? err.message : String(err) })
      }
    }
    allJobs.sort((a, b) => new Date(b.postedDate).getTime() - new Date(a.postedDate).getTime())
    const saved = await mergeJobsForUser(userId, allJobs)
    res.json({ jobs: saved, events })
  } finally {
    await closeScrapeBrowser().catch(() => undefined)
  }
})

router.get('/stream', (req: Request, res: Response) => {
  const userId = getUserId(req)
  const { jobTitle, location = '', platforms: rawPlatforms } = req.query as {
    jobTitle?: string
    location?: string
    platforms?: string
  }

  if (!jobTitle?.trim()) {
    res.status(400).json({ error: 'jobTitle is required' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  function send(evt: ScrapeEvent) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`)
  }

  const platforms = parsePlatforms(rawPlatforms)
  const scrapers = buildScrapers(platforms)
  const allJobs: ScrapedJob[] = []

  ;(async () => {
    for (const platform of platforms) {
      const fn = scrapers[platform]
      if (!fn) continue
      try {
        const jobs = await fn(
          jobTitle!.trim(),
          location.trim(),
          (evt) => {
            send(evt)
            if (evt.type === 'jobs') allJobs.push(...(evt.jobs ?? []))
          },
          userId,
        )
        allJobs.push(...jobs)
        send({ type: 'jobs', platform, jobs, progress: 100 })
      } catch (err) {
        send({ type: 'error', platform, error: err instanceof Error ? err.message : String(err) })
      }
    }
  })()
    .then(async () => {
      const saved = await mergeJobsForUser(userId, allJobs)
      send({ type: 'done', jobs: saved, totalJobs: saved.length })
      res.end()
    })
    .finally(async () => {
      await closeScrapeBrowser().catch(() => undefined)
    })
})

export default router
