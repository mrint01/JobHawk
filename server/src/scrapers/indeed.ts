/**
 * Indeed scraper (default: de.indeed.com) — public listings via Playwright Firefox.
 *
 * Opt-in in Settings → Indeed → Connect stores a marker session only (no login).
 * Scrolls the results list inside the page shell (inner scrollbar), matching LinkedIn-style UX.
 */
import { firefox, type Browser, type BrowserContext, type Page } from 'playwright'
import { jitter, sleep } from '../utils/browser'
import { nanoid } from '../utils/nanoid'
import { subMinutes, subHours, subDays, subWeeks, parseISO, isValid } from 'date-fns'
import { getSession, saveSession } from '../utils/sessions'
import type { ScrapedJob, ProgressCallback } from './types'
import { limitScrapedJobs, SCRAPE_JOBS_PER_PLATFORM_LIMIT } from './limits'

const INDEED_BASE = (process.env.INDEED_BASE_URL ?? 'https://de.indeed.com').replace(/\/$/, '')
const INDEED_BLOCK_COOLDOWN_MS = 10 * 60 * 1000
const indeedBlockedUntilByUser = new Map<string, number>()
const HEADLESS = process.env.PUPPETEER_HEADLESS !== 'false'
const MANUAL_CAPTCHA_WAIT_MS = 10 * 60 * 1000
let indeedFirefoxBrowser: Browser | null = null
let indeedFirefoxContext: BrowserContext | null = null
let indeedFirefoxContextLaunching: Promise<BrowserContext> | null = null

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

async function getIndeedFirefoxContext(): Promise<BrowserContext> {
  if (indeedFirefoxContext) return indeedFirefoxContext
  if (!indeedFirefoxContextLaunching) {
    indeedFirefoxContextLaunching = (async () => {
      indeedFirefoxBrowser = await firefox.launch({
        headless: HEADLESS,
        firefoxUserPrefs: {
          'dom.webdriver.enabled': false,
        },
      })
      indeedFirefoxContext = await indeedFirefoxBrowser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
        viewport: { width: 1280, height: 800 },
        locale: 'de-DE',
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: {
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'max-age=0',
        },
      })
      await indeedFirefoxContext.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })
      return indeedFirefoxContext
    })()
  }
  indeedFirefoxContext = await indeedFirefoxContextLaunching
  indeedFirefoxContextLaunching = null
  return indeedFirefoxContext
}

async function getIndeedFirefoxPage(): Promise<Page> {
  const ctx = await getIndeedFirefoxContext()
  return ctx.newPage()
}

function protocolCookiesToPlaywrightForIndeed(
  cookies: Array<{
    name?: string
    value?: string
    domain?: string
    path?: string
    secure?: boolean
    httpOnly?: boolean
    expires?: number
    sameSite?: string
  }>,
) {
  return cookies
    .filter((c) => c?.name && c?.value != null)
    .map((c) => ({
      name: String(c.name),
      value: String(c.value),
      domain: c.domain && String(c.domain).includes('indeed') ? String(c.domain) : '.indeed.com',
      path: c.path && c.path.length > 0 ? c.path : '/',
      secure: c.secure !== false,
      httpOnly: !!c.httpOnly,
      ...(typeof c.expires === 'number' && c.expires > 0 ? { expires: c.expires } : {}),
      ...(c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None'
        ? { sameSite: c.sameSite as 'Strict' | 'Lax' | 'None' }
        : {}),
    }))
}

function playwrightCookiesToProtocolForIndeed(
  cookies: Array<{
    name: string
    value: string
    domain: string
    path: string
    secure: boolean
    httpOnly: boolean
    expires: number
    sameSite?: 'Strict' | 'Lax' | 'None'
  }>,
) {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain && c.domain.includes('indeed') ? c.domain : '.indeed.com',
    path: c.path && c.path.length > 0 ? c.path : '/',
    secure: c.secure !== false,
    httpOnly: !!c.httpOnly,
    ...(typeof c.expires === 'number' && c.expires > 0 ? { expires: c.expires } : {}),
    ...(c.sameSite ? { sameSite: c.sameSite } : {}),
  }))
}

function buildIndeedSearchUrl(jobTitle: string, location: string, opts?: { recentOnly?: boolean }): string {
  const params = new URLSearchParams({ q: jobTitle.trim() })
  if (opts?.recentOnly) {
    params.set('sort', 'date')
    params.set('fromage', 'last')
  }
  const loc = location.trim()
  if (loc) params.set('l', loc)
  return `${INDEED_BASE}/jobs?${params.toString()}`
}

async function openIndeedSearch(page: Page, jobTitle: string, location: string): Promise<void> {
  // Warm-up homepage first to establish cookies/session before opening search.
  await page.goto(`${INDEED_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await sleep(900)
  await tryDismissConsent(page)
  await sleep(500)

  const urls = [
    buildIndeedSearchUrl(jobTitle, location, { recentOnly: false }),
    buildIndeedSearchUrl(jobTitle, location, { recentOnly: true }),
  ]
  let lastStatus = 0
  for (let i = 0; i < urls.length; i++) {
    try {
      const response = await page.goto(urls[i], {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
        referer: `${INDEED_BASE}/`,
      })
      const status = response?.status() ?? 0
      lastStatus = status
      if (status > 0 && status < 400) return
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Playwright can throw when navigation auto-redirects while goto is in flight.
      if (/interrupted by another navigation/i.test(msg)) {
        await page.waitForLoadState('domcontentloaded', { timeout: 25_000 }).catch(() => undefined)
        const current = page.url()
        if (current.includes('/jobs')) return
      } else {
        throw err
      }
    }
    await jitter(1200, 2200)
  }
  throw new Error(`Indeed returned HTTP ${lastStatus || 403}`)
}

async function isIndeedChallengePage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase()
  if (url.includes('challenge') || url.includes('captcha') || url.includes('cloudflare')) return true
  const text = (await page.textContent('body').catch(() => '') ?? '').toLowerCase()
  return (
    text.includes('zusätzliche verifizierung erforderlich') ||
    text.includes('additional verification required') ||
    text.includes('cloudflare') ||
    text.includes('ray-id') ||
    text.includes('captcha')
  )
}

async function waitForManualIndeedCaptchaSolve(page: Page, onProgress: ProgressCallback): Promise<void> {
  const started = Date.now()
  onProgress({
    type: 'error',
    platform: 'indeed',
    error: 'Indeed captcha detected. Please solve it in the opened Firefox window; scraping will resume automatically.',
  })
  while (Date.now() - started < MANUAL_CAPTCHA_WAIT_MS) {
    if (page.isClosed()) throw new Error('Indeed captcha window was closed before verification completed.')
    await sleep(2000)
    const stillChallenge = await isIndeedChallengePage(page)
    if (!stillChallenge) return
  }
  throw new Error('Timed out waiting for manual Indeed captcha solve.')
}

async function waitForIndeedResultsVisible(page: Page): Promise<void> {
  const started = Date.now()
  const maxMs = 45_000
  while (Date.now() - started < maxMs) {
    if (page.isClosed()) throw new Error('Indeed page closed before job list became visible.')
    const hasJobs = await page.evaluate(() => {
      return !!(
        document.querySelector('[data-jk]') ||
        document.querySelector('#mosaic-provider-jobcards') ||
        document.querySelector('[data-testid="jobs-search-results-list"]')
      )
    }).catch(() => false)
    if (hasJobs) return
    await sleep(1200)
  }
  throw new Error('Indeed job list did not appear after captcha solve.')
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
    const locator = page.locator(sel).first()
    const count = await locator.count().catch(() => 0)
    if (count > 0) {
      await locator.click({ timeout: 1200 }).catch(() => undefined)
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

/** Puppeteer serializes TS callbacks into the page — emitted helpers like `__name` break there. Use string evaluate + plain JS. */
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
  const blockedUntil = indeedBlockedUntilByUser.get(userId) ?? 0
  if (blockedUntil > Date.now()) {
    return []
  }

  if (!getSession(userId, 'indeed')) {
    onProgress({
      type: 'error',
      platform: 'indeed',
      error: 'Indeed is not enabled. Open Settings → Indeed → Connect.',
    })
    return []
  }

  onProgress({ type: 'progress', platform: 'indeed', progress: 5 })

  let page: Page | null = null
  let keepPageOpen = false
  try {
    page = await getIndeedFirefoxPage()
    const session = getSession(userId, 'indeed')
    if (session?.cookies?.length) {
      await page.context().addCookies(protocolCookiesToPlaywrightForIndeed(session.cookies)).catch(() => undefined)
    }
    await openIndeedSearch(page, jobTitle, location)
    if (!HEADLESS && await isIndeedChallengePage(page)) {
      keepPageOpen = true
      await waitForManualIndeedCaptchaSolve(page, onProgress)
      await page.goto(buildIndeedSearchUrl(jobTitle, location, { recentOnly: false }), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
        referer: `${INDEED_BASE}/`,
      }).catch(() => undefined)
      await waitForIndeedResultsVisible(page)
      keepPageOpen = false
    }

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

    mergeExtracted(await extractIndeed(page))

    for (let round = 0; round < 48; round++) {
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

    const latestCookies = await page.context().cookies(['https://de.indeed.com', 'https://www.indeed.com']).catch(() => [])
    if (latestCookies.length > 0) {
      await saveSession(userId, 'indeed', {
        cookies: playwrightCookiesToProtocolForIndeed(latestCookies),
        loggedInAt: new Date(),
        username: session?.username || 'Indeed DE',
      })
    }

    onProgress({ type: 'progress', platform: 'indeed', progress: 100 })
    return limitScrapedJobs(rawList)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isForbidden = /Indeed returned HTTP 403/.test(message)
    if (isForbidden) {
      indeedBlockedUntilByUser.set(userId, Date.now() + INDEED_BLOCK_COOLDOWN_MS)
      console.warn('[indeed] blocked with HTTP 403; applying cooldown')
    } else {
      console.error('[indeed] scrape error:', err)
    }
    onProgress({
      type: 'error',
      platform: 'indeed',
      error: isForbidden
        ? 'Indeed temporarily blocked this scraper request (HTTP 403). Please retry later.'
        : message,
    })
    return []
  } finally {
    if (page && !keepPageOpen) await page.close().catch(() => undefined)
  }
}
