import { Router, type Request, type Response } from 'express'
import { scrapeStepStone } from '../scrapers/stepstone'
import { scrapeXing } from '../scrapers/xing'
import { scrapeJobriver } from '../scrapers/jobriver'
import type { Platform, ScrapedJob, ScrapeEvent, ProgressCallback } from '../scrapers/types'
import { SCRAPE_JOBS_PER_PLATFORM_LIMIT } from '../scrapers/limits'
import { closeScrapeBrowser } from '../utils/browser'
import { mergeJobsForUser } from '../utils/jobStore'
import { resolveUserId } from '../utils/userStore'
import { isAgentReady, dispatchScrapeToAgent, sendDescribeJobs } from '../utils/linkedinAgentHub'
import { isIndeedAgentReady, dispatchIndeedScrapeToAgent } from '../utils/indeedAgentHub'
import { enrichJobsBackground } from '../utils/descriptionEnricher'

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

function buildScrapers(platforms: Platform[], indeedBrowser?: string): Record<Platform, ScraperFn | null> {
  const linkedinFn: ScraperFn | null = platforms.includes('linkedin')
    ? (title, location, cb) => {
        if (!isAgentReady()) {
          cb({ type: 'error', platform: 'linkedin', error: 'LinkedIn agent is not connected or session expired. Open Settings and click Connect on LinkedIn Agent.' })
          return Promise.resolve([])
        }
        return dispatchScrapeToAgent({ keywords: title, location, maxJobs: SCRAPE_JOBS_PER_PLATFORM_LIMIT }, cb)
      }
    : null

  const indeedFn: ScraperFn | null = platforms.includes('indeed')
    ? (title, location, cb) => {
        if (!isIndeedAgentReady()) {
          cb({ type: 'error', platform: 'indeed', error: 'Indeed agent is not connected. Run jobhawk_agent.py locally, then enable Indeed in Settings.' })
          return Promise.resolve([])
        }
        return dispatchIndeedScrapeToAgent(
          { keywords: title, location, maxJobs: SCRAPE_JOBS_PER_PLATFORM_LIMIT, browser: indeedBrowser },
          cb,
        )
      }
    : null

  return {
    linkedin: linkedinFn,
    stepstone: platforms.includes('stepstone') ? scrapeStepStone : null,
    xing: platforms.includes('xing') ? scrapeXing : null,
    indeed: indeedFn,
    jobriver: platforms.includes('jobriver') ? scrapeJobriver : null,
  }
}

router.post('/', async (req: Request, res: Response) => {
  const userId = getUserId(req)
  const { jobTitle, location = '', platforms: rawPlatforms, indeedBrowser } = req.body as {
    jobTitle?: string
    location?: string
    platforms?: string
    indeedBrowser?: string
  }

  if (!jobTitle?.trim()) {
    res.status(400).json({ error: 'jobTitle is required' })
    return
  }

  const platforms = parsePlatforms(rawPlatforms)
  const scrapers = buildScrapers(platforms, indeedBrowser)
  const events: ScrapeEvent[] = []
  const allJobs: ScrapedJob[] = []

  try {
    let prevWasLinkedInAgent = false
    for (const platform of platforms) {
      const fn = scrapers[platform]
      if (!fn) continue
      // Brief pause between LinkedIn agent and Indeed agent so the local browser
      // can settle before opening a second scrape session on the same machine.
      if (prevWasLinkedInAgent && platform === 'indeed' && isIndeedAgentReady()) {
        await new Promise<void>((r) => setTimeout(r, 2_000))
      }
      try {
        const jobs = await fn(jobTitle.trim(), location.trim(), (evt) => events.push(evt), userId)
        allJobs.push(...jobs)
      } catch (err) {
        events.push({ type: 'error', platform, error: err instanceof Error ? err.message : String(err) })
      }
      prevWasLinkedInAgent = platform === 'linkedin' && isAgentReady()
    }
    allJobs.sort((a, b) => new Date(b.postedDate).getTime() - new Date(a.postedDate).getTime())
    const saved = await mergeJobsForUser(userId, allJobs)

    // Phase 2: background description enrichment (non-blocking)
    const noDesc = saved.filter((j) => !j.description)
    const liJobs = noDesc.filter((j) => j.platform === 'linkedin')
    if (liJobs.length > 0 && isAgentReady()) {
      sendDescribeJobs(liJobs.map((j) => ({ url: j.url })), userId)
    }
    const serverJobs = noDesc
      .filter((j) => ['indeed', 'stepstone', 'xing', 'jobriver'].includes(j.platform))
      .map((j) => ({ id: j.id, url: j.url, platform: j.platform, userId }))
    if (serverJobs.length > 0) enrichJobsBackground(serverJobs)

    res.json({ jobs: saved, events })
  } finally {
    await closeScrapeBrowser().catch(() => undefined)
  }
})

router.get('/stream', (req: Request, res: Response) => {
  const userId = getUserId(req)
  const { jobTitle, location = '', platforms: rawPlatforms, indeedBrowser } = req.query as {
    jobTitle?: string
    location?: string
    platforms?: string
    indeedBrowser?: string
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
  const scrapers = buildScrapers(platforms, indeedBrowser)
  const allJobs: ScrapedJob[] = []

  ;(async () => {
    let prevWasLinkedInAgent = false
    for (const platform of platforms) {
      const fn = scrapers[platform]
      if (!fn) continue
      if (prevWasLinkedInAgent && platform === 'indeed' && isIndeedAgentReady()) {
        await new Promise<void>((r) => setTimeout(r, 2_000))
      }
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
      prevWasLinkedInAgent = platform === 'linkedin' && isAgentReady()
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
