/**
 * LinkedIn Voyager API client — pure HTTP, zero browser automation.
 *
 * Why no Puppeteer: Headless Chromium sessions are detected by LinkedIn's
 * anti-bot system via CDP fingerprints. Detection triggers server-side
 * revocation of the li_at token, logging the user out everywhere.
 *
 * Plain HTTP fetch() with li_at + a fake JSESSIONID is indistinguishable
 * from a normal in-browser XHR/fetch call and does NOT trigger revocation.
 *
 * JSESSIONID / CSRF: LinkedIn uses "ajax:<random>" as the JSESSIONID cookie
 * value and mirrors it as the Csrf-Token header. We generate our own random
 * value — the server only checks that they match, not that they came from a
 * real session.
 */

import type { ScrapedJob } from '../scrapers/types'

const VOYAGER = 'https://www.linkedin.com/voyager/api'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

export function generateCsrfToken(): string {
  return 'ajax:' + Math.random().toString(36).slice(2, 14)
}

export function buildLinkedInHeaders(liAt: string, csrf: string): Record<string, string> {
  return {
    cookie: `li_at=${liAt}; JSESSIONID="${csrf}"`,
    'csrf-token': csrf,
    'x-restli-protocol-version': '2.0.0',
    'x-li-lang': 'en_US',
    'x-li-track': JSON.stringify({
      clientVersion: '1.13.8280',
      mpVersion: '1.13.8280',
      osName: 'web',
      timezoneOffset: 1,
      timezone: 'Europe/Berlin',
      deviceFormFactor: 'DESKTOP',
      mpName: 'voyager-web',
    }),
    'user-agent': USER_AGENT,
    accept: 'application/vnd.linkedin.normalized+json+2.1',
    'accept-language': 'en-US,en;q=0.9',
  }
}

// ── Token validation ──────────────────────────────────────────────────────────

export async function validateLinkedInToken(liAt: string): Promise<{ ok: boolean; error?: string }> {
  const csrf = generateCsrfToken()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)

  try {
    const resp = await fetch(`${VOYAGER}/me`, {
      headers: buildLinkedInHeaders(liAt, csrf),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (resp.status === 200) return { ok: true }

    if (resp.status === 401 || resp.status === 403) {
      return {
        ok: false,
        error:
          'Token is invalid or already expired. ' +
          'In your browser: go to linkedin.com → F12 → Application → Cookies → copy the li_at value.',
      }
    }
    if (resp.status === 429) {
      return { ok: false, error: 'LinkedIn rate limit hit. Wait a few minutes and try again.' }
    }
    return { ok: false, error: `LinkedIn returned HTTP ${resp.status}. Try a fresh li_at token.` }
  } catch (err) {
    clearTimeout(timer)
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('abort') || msg.includes('AbortError')) {
      // Timeout → store optimistically; scraping will catch truly dead tokens
      return { ok: true }
    }
    return { ok: false, error: `Could not reach LinkedIn: ${msg}` }
  }
}

// ── Location → geoId resolution ───────────────────────────────────────────────

async function resolveGeoId(location: string, liAt: string, csrf: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      keywords: location,
      q: 'type',
      type: 'GEO',
      usecase: 'GEO_ID_FROM_SEARCH_HISTORY',
      count: '5',
    })
    const resp = await fetch(`${VOYAGER}/typeahead/hitsV2?${params}`, {
      headers: buildLinkedInHeaders(liAt, csrf),
    })
    if (!resp.ok) return null

    const data = await resp.json() as {
      included?: Array<{ $type?: string; hitInfo?: { geoUrn?: string } }>
    }
    for (const item of data.included ?? []) {
      if (item.$type?.includes('GeoEntityHit') && item.hitInfo?.geoUrn) {
        const m = item.hitInfo.geoUrn.match(/\d+$/)
        if (m) return m[0]
      }
    }
    return null
  } catch {
    return null
  }
}

// ── Job search ────────────────────────────────────────────────────────────────

const WORKPLACE_LABELS: Record<string, string> = {
  ':1': 'On-site',
  ':2': 'Remote',
  ':3': 'Hybrid',
}

function parseWorkplaceTypes(types: string[]): string {
  return types
    .map((t) => {
      for (const [suffix, label] of Object.entries(WORKPLACE_LABELS)) {
        if (t.endsWith(suffix)) return label
      }
      return ''
    })
    .filter(Boolean)
    .join(', ')
}

interface VoyagerJobPosting {
  $type?: string
  entityUrn?: string
  title?: string
  formattedLocation?: string
  listedAt?: number
  workplaceTypes?: string[]
  companyDetails?: {
    company?: string
    companyResolutionResult?: { name?: string }
  }
}

interface VoyagerMiniCompany {
  $type?: string
  entityUrn?: string
  name?: string
}

interface VoyagerResponse {
  data?: { paging?: { total?: number } }
  included?: Array<Record<string, unknown>>
}

async function fetchJobPage(
  liAt: string,
  csrf: string,
  keywords: string,
  geoId: string | null,
  locationText: string,
  start: number,
): Promise<{ jobs: ScrapedJob[]; total: number }> {
  const locationPart = geoId
    ? `locationUnion:(geoId:${geoId})`
    : `location:${locationText}`

  const query =
    `(origin:JOB_SEARCH_PAGE_SEARCH_BUTTON,` +
    `selectedFilters:(timePostedRange:List(r604800)),` +
    `keywords:${keywords},` +
    `${locationPart})`

  const params = new URLSearchParams({
    decorationId: 'com.linkedin.voyager.deco.jserp.WebJobPostingWithSalary-26',
    q: 'jserpFilters',
    queryContext: 'List(primaryHitType->JOBS,spellCorrectionEnabled->true)',
    query,
    count: '25',
    start: String(start),
    sortBy: 'DD',
  })

  const resp = await fetch(`${VOYAGER}/jobs/search?${params}`, {
    headers: buildLinkedInHeaders(liAt, csrf),
  })

  if (resp.status === 401 || resp.status === 403) {
    throw Object.assign(new Error('LinkedIn token expired or revoked'), { code: 'UNAUTHORIZED' })
  }
  if (resp.status === 429) {
    throw Object.assign(new Error('LinkedIn rate limit hit (429). Wait 15-30 minutes.'), { code: 'RATE_LIMITED' })
  }
  if (!resp.ok) {
    throw new Error(`LinkedIn API returned ${resp.status}`)
  }

  const data = await resp.json() as VoyagerResponse
  const total = data.data?.paging?.total ?? 0
  const included = data.included ?? []

  // Build company URN → name lookup from MiniCompany entries
  const companyMap = new Map<string, string>()
  for (const raw of included) {
    const item = raw as VoyagerMiniCompany
    if (item.$type?.includes('MiniCompany') && item.entityUrn && item.name) {
      companyMap.set(item.entityUrn, item.name)
    }
  }

  const jobs: ScrapedJob[] = []
  for (const raw of included) {
    const item = raw as VoyagerJobPosting
    if (!item.$type?.includes('JobPosting')) continue

    const jobId = item.entityUrn?.match(/\d+$/)?.[0]
    if (!jobId || !item.title) continue

    const companyUrn = item.companyDetails?.company ?? ''
    const company =
      item.companyDetails?.companyResolutionResult?.name ??
      companyMap.get(companyUrn) ??
      'Unknown'

    jobs.push({
      id: crypto.randomUUID(),
      title: item.title,
      company,
      location: item.formattedLocation ?? locationText,
      jobType: parseWorkplaceTypes(item.workplaceTypes ?? []),
      platform: 'linkedin',
      url: `https://www.linkedin.com/jobs/view/${jobId}/`,
      postedDate: item.listedAt ? new Date(item.listedAt).toISOString() : '',
    })
  }

  return { jobs, total }
}

// ── Public scrape function ────────────────────────────────────────────────────

export async function scrapeLinkedInViaApi(
  liAt: string,
  jobTitle: string,
  location: string,
  onProgress: (pct: number) => void,
): Promise<{ jobs: ScrapedJob[]; error?: string; code?: string }> {
  const csrf = generateCsrfToken()

  // Resolve location → geoId for accurate geo-filtering
  const geoId = await resolveGeoId(location, liAt, csrf)
  console.log(
    `[linkedin-api] location="${location}" → geoId=${geoId ?? 'none (using text fallback)'}`,
  )

  onProgress(15)

  const collected = new Map<string, ScrapedJob>()
  let total = Infinity

  // Fetch up to 2 pages (50 results); limitScrapedJobs will trim to 25 sorted by date
  for (let start = 0; start < 50 && start < total; start += 25) {
    try {
      const { jobs, total: pageTotal } = await fetchJobPage(
        liAt,
        csrf,
        jobTitle,
        geoId,
        location,
        start,
      )
      if (start === 0) {
        total = pageTotal
        console.log(`[linkedin-api] total available results: ${total}`)
      }
      for (const job of jobs) collected.set(job.url, job)

      onProgress(15 + Math.round(((start + 25) / Math.min(total, 50)) * 75))

      if (start + 25 < Math.min(total, 50)) {
        await new Promise((r) => setTimeout(r, 600))
      }
    } catch (err) {
      const e = err as Error & { code?: string }
      return { jobs: [], error: e.message, code: e.code }
    }
  }

  console.log(`[linkedin-api] collected ${collected.size} jobs`)
  return { jobs: Array.from(collected.values()) }
}
