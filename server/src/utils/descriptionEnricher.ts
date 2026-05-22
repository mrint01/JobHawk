import type { Page } from 'puppeteer'
import { getBrowserPage, sleep } from './browser'
import { getSession } from './sessions'
import { updateJobDescriptionById } from './jobStore'

export interface JobToEnrich {
  id: string
  url: string
  platform: string
  userId: string
}

// ── Xing ─────────────────────────────────────────────────────────────────────
// Xing is a React SPA. We wait for networkidle2 + the heading to appear, then
// extract purely by text boundaries — no CSS selectors needed.

async function extractXingDescription(page: Page): Promise<string> {
  // Wait for the SPA to render the description heading
  await page.waitForFunction(
    () => {
      const t = (document.body as HTMLElement)?.innerText ?? ''
      return t.includes('Über diesen Job') || t.includes('About this job')
    },
    { timeout: 12_000 },
  ).catch(() => undefined) // if not found, we try anyway

  return (await page.evaluate(() => {
    const full = (document.body as HTMLElement)?.innerText ?? ''
    if (full.length < 30) return ''

    // Find start — include the heading itself in the output
    const startMarkers = ['Über diesen Job', 'About this job']
    let startIdx = -1
    for (const m of startMarkers) {
      const idx = full.indexOf(m)
      if (idx !== -1 && (startIdx === -1 || idx < startIdx)) startIdx = idx
    }
    if (startIdx === -1) return ''

    let result = full.slice(startIdx).trim()

    // Stop before company details section
    const endMarkers = ['Unternehmens-Details', 'Company details']
    for (const m of endMarkers) {
      const idx = result.indexOf(m)
      if (idx !== -1) { result = result.slice(0, idx).trim(); break }
    }

    return result.length > 30 ? result.slice(0, 20000) : ''
  })) as string
}

// ── Generic platforms (StepStone, Indeed, JobRiver) ───────────────────────────

interface PlatformConfig {
  selectors: string[]
  startMarkers?: string[]
  endMarkers?: string[]
}

const DESC_CONFIG: Record<string, PlatformConfig> = {
  indeed: {
    selectors: [
      '#jobDescriptionText',
      '.jobsearch-jobDescriptionText',
      '[data-testid="job-description"]',
      '[data-testid="jobDescriptionText"]',
    ],
    startMarkers: ['Vollständige Stellenbeschreibung', 'Full job description'],
    endMarkers: ['Diesen Job melden', 'Report job', 'Report this job'],
  },
  stepstone: {
    selectors: [
      '[data-at="job-ad-description"]',
      '[data-at="job-description"]',
      '.at-section-text-description',
      '[data-testid="job-description"]',
      'article[class*="JobDetail"]',
      '[class*="JobDetail"] article',
      '[class*="jobAd"] article',
    ],
    startMarkers: ['Einleitung'],
    endMarkers: ['Weitere Informationen'],
  },
  jobriver: {
    selectors: [
      '.description-text',
      '[class*="description-text"]',
      '[class*="job-content"]',
      '[class*="jobContent"]',
    ],
    startMarkers: ['Beschreibung'],
    endMarkers: ['Skill-Test'],
  },
}

function applyMarkers(text: string, startMarkers: string[] = [], endMarkers: string[] = []): string {
  let result = text
  for (const marker of startMarkers) {
    const idx = result.indexOf(marker)
    if (idx !== -1) { result = result.slice(idx).trim(); break }
  }
  for (const marker of endMarkers) {
    const idx = result.indexOf(marker)
    if (idx !== -1) { result = result.slice(0, idx).trim(); break }
  }
  return result
}

async function extractGenericDescription(page: Page, platform: string): Promise<string> {
  const config = DESC_CONFIG[platform]
  const sels = config?.selectors ?? []

  let rawText = ''

  for (const sel of sels) {
    try {
      const txt = (await page.evaluate((s: string) => {
        const el = document.querySelector(s) as HTMLElement | null
        return el?.innerText?.trim() ?? ''
      }, sel)) as string
      if (txt.length > 50) { rawText = txt; break }
    } catch { /* try next selector */ }
  }

  if (!rawText) {
    // Fallback: full body text so text markers can still find their boundaries
    try {
      rawText = (await page.evaluate(() => {
        const el =
          document.querySelector('main') ??
          document.querySelector('[role="main"]') ??
          document.querySelector('article') ??
          document.body
        return (el as HTMLElement | null)?.innerText?.trim()?.slice(0, 60000) ?? ''
      })) as string
    } catch { /* ignore */ }
  }

  if (!rawText || rawText.length < 50) return ''
  return applyMarkers(rawText, config?.startMarkers, config?.endMarkers).slice(0, 20000)
}

/** Fetch job posting text from the live URL (used for cover letters and enrichment). */
export async function fetchJobDescriptionFromUrl(job: JobToEnrich): Promise<string> {
  let page: Page | null = null
  try {
    page = await getBrowserPage(false)

    const session = getSession(job.userId, job.platform)
    if (session?.cookies.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.setCookie(...(session.cookies as any[]))
    }

    if (job.platform === 'xing') {
      await page.goto(job.url, { waitUntil: 'networkidle2', timeout: 30_000 })
      return await extractXingDescription(page)
    }

    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await sleep(1500)
    return await extractGenericDescription(page, job.platform)
  } catch (err) {
    console.error(
      `[enricher] fetchJobDescriptionFromUrl failed ${job.platform} ${job.url}:`,
      err instanceof Error ? err.message : String(err),
    )
    return ''
  } finally {
    if (page) await page.close().catch(() => undefined)
  }
}

// ── Background enrichment entry point ────────────────────────────────────────

export function enrichJobsBackground(jobs: JobToEnrich[]): void {
  if (jobs.length === 0) return
  setImmediate(() =>
    _doEnrich(jobs).catch((err) => console.error('[enricher] fatal:', err)),
  )
}

async function _doEnrich(jobs: JobToEnrich[]): Promise<void> {
  console.log(`[enricher] starting Phase 2 for ${jobs.length} jobs`)
  for (const job of jobs) {
    const desc = await fetchJobDescriptionFromUrl(job)
    if (desc.length > 50) {
      await updateJobDescriptionById(job.userId, job.id, desc)
      console.log(`[enricher] ${job.platform} job ${job.id}: ${desc.length} chars`)
    } else {
      console.log(`[enricher] ${job.platform} job ${job.id}: no description found`)
    }
    await sleep(600 + Math.random() * 800)
  }
  console.log(`[enricher] Phase 2 complete (${jobs.length} jobs)`)
}
