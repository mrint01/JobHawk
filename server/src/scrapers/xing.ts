/**
 * Xing scraper — two-strategy approach:
 *
 *  Strategy A (preferred): Axios with stored session cookies.
 *  Strategy B (fallback):  Puppeteer with stored session cookies.
 *
 * Requires an active session stored via /api/auth/xing/connect.
 */
import axios from 'axios'
import { getBrowserPage, sleep } from '../utils/browser'
import { nanoid } from '../utils/nanoid'
import { subMinutes, subHours, subDays, subWeeks } from 'date-fns'
import { getSession } from '../utils/sessions'
import type { ScrapedJob, ProgressCallback } from './types'
import { limitScrapedJobs } from './limits'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

function parseXingDate(text: string): string {
  const t = (text ?? '').toLowerCase().trim()
  if (!t) return ''

  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t)
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  const minuteMatch = t.match(/(?:vor\s+)?(\d+)\s*(minute|minuten|min|minutes?)\b/i)
  if (minuteMatch) return subMinutes(new Date(), parseInt(minuteMatch[1], 10)).toISOString()

  const hourMatch = t.match(/(?:vor\s+)?(\d+)\s*(hour|hours|stunde|stunden)\b/i)
  if (hourMatch) return subHours(new Date(), parseInt(hourMatch[1])).toISOString()

  const dayMatch = t.match(/(?:vor\s+)?(\d+)\s*(day|days|tag|tage|tagen)\b/i)
  if (dayMatch) return subDays(new Date(), parseInt(dayMatch[1])).toISOString()

  const weekMatch = t.match(/(?:vor\s+)?(\d+)\s*(week|weeks|woche|wochen)\b/i)
  if (weekMatch) return subWeeks(new Date(), parseInt(weekMatch[1], 10)).toISOString()

  if (/today|heute/.test(t))     return new Date().toISOString()
  if (/yesterday|gestern/.test(t)) return subDays(new Date(), 1).toISOString()

  return ''
}

/** Convert stored Puppeteer cookies → axios Cookie header string */
function cookieHeader(platform: string): string {
  const session = getSession(platform)
  if (!session) return ''
  return session.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

// ── Strategy A: Axios ─────────────────────────────────────────────────────────

async function scrapeXingAxios(
  jobTitle: string,
  location: string,
  cookieStr: string,
): Promise<ScrapedJob[] | null> {
  try {
    const params = new URLSearchParams({
      keywords: jobTitle,
      location,
      sort: 'date',
      limit: '15',
      offset: '0',
    })

    type XingItem = {
      id?: string; title?: string; companyName?: string
      location?: { city?: string; country?: string }
      url?: string; publishedAt?: string; slug?: string
      employmentType?: string; contractType?: string
    }

    const response = await axios.get<{ items?: XingItem[]; results?: XingItem[] }>(
      `https://www.xing.com/jobs/api/search?${params}`,
      {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://www.xing.com/jobs',
          ...(cookieStr ? { Cookie: cookieStr } : {}),
        },
        timeout: 12_000,
      },
    )

    const items = response.data.items ?? response.data.results ?? []
    if (items.length === 0) return null

    return items.map((item) => ({
      id: nanoid(),
      title: item.title ?? 'Unknown',
      company: item.companyName ?? 'Unknown',
      location:
        [item.location?.city, item.location?.country].filter(Boolean).join(', ') || location,
      platform: 'xing' as const,
      url: item.url
        ? item.url.startsWith('http') ? item.url : `https://www.xing.com${item.url}`
        : `https://www.xing.com/jobs/${item.slug ?? item.id ?? ''}`,
      postedDate: parseXingDate(item.publishedAt ?? ''),
      jobType: [item.employmentType, item.contractType].filter(Boolean).join(', ') || undefined,
    }))
  } catch {
    return null
  }
}

// ── Strategy B: Puppeteer ─────────────────────────────────────────────────────

async function scrapeXingBrowser(
  jobTitle: string,
  location: string,
  onProgress: ProgressCallback,
): Promise<ScrapedJob[]> {
  let page = null
  try {
    // SPA needs stylesheets/scripts — same as LinkedIn. Default getBrowserPage(true) blocks CSS
    // and often yields 0 cards, especially when other platforms use the shared browser in parallel.
    page = await getBrowserPage(false)

    const session = getSession('xing')
    if (session?.cookies.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.setCookie(...(session.cookies as any[]))
    }

    const params = new URLSearchParams({ keywords: jobTitle, location, sort: 'date' })
    await page.goto(`https://www.xing.com/jobs/search?${params}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })

    // Let the jobs app hydrate (parallel scrapes compete for the same browser; DOM was often empty at 1.5s)
    await sleep(4000)
    await page
      .waitForSelector('[data-testid="job-card"], [data-testid="job-title"], a[href*="/jobs/"]', {
        timeout: 20_000,
      })
      .catch(() => undefined)

    await sleep(800)
    await page.evaluate(() => window.scrollBy(0, 500))
    await sleep(1200)

    onProgress({ type: 'progress', platform: 'xing', progress: 80 })

    const jobs: ScrapedJob[] = await page.evaluate((loc: string) => {
      const results: ScrapedJob[] = []
      const jobTypeTokens = [
        'Vollzeit', 'Teilzeit', 'Praktikum', 'Werkstudent', 'Trainee', 'Freelance',
        'Freiberuflich', 'Befristet', 'Unbefristet', 'Minijob', 'Aushilfe',
        'Vor Ort', 'Homeoffice', 'Home Office', 'Hybrid', 'Remote',
      ]
      const cards = document.querySelectorAll(
        '[data-testid="job-card"], .JobCard, article[class*="job"]',
      )
      cards.forEach((card) => {
        const rawText = (card as HTMLElement).innerText ?? card.textContent ?? ''
        const lines = rawText.split('\n').map((line) => line.trim()).filter(Boolean)
        const title =
          card.querySelector('h2, h3, [data-testid="job-title"], [class*="title"]')?.textContent?.trim() ?? ''
        let company =
          card.querySelector('[data-testid="company-name"], [class*="company"]')?.textContent?.trim() ?? ''
        if (!company && title) {
          const idx = lines.findIndex((line) => line === title || line.includes(title))
          if (idx >= 0 && lines[idx + 1]) company = lines[idx + 1]
        }
        if (!company) company = 'Unknown'
        const locationText =
          card.querySelector('[data-testid="job-location"], [class*="location"]')?.textContent?.trim() ?? loc
        const link = (card.querySelector('a[href*="/jobs/"]') as HTMLAnchorElement | null)?.href ?? ''
        const dateText = (
          card.querySelector('time')?.getAttribute('datetime') ??
          card.querySelector('time')?.textContent?.trim() ??
          card.querySelector('[class*="date"]')?.textContent?.trim() ??
          rawText.match(/vor\s+\d+\s+(?:Minute|Minuten|min|Stunde|Stunden|Tag|Tage|Woche|Wochen)/i)?.[0]?.trim() ??
          rawText.match(/\d+\s+(?:minutes?|hours?|days?|weeks?)\s+ago/i)?.[0]?.trim() ??
          ''
        )

        const explicitEmploymentLine = lines.find((line) => /art der beschäftigung\s*:/i.test(line)) ?? ''
        const explicitEmployment = explicitEmploymentLine.replace(/.*:\s*/i, '').trim()
        const tagTypes = jobTypeTokens.filter((token) => rawText.toLowerCase().includes(token.toLowerCase()))
        const jobType = Array.from(new Set([explicitEmployment, ...tagTypes].filter(Boolean))).join(', ')
        if (title && link) {
          results.push({
            id: crypto.randomUUID(),
            title, company,
            location: locationText,
            platform: 'xing',
            url: link,
            postedDate: dateText,
            jobType: jobType || undefined,
          })
        }
      })
      return results
    }, location)

    return jobs.map((j) => ({ ...j, postedDate: parseXingDate(j.postedDate) }))
  } catch (err) {
    onProgress({
      type: 'error',
      platform: 'xing',
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  } finally {
    if (page) await page.close().catch(() => undefined)
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function scrapeXing(
  jobTitle: string,
  location: string,
  onProgress: ProgressCallback,
): Promise<ScrapedJob[]> {
  if (!getSession('xing')) {
    onProgress({
      type: 'error',
      platform: 'xing',
      error: 'Xing is not connected. Go to Settings → Platform Connections to connect.',
    })
    return []
  }

  onProgress({ type: 'progress', platform: 'xing', progress: 15 })

  // When LinkedIn + StepStone run together, the shared scrape browser is busy; stagger API/browser work slightly.
  await sleep(2500)

  const cookieStr = cookieHeader('xing')
  const apiResults = await scrapeXingAxios(jobTitle, location, cookieStr)
  if (apiResults !== null) {
    const hasReliableMeta = apiResults.some((j) => Boolean(j.postedDate) && Boolean(j.jobType))
    if (hasReliableMeta) {
      onProgress({ type: 'progress', platform: 'xing', progress: 100 })
      return limitScrapedJobs(apiResults)
    }
  }

  if (apiResults !== null) {
    // API sometimes omits card metadata (type/time/company line). Browser fallback is more reliable.
    onProgress({ type: 'progress', platform: 'xing', progress: 35 })
  }

  onProgress({ type: 'progress', platform: 'xing', progress: 40 })
  const results = await scrapeXingBrowser(jobTitle, location, onProgress)
  onProgress({ type: 'progress', platform: 'xing', progress: 100 })
  return limitScrapedJobs(results)
}
