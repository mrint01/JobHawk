/**
 * POST /api/scrape          — one-shot JSON response (all platforms)
 * GET  /api/scrape/stream   — Server-Sent Events stream (real-time progress)
 *
 * Both endpoints accept the same query/body params:
 *   jobTitle   string   required
 *   location   string   optional
 *   platforms  string   comma-separated: "linkedin,stepstone,xing"
 */
import { Router, type Request, type Response } from 'express'
import { scrapeLinkedIn } from '../scrapers/linkedin'
import { scrapeStepStone } from '../scrapers/stepstone'
import { scrapeXing } from '../scrapers/xing'
import type { Platform, ScrapedJob, ScrapeEvent, ProgressCallback } from '../scrapers/types'
import { closeScrapeBrowser } from '../utils/browser'
import { mergeJobs } from '../utils/jobStore'

const router = Router()

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePlatforms(raw: string | undefined): Platform[] {
  const ALL: Platform[] = ['linkedin', 'stepstone', 'xing']
  if (!raw) return ALL
  return raw.split(',').filter((p): p is Platform => ALL.includes(p as Platform))
}

type ScraperFn = (title: string, location: string, cb: ProgressCallback) => Promise<ScrapedJob[]>

function buildScrapers(platforms: Platform[]): Record<Platform, ScraperFn | null> {
  return {
    linkedin:  platforms.includes('linkedin')  ? scrapeLinkedIn  : null,
    stepstone: platforms.includes('stepstone') ? scrapeStepStone : null,
    xing:      platforms.includes('xing')      ? scrapeXing      : null,
  }
}

// ── POST /api/scrape ──────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
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
    const tasks = platforms.map(async (platform) => {
      const fn = scrapers[platform]
      if (!fn) return

      try {
        const jobs = await fn(jobTitle.trim(), location.trim(), (evt) => events.push(evt))
        allJobs.push(...jobs)
      } catch (err) {
        events.push({
          type: 'error',
          platform,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })

    await Promise.all(tasks)

    // Sort newest first
    allJobs.sort((a, b) => new Date(b.postedDate).getTime() - new Date(a.postedDate).getTime())

    res.json({ jobs: allJobs, events })
  } finally {
    await closeScrapeBrowser().catch(() => undefined)
  }
})

// ── GET /api/scrape/stream  (SSE) ─────────────────────────────────────────────

router.get('/stream', (req: Request, res: Response) => {
  const { jobTitle, location = '', platforms: rawPlatforms } = req.query as {
    jobTitle?: string
    location?: string
    platforms?: string
  }

  if (!jobTitle?.trim()) {
    res.status(400).json({ error: 'jobTitle is required' })
    return
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no') // disable nginx buffering
  res.flushHeaders()

  function send(evt: ScrapeEvent) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`)
  }

  const platforms = parsePlatforms(rawPlatforms)
  const scrapers = buildScrapers(platforms)
  const allJobs: ScrapedJob[] = []

  const tasks = platforms.map(async (platform) => {
    const fn = scrapers[platform]
    if (!fn) return

    try {
      const jobs = await fn(
        jobTitle!.trim(),
        location.trim(),
        (evt) => {
          send(evt)
          if (evt.type === 'jobs') allJobs.push(...(evt.jobs ?? []))
        },
      )
      allJobs.push(...jobs)
      send({ type: 'jobs', platform, jobs, progress: 100 })
    } catch (err) {
      send({
        type: 'error',
        platform,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })

  Promise.all(tasks)
    .then(() => {
      // Persist to server-side JSON store, then send final result
      const saved = mergeJobs(allJobs)
      send({ type: 'done', jobs: saved, totalJobs: saved.length })
      res.end()
    })
    .finally(async () => {
      await closeScrapeBrowser().catch(() => undefined)
    })
})

export default router
