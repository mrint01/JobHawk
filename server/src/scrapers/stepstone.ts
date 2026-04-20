/**
 * StepStone scraper — Puppeteer with stored session cookies.
 *
 * StepStone now requires a login to show most results and uses
 * client-side rendering, so Axios+Cheerio is insufficient.
 *
 * Requires an active session stored via /api/auth/stepstone/connect.
 */
import { getBrowserPage, sleep } from '../utils/browser'
import { nanoid } from '../utils/nanoid'
import { subMinutes, subHours, subDays, subWeeks, subMonths, parseISO, isValid } from 'date-fns'
import { getSession } from '../utils/sessions'
import type { ScrapedJob, ProgressCallback } from './types'
import { limitScrapedJobs } from './limits'

function toStepStoneSlug(value: string, separator: '-' | '_'): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`\\${separator}+`, 'g'), separator)
    .replace(new RegExp(`^\\${separator}|\\${separator}$`, 'g'), '')
}

/** Rolling window: only jobs from the last N days (StepStone facet + our post-filter). */
const STEPSTONE_MAX_AGE_DAYS = 7

function buildStepStoneSearchUrl(jobTitle: string, location: string): string {
  const titleSlug = toStepStoneSlug(jobTitle, '-')
  const locationSlug = toStepStoneSlug(location, '_')
  const path = locationSlug
    ? `/jobs/${titleSlug}/in-${locationSlug}`
    : `/jobs/${titleSlug}`
  // Match the working UI URL: sort=2 (newest), action=sort_publish, ag=age_7 (last 7 days facet)
  const params = new URLSearchParams({
    radius: '30',
    sort: '2',
    action: 'sort_publish',
    ag: 'age_7',
    searchOrigin: 'Resultlist_top-search',
  })
  return `https://www.stepstone.de${path}?${params.toString()}`
}

/**
 * Parse only the German/English relative snippet (e.g. "vor 5 Stunden") — not the whole card
 * (cards may also contain "9 hours ago", salaries like "9.000 €", etc.).
 */
function parseStepStoneRelativeSegment(segment: string): string | null {
  const normalized = segment.toLowerCase().trim()
  if (!normalized) return null

  const isoMatch = normalized.match(/\d{4}-\d{2}-\d{2}/)
  if (isoMatch) {
    const d = parseISO(isoMatch[0])
    if (isValid(d)) return d.toISOString()
  }

  const deDateMatch = normalized.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/)
  if (deDateMatch) {
    const [, dd, mm, yyyy] = deDateMatch
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  if (/today|heute|gerade eben|just now/.test(normalized)) return new Date().toISOString()

  if (/vor\s+einer\s+stunde/.test(normalized)) return subHours(new Date(), 1).toISOString()
  if (/vor\s+einem\s+tag/.test(normalized)) return subDays(new Date(), 1).toISOString()
  if (/vor\s+einer\s+woche/.test(normalized)) return subWeeks(new Date(), 1).toISOString()

  // Minutes before hours: "vor 3 Minuten" uses "min" — do not confuse with unrelated digits elsewhere
  const minuteMatch = normalized.match(/vor\s+(\d+)\s*(minute|minuten|min|minutes?)\b/i)
  if (minuteMatch) return subMinutes(new Date(), parseInt(minuteMatch[1], 10)).toISOString()

  const hourMatch = normalized.match(/vor\s+(\d+)\s*(stunde|stunden|hour|hours)\b/i)
  if (hourMatch) return subHours(new Date(), parseInt(hourMatch[1], 10)).toISOString()

  const dayMatch = normalized.match(/vor\s+(\d+)\s*(tag|tagen|tage|day|days)\b/i)
  if (dayMatch) return subDays(new Date(), parseInt(dayMatch[1], 10)).toISOString()

  if (/yesterday|gestern/.test(normalized)) return subDays(new Date(), 1).toISOString()

  const weekMatch = normalized.match(/vor\s+(\d+)\s*(woche|wochen|week|weeks)\b/i)
  if (weekMatch) return subWeeks(new Date(), parseInt(weekMatch[1], 10)).toISOString()

  const monthMatch = normalized.match(/vor\s+(\d+)\s*(monat|monate|monaten|month|months)\b/i)
  if (monthMatch) return subMonths(new Date(), parseInt(monthMatch[1], 10)).toISOString()

  // English relative on same line (rare on DE site)
  const hourEn = normalized.match(/(\d+)\s*(hour|hours)\s+ago\b/i)
  if (hourEn) return subHours(new Date(), parseInt(hourEn[1], 10)).toISOString()
  const minEn = normalized.match(/(\d+)\s*(minute|minutes)\s+ago\b/i)
  if (minEn) return subMinutes(new Date(), parseInt(minEn[1], 10)).toISOString()

  return null
}

/** Parse StepStone “Erschienen: …” / relative phrases → ISO. Empty string if unknown (caller may drop). */
function parseRelativeDate(text: string): string {
  const raw = (text ?? '').trim()
  if (!raw) return ''

  // Prefer the single line after "Erschienen:" (must not use /...$/ which breaks on multi-line card blobs)
  const erschienenLine = raw.match(/Erschienen\s*:\s*([^\n\r]+)/i)?.[1]?.trim() ?? ''
  if (erschienenLine) {
    const parsed = parseStepStoneRelativeSegment(erschienenLine)
    if (parsed) return parsed
  }

  // Standalone "vor …" snippet (no "Erschienen:" label)
  if (/^\s*vor\s+/i.test(raw.trim()) && raw.length <= 120) {
    const parsed = parseStepStoneRelativeSegment(raw.trim())
    if (parsed) return parsed
  }

  // <time datetime="..."> from list
  const t = raw.toLowerCase()
  if (/^\d{4}-\d{2}-\d{2}t/.test(t) || /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = parseISO(raw)
    if (isValid(d)) return d.toISOString()
  }

  // Avoid parsing huge card blobs (would match the wrong "vor …" or English "N hours ago")
  if (raw.length <= 100) return parseStepStoneRelativeSegment(raw) ?? ''

  return ''
}

function isWithinLastDays(isoPosted: string, days: number): boolean {
  const d = parseISO(isoPosted)
  if (!isValid(d)) return false
  const cutoff = subDays(new Date(), days)
  return d.getTime() >= cutoff.getTime()
}

export async function scrapeStepStone(
  jobTitle: string,
  location: string,
  onProgress: ProgressCallback,
  userId = 'admin',
): Promise<ScrapedJob[]> {
  if (!getSession(userId, 'stepstone')) {
    onProgress({
      type: 'error',
      platform: 'stepstone',
      error: 'StepStone is not connected. Go to Settings → Platform Connections to connect.',
    })
    return []
  }

  onProgress({ type: 'progress', platform: 'stepstone', progress: 10 })

  let page = null
  try {
    page = await getBrowserPage()

    const session = getSession(userId, 'stepstone')
    if (session?.cookies.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.setCookie(...(session.cookies as any[]))
    }

    const url = buildStepStoneSearchUrl(jobTitle, location)

    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const status = response?.status() ?? 0
    if (status >= 400) {
      throw new Error(`StepStone returned ${status} for ${url}`)
    }
    onProgress({ type: 'progress', platform: 'stepstone', progress: 35 })

    // Wait for JS-rendered job cards (list only — no per-job detail tabs)
    await sleep(2500)
    await page.evaluate(() => window.scrollBy(0, 600))
    await sleep(1000)

    onProgress({ type: 'progress', platform: 'stepstone', progress: 65 })

    const jobs: ScrapedJob[] = await page.evaluate((loc: string) => {
      const results: ScrapedJob[] = []
      const typeTokens = [
        'Feste Anstellung',
        'Vollzeit',
        'Teilzeit',
        'Praktikum',
        'Werkstudent',
        'Trainee',
        'Aushilfe',
        'Minijob',
        'Freie Mitarbeit',
        'Befristet',
        'Unbefristet',
        'Studentenjob',
        'Homeoffice möglich',
        'Home Office',
        'Hybrid',
        'Remote',
      ]
      const cards = document.querySelectorAll(
        '[data-at="job-item"], article[data-at="job-item"], [data-testid="job-item"], .JobCard, article[class*="Job"]',
      )

      cards.forEach((card) => {
        const titleEl =
          card.querySelector('[data-at="job-item-title"]') ??
          card.querySelector('h2 a, h3 a') ??
          card.querySelector('[class*="title"] a')

        const title = titleEl?.textContent?.trim() ?? ''
        if (!title) return

        const company =
          card.querySelector('[data-at="job-item-company-name"]')?.textContent?.trim() ??
          card.querySelector('[class*="company"]')?.textContent?.trim() ??
          'Unknown'

        const jobLocation =
          card.querySelector('[data-at="job-item-location"]')?.textContent?.trim() ??
          card.querySelector('[class*="location"]')?.textContent?.trim() ??
          loc

        const href =
          (titleEl as HTMLAnchorElement | null)?.href ??
          (card.querySelector('a[href*="/stellenangebote"]') as HTMLAnchorElement | null)?.href ??
          (card.querySelector('a[href*="/jobs/"]') as HTMLAnchorElement | null)?.href ??
          (card.querySelector('a') as HTMLAnchorElement | null)?.href ??
          ''

        const cardText = (card as HTMLElement).innerText ?? card.textContent ?? ''
        const erschienenRaw = cardText.match(/Erschienen\s*:\s*([^\n]+)/i)?.[1]?.trim() ?? ''
        const relativeRaw = cardText.match(/vor\s+\d+\s+(?:Minute|Minuten|min|Stunde|Stunden|Tag|Tage|Woche|Wochen|Monat|Monate|Jahr|Jahre)/i)?.[0]?.trim() ?? ''
        const dateText =
          (erschienenRaw ? `Erschienen: ${erschienenRaw}` : '') ||
          relativeRaw ||
          card.querySelector('time')?.getAttribute('datetime') ||
          card.querySelector('time')?.textContent?.trim() ||
          card.querySelector('[class*="date"]')?.textContent?.trim() ||
          ''

        const typeMatches = typeTokens.filter((token) => cardText.toLowerCase().includes(token.toLowerCase()))
        const jobType = Array.from(new Set(typeMatches)).join(', ')

        if (title && href) {
          results.push({
            id: crypto.randomUUID(),
            title,
            company,
            location: jobLocation,
            platform: 'stepstone',
            url: href,
            postedDate: dateText,
            jobType: jobType || undefined,
          })
        }
      })

      return results
    }, location)

    onProgress({ type: 'progress', platform: 'stepstone', progress: 100 })
    const parsed = jobs.map((j) => ({
      ...j,
      id: nanoid(),
      postedDate: parseRelativeDate(j.postedDate),
    }))
    // Hard cap: last 7 days only (facet is not always respected; parsing “now” for unknown is unsafe)
    const inWindow = parsed.filter((j) => isWithinLastDays(j.postedDate, STEPSTONE_MAX_AGE_DAYS))
    return limitScrapedJobs(inWindow)
  } catch (err) {
    onProgress({
      type: 'error',
      platform: 'stepstone',
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  } finally {
    if (page) await page.close().catch(() => undefined)
  }
}
