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

const DESC_SELECTORS: Record<string, string[]> = {
  indeed: [
    '#jobDescriptionText',
    '.jobsearch-jobDescriptionText',
    '[data-testid="job-description"]',
    '[data-testid="jobDescriptionText"]',
  ],
  stepstone: [
    '[data-at="job-description"]',
    '.at-section-text-description',
    'article[class*="JobDetail"]',
    '[class*="JobDetail"] article',
  ],
  xing: [
    '[data-testid="job-description"]',
    '.job-description',
    '[class*="jobDescription"]',
  ],
  jobriver: [
    '.description-text',
    '[class*="description-text"]',
    '[class*="job-content"]',
    '[class*="jobContent"]',
  ],
}

async function extractDescription(page: Page, platform: string): Promise<string> {
  const sels = DESC_SELECTORS[platform] ?? []
  for (const sel of sels) {
    try {
      const txt = (await page.evaluate((s: string) => {
        const el = document.querySelector(s)
        return el && (el as HTMLElement).innerText ? (el as HTMLElement).innerText.trim() : ''
      }, sel)) as string
      if (txt.length > 50) return txt
    } catch { /* continue */ }
  }
  // Generic fallback: main content area
  try {
    const txt = (await page.evaluate(() => {
      const el =
        document.querySelector('main') ??
        document.querySelector('[role="main"]') ??
        document.querySelector('article')
      return el && (el as HTMLElement).innerText
        ? (el as HTMLElement).innerText.trim().slice(0, 20000)
        : ''
    })) as string
    if (txt.length > 50) return txt
  } catch { /* ignore */ }
  return ''
}

export function enrichJobsBackground(jobs: JobToEnrich[]): void {
  if (jobs.length === 0) return
  setImmediate(() =>
    _doEnrich(jobs).catch((err) => console.error('[enricher] fatal:', err)),
  )
}

async function _doEnrich(jobs: JobToEnrich[]): Promise<void> {
  console.log(`[enricher] starting Phase 2 for ${jobs.length} jobs`)
  for (const job of jobs) {
    let page: Page | null = null
    try {
      page = await getBrowserPage(false)

      if (job.platform === 'stepstone' || job.platform === 'xing') {
        const session = getSession(job.userId, job.platform)
        if (session?.cookies.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await page.setCookie(...(session.cookies as any[]))
        }
      }

      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await sleep(1500)

      const desc = await extractDescription(page, job.platform)
      if (desc.length > 50) {
        await updateJobDescriptionById(job.userId, job.id, desc)
        console.log(`[enricher] ${job.platform} job ${job.id}: ${desc.length} chars`)
      }
    } catch (err) {
      console.error(
        `[enricher] failed ${job.platform} ${job.url}:`,
        err instanceof Error ? err.message : String(err),
      )
    } finally {
      if (page) await page.close().catch(() => undefined)
    }
    await sleep(600 + Math.random() * 800)
  }
  console.log(`[enricher] Phase 2 complete (${jobs.length} jobs)`)
}
