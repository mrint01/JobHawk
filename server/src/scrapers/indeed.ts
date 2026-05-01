/**
 * Indeed scraper (default: de.indeed.com) — public listings via Playwright Firefox.
 *
 * Opt-in in Settings → Indeed → Connect stores a marker session only (no login).
 * Scrolls the results list inside the page shell (inner scrollbar), matching LinkedIn-style UX.
 * Returns at most SCRAPE_JOBS_PER_PLATFORM_LIMIT (10) jobs, newest-first by postedDate.
 */
import { firefox, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright'
import { jitter, sleep } from '../utils/browser'
import { nanoid } from '../utils/nanoid'
import { subMinutes, subHours, subDays, subWeeks, parseISO, isValid } from 'date-fns'
import { getSession } from '../utils/sessions'
import type { ScrapedJob, ProgressCallback } from './types'
import { limitScrapedJobs, SCRAPE_JOBS_PER_PLATFORM_LIMIT } from './limits'

const INDEED_BASE = (process.env.INDEED_BASE_URL ?? 'https://de.indeed.com').replace(/\/$/, '')

/** HTTP(S) proxy when Indeed returns 403 (datacenter IP). Example: http://user:pass@host:port */
function indeedLaunchProxy(): LaunchOptions['proxy'] {
  const raw = process.env.INDEED_PROXY_SERVER?.trim()
  if (!raw) return undefined
  try {
    const normalized = raw.includes('://') ? raw : `http://${raw}`
    const u = new URL(normalized)
    const server = `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`
    const username = u.username ? decodeURIComponent(u.username) : undefined
    const password = u.password ? decodeURIComponent(u.password) : undefined
    if (username || password) return { server, username, password }
    return { server }
  } catch {
    console.warn('[indeed] invalid INDEED_PROXY_SERVER — ignoring')
    return undefined
  }
}

async function navigateToIndeedJobSearch(page: Page, searchUrl: string): Promise<number> {
  const baseRoot = `${INDEED_BASE}/`
  await page.goto(baseRoot, { waitUntil: 'domcontentloaded', timeout: 35_000 }).catch(() => undefined)
  await jitter(280, 900)

  let response = await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 55_000,
    referer: baseRoot,
  })
  let status = response?.status() ?? 0

  if (status === 403 || status === 401) {
    await sleep(1400 + Math.floor(Math.random() * 1400))
    await page.goto(baseRoot, { waitUntil: 'domcontentloaded', timeout: 35_000 }).catch(() => undefined)
    await jitter(450, 1200)
    response = await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 55_000,
      referer: baseRoot,
    })
    status = response?.status() ?? status
  }

  return status
}

const CONTRACT_TOKENS_DE = [
  'Vollzeit',
  'Teilzeit',
  'Praktikum',
  'Werkstudent',
  'Trainee',
  'Aushilfe',
  'Minijob',
  'Befristet',
  'Unbefristet',
  'Festanstellung',
  'Feste Anstellung',
  'Freiberuflich',
  'Remote',
  'Hybrid',
  'Homeoffice',
  'Home Office',
  'Hybrides Arbeiten',
]

function buildIndeedSearchUrl(jobTitle: string, location: string): string {
  const params = new URLSearchParams({
    q: jobTitle.trim(),
    sort: 'date',
    fromage: 'last',
  })
  const loc = location.trim()
  if (loc) params.set('l', loc)
  return `${INDEED_BASE}/jobs?${params.toString()}`
}

function parseIndeedDateSnippet(raw: string): string {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!t) return ''

  const isoMatch = raw.match(/\d{4}-\d{2}-\d{2}/)
  if (isoMatch) {
    const d = parseISO(isoMatch[0])
    if (isValid(d)) return d.toISOString()
  }

  if (/heute|today|just posted|gerade|vor wenigen|aktive vor wenigen sekunden/.test(t)) return new Date().toISOString()

  const minuteMatch = t.match(/vor\s+(\d+)\s*(minute|minuten|min)\b/)
  if (minuteMatch) return subMinutes(new Date(), parseInt(minuteMatch[1], 10)).toISOString()

  const hourMatch = t.match(/vor\s+(\d+)\s*(stunde|stunden|hour|hours)\b/)
  if (hourMatch) return subHours(new Date(), parseInt(hourMatch[1], 10)).toISOString()

  const dayMatch = t.match(/vor\s+(\d+)\s*(tag|tagen|tage|day|days)\b/)
  if (dayMatch) return subDays(new Date(), parseInt(dayMatch[1], 10)).toISOString()

  const weekMatch = t.match(/vor\s+(\d+)\s*(woche|wochen|week|weeks)\b/)
  if (weekMatch) return subWeeks(new Date(), parseInt(weekMatch[1], 10)).toISOString()

  const enHour = t.match(/(\d+)\s*(hour|hours)\s+ago/)
  if (enHour) return subHours(new Date(), parseInt(enHour[1], 10)).toISOString()

  const enDay = t.match(/(\d+)\s*(day|days)\s+ago/)
  if (enDay) return subDays(new Date(), parseInt(enDay[1], 10)).toISOString()

  return ''
}

async function tryDismissConsent(page: Page): Promise<void> {
  const selectors = [
    '#onetrust-accept-btn-handler',
    'button[data-testid="privacy-banner-accept"]',
    'button[id*="accept"][class*="privacy"]',
    'button[aria-label*="Akzeptieren"]',
    'button[aria-label*="Accept"]',
  ]
  for (const sel of selectors) {
    const handle = await page.$(sel).catch(() => null)
    if (handle) {
      await handle.click().catch(() => undefined)
      await sleep(400)
      break
    }
  }
}

type IndeedScrollState = {
  cardCount: number
  uniqueJk: number
  hasContainer: boolean
  atBottom: boolean
}

/** Use string evaluate + plain JS (stable across engines). */
async function getIndeedScrollState(page: Page): Promise<IndeedScrollState> {
  const result = await page.evaluate(`(function () {
    function findScrollableAncestor(start) {
      var node = start
      while (node && node !== document.body) {
        var style = window.getComputedStyle(node)
        var oy = style.overflowY
        var scrollable = (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight + 12
        if (scrollable) return node
        node = node.parentElement
      }
      return null
    }

    var jkNodes = Array.prototype.slice.call(document.querySelectorAll('[data-jk]')).filter(function (el) {
      var jk = el.getAttribute('data-jk')
      return !!(jk && jk.length > 3 && jk !== 'false')
    })

    var seen = {}
    var uniqueCount = 0
    for (var i = 0; i < jkNodes.length; i++) {
      var jk = jkNodes[i].getAttribute('data-jk')
      if (jk && !seen[jk]) {
        seen[jk] = true
        uniqueCount++
      }
    }

    var roots = [
      document.querySelector('#jobsearch-MainContainer'),
      document.querySelector('[data-testid="jobs-scroll-area"]'),
      document.querySelector('#mosaic-provider-jobcards'),
      document.querySelector('.jobsearch-LeftPane'),
      document.querySelector('[class*="jobsearch-LeftPane"]'),
    ].filter(Boolean)

    var candidates = roots.slice()

    var firstJk = document.querySelector('[data-jk]')
    var fromCard = findScrollableAncestor(firstJk)
    if (fromCard) candidates.push(fromCard)

    var mosaic = document.querySelector('#mosaic-provider-jobcards')
    var fromMosaic = mosaic ? findScrollableAncestor(mosaic) : null
    if (fromMosaic) candidates.push(fromMosaic)

    var usable = candidates.filter(function (el) {
      return el.scrollHeight > el.clientHeight + 12
    })
    usable.sort(function (a, b) {
      return b.clientHeight - a.clientHeight
    })
    var listContainer = usable.length > 0 ? usable[0] : null

    if (!listContainer) {
      return {
        cardCount: jkNodes.length,
        uniqueJk: uniqueCount,
        hasContainer: false,
        atBottom: false,
      }
    }

    var remaining = listContainer.scrollHeight - listContainer.clientHeight - listContainer.scrollTop
    return {
      cardCount: jkNodes.length,
      uniqueJk: uniqueCount,
      hasContainer: true,
      atBottom: remaining <= 12,
    }
  })()`)

  return result as IndeedScrollState
}

async function scrollIndeedList(page: Page): Promise<void> {
  await page.evaluate(`(function () {
    function findScrollableAncestor(start) {
      var node = start
      while (node && node !== document.body) {
        var style = window.getComputedStyle(node)
        var oy = style.overflowY
        var scrollable = (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight + 12
        if (scrollable) return node
        node = node.parentElement
      }
      return null
    }

    var roots = [
      document.querySelector('#jobsearch-MainContainer'),
      document.querySelector('[data-testid="jobs-scroll-area"]'),
      document.querySelector('#mosaic-provider-jobcards'),
      document.querySelector('.jobsearch-LeftPane'),
      document.querySelector('[class*="jobsearch-LeftPane"]'),
    ].filter(Boolean)

    var candidates = roots.slice()
    var firstJk = document.querySelector('[data-jk]')
    var fromCard = findScrollableAncestor(firstJk)
    if (fromCard) candidates.push(fromCard)
    var mosaic = document.querySelector('#mosaic-provider-jobcards')
    var fromMosaic = mosaic ? findScrollableAncestor(mosaic) : null
    if (fromMosaic) candidates.push(fromMosaic)

    var usable = candidates.filter(function (el) {
      return el.scrollHeight > el.clientHeight + 12
    })
    usable.sort(function (a, b) {
      return b.clientHeight - a.clientHeight
    })
    var listContainer = usable.length > 0 ? usable[0] : null

    if (listContainer) {
      listContainer.scrollTop += Math.floor(listContainer.clientHeight * 0.92)
    } else {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.85))
    }
  })()`)
}

type IndeedExtractRow = {
  jk: string
  title: string
  company: string
  location: string
  jobType: string
  dateSnippet: string
}

async function extractIndeed(page: Page): Promise<Omit<ScrapedJob, 'id' | 'platform'>[]> {
  const tokensJson = JSON.stringify(CONTRACT_TOKENS_DE)
  const rows = await page.evaluate(`(function (tokens) {
    var out = []
    var seen = {}

    var roots = Array.prototype.slice.call(document.querySelectorAll('[data-jk]')).filter(function (el) {
      var jk = el.getAttribute('data-jk')
      return !!(jk && jk.length > 3 && jk !== 'false')
    })

    function cardFor(el) {
      var c = el.closest('.slider_item, .job_seen_beacon, .tapItem, li, article, [class*="cardOutline"], [class*="jobCard"]')
      return c || el
    }

    function uniqJoin(arr) {
      var u = []
      var m = {}
      for (var i = 0; i < arr.length; i++) {
        if (!m[arr[i]]) {
          m[arr[i]] = true
          u.push(arr[i])
        }
      }
      return u.join(', ')
    }

    for (var i = 0; i < roots.length; i++) {
      var node = roots[i]
      var jk = node.getAttribute('data-jk')
      if (!jk || seen[jk]) continue

      var card = cardFor(node)
      var link =
        card.querySelector('h2.jobTitle a, h2 a[data-jk], a.jcs-JobTitle') ||
        card.querySelector('a[href*="viewjob"], a[href*="/rc/clk"]')

      var titleEl = card.querySelector('h2.jobTitle span')
      var title =
        (titleEl && titleEl.textContent ? titleEl.textContent.trim() : '') ||
        (function () {
          var t = card.querySelector('.jcs-JobTitle, [data-testid="jobTitle"]')
          return t && t.textContent ? t.textContent.trim() : ''
        })() ||
        (link && link.textContent ? link.textContent.trim() : '') ||
        ''

      if (!title || title.length < 2) continue

      var cn = card.querySelector('[data-testid="company-name"], .companyName, span[data-testid="companyName"]')
      var company =
        (cn && cn.textContent ? cn.textContent.trim() : '') ||
        (function () {
          var t = card.querySelector('span[class*="company"]')
          return t && t.textContent ? t.textContent.trim() : ''
        })() ||
        ''

      var locEl = card.querySelector('[data-testid="text-location"], .companyLocation')
      var location = locEl && locEl.textContent ? locEl.textContent.trim() : ''

      var blob = (card.innerText || card.textContent || '').toLowerCase()
      var matchedTypes = []
      for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t]
        if (blob.indexOf(tok.toLowerCase()) !== -1) matchedTypes.push(tok)
      }
      var jobType = uniqJoin(matchedTypes)

      var dsEl = card.querySelector('[data-testid="myJobsStateDate"], .date, span[class*="date"]')
      var dateSnippet = dsEl && dsEl.textContent ? dsEl.textContent.trim() : ''

      seen[jk] = true
      out.push({
        jk: jk,
        title: title,
        company: company || 'Unknown',
        location: location || '',
        jobType: jobType,
        dateSnippet: dateSnippet,
      })
    }

    return out
  })(${tokensJson})`) as IndeedExtractRow[]

  const host = new URL(INDEED_BASE).hostname

  return rows.map((r) => ({
    title: r.title,
    company: r.company,
    location: r.location,
    url: `https://${host}/viewjob?jk=${encodeURIComponent(r.jk)}`,
    postedDate: parseIndeedDateSnippet(r.dateSnippet),
    jobType: r.jobType || undefined,
  }))
}

export async function scrapeIndeed(
  jobTitle: string,
  location: string,
  onProgress: ProgressCallback,
  userId = 'admin',
): Promise<ScrapedJob[]> {
  if (!getSession(userId, 'indeed')) {
    onProgress({
      type: 'error',
      platform: 'indeed',
      error: 'Indeed is not enabled. Open Settings → Indeed → Connect.',
    })
    return []
  }

  onProgress({ type: 'progress', platform: 'indeed', progress: 5 })

  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let page: Page | null = null
  try {
    browser = await firefox.launch({
      headless: process.env.PUPPETEER_HEADLESS !== 'false',
      proxy: indeedLaunchProxy(),
    })
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      extraHTTPHeaders: {
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1',
      },
    })
    page = await context.newPage()

    const url = buildIndeedSearchUrl(jobTitle, location)
    const httpStatus = await navigateToIndeedJobSearch(page, url)

    await sleep(1600)
    await tryDismissConsent(page)
    await sleep(500)

    onProgress({ type: 'progress', platform: 'indeed', progress: 22 })

    let prevUnique = 0
    let stuck = 0
    const merged = new Map<string, Omit<ScrapedJob, 'id' | 'platform'>>()

    async function mergeExtracted(batch: Omit<ScrapedJob, 'id' | 'platform'>[]) {
      for (const j of batch) {
        const key = j.url
        if (!merged.has(key)) merged.set(key, j)
      }
    }

    const firstBatch = await extractIndeed(page)
    if (httpStatus >= 400 && firstBatch.length === 0) {
      const hint =
        httpStatus === 403
          ? ' Try INDEED_PROXY_SERVER or scrape from a different network/IP.'
          : ''
      throw new Error(`Indeed returned HTTP ${httpStatus}.${hint}`)
    }

    mergeExtracted(firstBatch)

    for (let round = 0; round < 48; round++) {
      if (merged.size >= SCRAPE_JOBS_PER_PLATFORM_LIMIT) break
      if (merged.size >= SCRAPE_JOBS_PER_PLATFORM_LIMIT * 3) break

      const state = await getIndeedScrollState(page).catch(() => ({
        cardCount: 0,
        uniqueJk: 0,
        hasContainer: false,
        atBottom: false,
      }))

      const pct = Math.min(95, 22 + Math.round((round / 48) * 70))
      onProgress({ type: 'progress', platform: 'indeed', progress: pct })

      if (state.uniqueJk === prevUnique) stuck += 1
      else stuck = 0
      prevUnique = state.uniqueJk

      if (stuck >= 5 && round > 3) break
      if (state.atBottom && stuck >= 2) break

      await scrollIndeedList(page)
      await jitter(480, 900)
      mergeExtracted(await extractIndeed(page))
    }

    const rawList = [...merged.values()].map((j) => ({
      ...j,
      id: nanoid(),
      platform: 'indeed' as const,
    }))

    onProgress({ type: 'progress', platform: 'indeed', progress: 100 })
    return limitScrapedJobs(rawList)
  } catch (err) {
    console.error('[indeed] scrape error:', err)
    onProgress({
      type: 'error',
      platform: 'indeed',
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  } finally {
    if (page) await page.close().catch(() => undefined)
    if (context) await context.close().catch(() => undefined)
    if (browser) await browser.close().catch(() => undefined)
  }
}
