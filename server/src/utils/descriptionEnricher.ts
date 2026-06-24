import type { Page } from 'puppeteer'
import { getBrowserPage, sleep } from './browser'
import { getSession } from './sessions'
import { updateJobDescriptionById } from './jobStore'
import {
  getXingFirefoxPage,
  playwrightCookiesFromProtocol,
  closeXingFirefoxBrowser,
  XING_AUTH_VIEWPORT,
} from './xingFirefox'

export interface JobToEnrich {
  id: string
  url: string
  platform: string
  userId: string
  title?: string
}

// ── Xing ─────────────────────────────────────────────────────────────────────
// Xing is a React SPA that blocks headless Chrome — use Playwright Firefox
// (same browser the Xing scraper uses) so cookies + UA match.

async function fetchXingDescriptionWithPlaywright(job: JobToEnrich): Promise<string> {
  let page = null
  try {
    page = await getXingFirefoxPage()
    await page.setViewportSize(XING_AUTH_VIEWPORT)

    const session = getSession(job.userId, job.platform)
    if (session?.cookies.length) {
      const pwCookies = playwrightCookiesFromProtocol(session.cookies)
      if (pwCookies.length) {
        await page.context().addCookies(pwCookies)
      }
    }

    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    // Wait for the SPA to render the job description heading
    await page.waitForFunction(
      () => {
        const t = (document.body as HTMLElement)?.innerText ?? ''
        return t.includes('Über diesen Job') || t.includes('About this job')
      },
      { timeout: 15_000 },
    ).catch(() => undefined)

    await sleep(1200)

    return (await page.evaluate(() => {
      const full = (document.body as HTMLElement)?.innerText ?? ''
      if (full.length < 30) return ''

      const startMarkers = ['Über diesen Job', 'About this job']
      let startIdx = -1
      for (const m of startMarkers) {
        const idx = full.indexOf(m)
        if (idx !== -1 && (startIdx === -1 || idx < startIdx)) startIdx = idx
      }
      if (startIdx === -1) return ''

      let result = full.slice(startIdx).trim()

      // Stop at the first section boundary after the description
      const endMarkers = [
        'Über das Unternehmen', 'About the company',
        'Ähnliche Jobs', 'Similar jobs',
        'Unternehmens-Details', 'Company details',
      ]
      for (const m of endMarkers) {
        const idx = result.indexOf(m)
        if (idx !== -1) { result = result.slice(0, idx).trim(); break }
      }

      return result.length > 30 ? result.slice(0, 20000) : ''
    })) as string
  } catch (err) {
    console.error('[enricher] Xing Playwright fetch failed:', err instanceof Error ? err.message : String(err))
    return ''
  } finally {
    if (page) await page.close().catch(() => undefined)
    await closeXingFirefoxBrowser().catch(() => undefined)
  }
}

// ── StepStone ─────────────────────────────────────────────────────────────────
// Full-main-text approach: grab all of <main>, start from the job title heading,
// stop before the "similar jobs" / footer section.

async function extractStepstoneDescription(page: Page, jobTitle: string): Promise<string> {
  // Wait for the page body to hydrate — StepStone is a CSR app
  await page.waitForSelector('main h1, [data-testid="job-ad-title"], h1', { timeout: 10_000 })
    .catch(() => undefined)
  await sleep(800)

  return (await page.evaluate((title: string) => {
    const container =
      (document.querySelector('main') as HTMLElement | null) ??
      (document.querySelector('[role="main"]') as HTMLElement | null) ??
      (document.body as HTMLElement)

    const rawText = container.innerText?.trim() ?? ''
    if (!rawText || rawText.length < 50) return ''

    // ── Start boundary: find the job title heading (earliest hit) ──────────────
    const startCandidates: number[] = []

    // Try the exact title first
    if (title && title.length > 3) {
      const idx = rawText.indexOf(title)
      if (idx !== -1) startCandidates.push(idx)
    }

    // Try the visible h1 / title element text as a fallback
    const h1Text = (
      document.querySelector('main h1, [data-testid="job-ad-title"], h1') as HTMLElement | null
    )?.innerText?.trim() ?? ''
    if (h1Text && h1Text !== title) {
      const idx = rawText.indexOf(h1Text)
      if (idx !== -1) startCandidates.push(idx)
    }

    // Also try "Einleitung" as a section-level fallback
    const einleitungIdx = rawText.indexOf('Einleitung')
    if (einleitungIdx !== -1) startCandidates.push(einleitungIdx)

    const startIdx = startCandidates.length > 0 ? Math.min(...startCandidates) : -1
    let result = startIdx !== -1 ? rawText.slice(startIdx).trim() : rawText

    // ── End boundary: stop before similar-jobs / footer noise ──────────────────
    // Use \s+ between words so innerText newlines (e.g. words in separate spans)
    // don't break the match.
    const endPatterns = [
      /Diese\s+Jobs\s+waren\s+bei\s+anderen\s+Jobsuchenden\s+beliebt/,
      /Das\s+könnte\s+Sie\s+auch\s+interessieren/,
      /Weitere\s+Stellenangebote/,
      /Ähnliche\s+Jobs/,
      /Similar\s+jobs/i,
    ]
    for (const pat of endPatterns) {
      const m = result.match(pat)
      if (m?.index !== undefined) { result = result.slice(0, m.index).trim(); break }
    }

    return result.length > 30 ? result.slice(0, 25000) : ''
  }, jobTitle)) as string
}

// ── Indeed ────────────────────────────────────────────────────────────────────
// On Indeed viewjob pages the #jobDescriptionText block appears BEFORE the h1
// in DOM order (CSS flex/grid reorders them visually). So clone.innerText starts
// with "Vollständige Stellenbeschreibung", not the title.
//
// Strategy:
//   1. Strip the report button + everything after (end boundary).
//   2. Strip the "Vollständige Stellenbeschreibung" UI heading (just a label).
//   3. Explicitly read the job title from [data-testid="jobTitle"] and prepend
//      it — this guarantees the output always starts with the job title.

async function extractIndeedDescription(page: Page, jobTitle: string): Promise<string> {
  await page.waitForSelector(
    '[data-testid="jobTitle"], h1, #jobDescriptionText',
    { timeout: 10_000 },
  ).catch(() => undefined)
  await sleep(800)

  return (await page.evaluate((title: string) => {
    // ── 1. Grab the widest useful container ───────────────────────────────────
    const panelSelectors = [
      '[data-testid="jobsearch-ViewJobLayout"]',
      '#viewJobSSRRoot',
      '.jobsearch-ViewJobLayout',
      '[class*="viewJobLayout"]',
      '[class*="ViewJobLayout"]',
    ]
    let container: HTMLElement | null = null
    for (const sel of panelSelectors) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && (el.innerText?.length ?? 0) > 100) { container = el; break }
    }
    if (!container) {
      container =
        (document.querySelector('main') as HTMLElement | null) ??
        (document.querySelector('[role="main"]') as HTMLElement | null) ??
        (document.body as HTMLElement)
    }

    // Read job title from the live DOM before cloning
    const titleEl = (
      document.querySelector('[data-testid="jobTitle"]') ??
      document.querySelector('h1')
    ) as HTMLElement | null
    const titleText = titleEl?.innerText?.trim() ?? title ?? ''

    // ── 2. Clone and strip the report button + everything after it ─────────────
    const clone = container.cloneNode(true) as HTMLElement

    const reportBtn = clone.querySelector('[data-testid="report-button-default"]')
    if (reportBtn) {
      let sib: ChildNode | null = reportBtn.nextSibling
      while (sib) {
        const next = sib.nextSibling
        sib.parentNode?.removeChild(sib)
        sib = next
      }
      let el: Element | null = reportBtn
      let parent = el.parentElement
      el.parentNode?.removeChild(el)
      el = parent
      while (el && el !== clone) {
        let s: ChildNode | null = el.nextSibling
        while (s) {
          const n = s.nextSibling
          s.parentNode?.removeChild(s)
          s = n
        }
        el = el.parentElement
      }
    }

    // ── 3. Get raw text, strip the "Vollständige Stellenbeschreibung" UI label ─
    let body = clone.innerText?.trim() ?? ''
    body = body
      .replace(/Vollst[äa]ndige\s+Stellenbeschreibung[\r\n]*/gi, '')
      .replace(/Full\s+job\s+description[\r\n]*/gi, '')
      .trim()

    if (!body || body.length < 30) return ''

    // ── 4. Prepend the title so the output always starts from the job title ────
    // If the title already appears at the very beginning keep it; otherwise add it.
    const startsWithTitle = titleText.length > 2 && body.startsWith(titleText)
    const result = startsWithTitle ? body : (titleText ? titleText + '\n\n' + body : body)

    // Text-based safety net (report button outside the container)
    const endPatterns = [/Diesen\s+Job\s+melden/, /Report\s+job/i, /Report\s+this\s+job/i]
    for (const pat of endPatterns) {
      const m = result.match(pat)
      if (m?.index !== undefined) return result.slice(0, m.index).trim()
    }

    return result.slice(0, 25000)
  }, jobTitle)) as string
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────
// LinkedIn is a React SPA. We wait for the description heading to render, click
// the "Mehr anzeigen"/"Show more" button if present, then extract purely by
// text boundaries — no brittle CSS-class selectors.

async function extractLinkedinDescription(page: Page): Promise<string> {
  // Wait for the SPA to render the job view shell
  await page.waitForSelector(
    '.jobs-description, .job-view-layout, [class*="jobs-description"]',
    { timeout: 15_000 },
  ).catch(() => undefined)

  // Wait for the description heading text to appear
  await page.waitForFunction(
    () => {
      const t = (document.body as HTMLElement)?.innerText ?? ''
      return t.includes('Details zum Jobangebot') || t.includes('About the job') || t.includes('Über den Job')
    },
    { timeout: 12_000 },
  ).catch(() => undefined)

  // Click "Mehr anzeigen" / "Show more" to expand truncated descriptions
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => {
      const txt = (b as HTMLElement).innerText?.toLowerCase().trim() ?? ''
      return txt === 'mehr anzeigen' || txt === 'show more' || txt === 'see more'
    }) as HTMLElement | undefined
    btn?.click()
  })
  await sleep(600)

  return (await page.evaluate(() => {
    const full = (document.body as HTMLElement)?.innerText ?? ''
    if (full.length < 30) return ''

    // ── Start: first occurrence of the description heading ───────────────────
    const startMarkers = ['Details zum Jobangebot', 'About the job', 'Über den Job']
    let startIdx = -1
    for (const m of startMarkers) {
      const idx = full.indexOf(m)
      if (idx !== -1 && (startIdx === -1 || idx < startIdx)) startIdx = idx
    }
    if (startIdx === -1) return ''

    let result = full.slice(startIdx).trim()

    // ── End: next major page section ─────────────────────────────────────────
    // "Kompetenzen" and "Skills" can appear inside the description text itself,
    // so only stop there when they stand alone as a section header (≥ 200 chars
    // into the result and followed by a newline / end of line).
    const strictEndPatterns: RegExp[] = [
      /\n\s*Über\s+das\s+Unternehmen[\s\n]/,
      /\n\s*About\s+the\s+company[\s\n]/i,
      /\n\s*Meet\s+the\s+hiring\s+team[\s\n]/i,
      /\n\s*Das\s+Team\s+kennenlernen[\s\n]/,
      /\n\s*Ähnliche\s+Jobs[\s\n]/,
      /\n\s*Similar\s+jobs[\s\n]/i,
    ]
    for (const pat of strictEndPatterns) {
      const m = result.match(pat)
      if (m?.index !== undefined) { result = result.slice(0, m.index).trim(); break }
    }

    // Secondary guard: "Kompetenzen"/"Skills" as a lone section header
    // only cut if it appears far enough in (> 200 chars) to avoid false positives
    const sectionGuards: RegExp[] = [/\n\s*Kompetenzen\s*\n/, /\n\s*Skills\s*\n/i]
    for (const pat of sectionGuards) {
      const m = result.match(pat)
      if (m?.index !== undefined && m.index > 200) {
        result = result.slice(0, m.index).trim()
        break
      }
    }

    return result.length > 30 ? result.slice(0, 25000) : ''
  })) as string
}

// ── Generic platforms (JobRiver) ──────────────────────────────────────────────

interface PlatformConfig {
  selectors: string[]
  startMarkers?: string[]
  endMarkers?: string[]
}

const DESC_CONFIG: Record<string, PlatformConfig> = {
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
  // Xing blocks headless Chrome — delegate to the dedicated Playwright Firefox path
  if (job.platform === 'xing') {
    return await fetchXingDescriptionWithPlaywright(job)
  }

  let page: Page | null = null
  try {
    page = await getBrowserPage(false)

    const session = getSession(job.userId, job.platform)
    if (session?.cookies.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.setCookie(...(session.cookies as any[]))
    }

    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
    await sleep(job.platform === 'linkedin' ? 3000 : 1500)

    if (job.platform === 'linkedin') {
      return await extractLinkedinDescription(page)
    }

    if (job.platform === 'stepstone') {
      return await extractStepstoneDescription(page, job.title ?? '')
    }

    if (job.platform === 'indeed') {
      return await extractIndeedDescription(page, job.title ?? '')
    }

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
