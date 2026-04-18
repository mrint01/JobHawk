/**
 * LinkedIn Voyager API client — pure HTTP, no browser automation.
 *
 * JSESSIONID / CSRF: LinkedIn's CSRF check requires a matching JSESSIONID cookie
 * + Csrf-Token header using the "ajax:<random>" format. We generate our own — the
 * server only checks that they match, not that they came from a real session.
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
    const url = `${VOYAGER}/typeahead/hitsV2?${params}`
    const resp = await fetch(url, { headers: buildLinkedInHeaders(liAt, csrf) })

    console.log(`[linkedin-api] typeahead status: ${resp.status}`)
    if (!resp.ok) {
      console.log(`[linkedin-api] typeahead failed with status ${resp.status}`)
      return null
    }

    const raw = await resp.text()
    console.log(`[linkedin-api] typeahead raw (first 500): ${raw.slice(0, 500)}`)

    const data = JSON.parse(raw) as {
      included?: Array<{
        $type?: string
        hitInfo?: { $type?: string; geoUrn?: string; displayName?: string }
      }>
    }

    for (const item of data.included ?? []) {
      // The outer item.$type is "TypeaheadHit"; the geo info is in hitInfo.$type
      const geoUrn = item.hitInfo?.geoUrn
      if (geoUrn) {
        const m = geoUrn.match(/\d+$/)
        if (m) {
          console.log(`[linkedin-api] geoId resolved: ${m[0]} for "${item.hitInfo?.displayName}"`)
          return m[0]
        }
      }
    }

    console.log('[linkedin-api] typeahead: no geoUrn found in included array')
    return null
  } catch (err) {
    console.log(`[linkedin-api] typeahead error: ${err instanceof Error ? err.message : err}`)
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
  let locationPart: string
  if (geoId) {
    locationPart = `locationUnion:(geoId:${geoId})`
  } else {
    // Commas break LinkedIn's parenthetical query syntax — use city name only
    const cityOnly = locationText.split(',')[0].trim()
    locationPart = `location:${cityOnly}`
    console.log(`[linkedin-api] text location fallback: "${cityOnly}"`)
  }

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

  const url = `${VOYAGER}/jobs/search?${params}`
  console.log(`[linkedin-api] job search URL: ${url.slice(0, 300)}`)

  const resp = await fetch(url, { headers: buildLinkedInHeaders(liAt, csrf) })
  console.log(`[linkedin-api] job search status: ${resp.status}`)

  if (resp.status === 401 || resp.status === 403) {
    throw Object.assign(new Error('LinkedIn token expired or revoked — reconnect in Settings.'), { code: 'UNAUTHORIZED' })
  }
  if (resp.status === 429) {
    throw Object.assign(new Error('LinkedIn rate limit (429). Wait 15–30 minutes and try again.'), { code: 'RATE_LIMITED' })
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    console.log(`[linkedin-api] job search error body (first 300): ${body.slice(0, 300)}`)
    throw new Error(`LinkedIn API returned ${resp.status}`)
  }

  const raw = await resp.text()
  console.log(`[linkedin-api] job search raw (first 500): ${raw.slice(0, 500)}`)

  const data = JSON.parse(raw) as VoyagerResponse
  const total = data.data?.paging?.total ?? 0
  const included = data.included ?? []

  console.log(`[linkedin-api] paging total=${total}, included entries=${included.length}`)

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

  console.log(`[linkedin-api] extracted ${jobs.length} jobs from page (start=${start})`)
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

  const geoId = await resolveGeoId(location, liAt, csrf)
  console.log(`[linkedin-api] location="${location}" → geoId=${geoId ?? 'none (using text fallback)'}`)

  onProgress(15)

  const collected = new Map<string, ScrapedJob>()
  let total = Infinity

  for (let start = 0; start < 50 && start < total; start += 25) {
    try {
      const { jobs, total: pageTotal } = await fetchJobPage(liAt, csrf, jobTitle, geoId, location, start)

      if (start === 0) {
        total = pageTotal
        console.log(`[linkedin-api] total available results: ${total}`)
      }

      for (const job of jobs) collected.set(job.url, job)
      onProgress(15 + Math.round(((start + 25) / Math.min(Math.max(total, 1), 50)) * 75))

      if (start + 25 < Math.min(total, 50)) {
        await new Promise((r) => setTimeout(r, 600))
      }
    } catch (err) {
      const e = err as Error & { code?: string }
      console.log(`[linkedin-api] fetchJobPage error: ${e.message}`)
      return { jobs: [], error: e.message, code: e.code }
    }
  }

  console.log(`[linkedin-api] collected ${collected.size} jobs total`)
  return { jobs: Array.from(collected.values()) }
}
