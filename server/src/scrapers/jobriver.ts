/**
 * Jobriver scraper (jobriver.de) — public listings via Puppeteer.
 *
 * Opt-in in Settings → Jobriver → Connect stores a marker session only (no login).
 * Uses inner-list scrolling similar to Indeed/LinkedIn layouts.
 */
import type { Page } from 'puppeteer'
import { getBrowserPage, jitter, sleep } from '../utils/browser'
import { nanoid } from '../utils/nanoid'
import { subMinutes, subHours, subDays, subWeeks, parseISO, isValid } from 'date-fns'
import { getSession } from '../utils/sessions'
import type { ScrapedJob, ProgressCallback } from './types'
import { SCRAPE_JOBS_PER_PLATFORM_LIMIT } from './limits'

const JOBRIVER_BASE = 'https://jobriver.de'
const JOBRIVER_LIMIT = 25

function buildJobriverSearchUrl(jobTitle: string, location: string): string {
  const params = new URLSearchParams()
  const title = jobTitle.trim()
  const loc = normalizeJobriverSearchLocation(location)
  if (title) params.set('q', title)
  if (loc) params.set('location_name', loc)
  params.set('lat', '')
  params.set('lng', '')
  const qs = params.toString()
  return qs ? `${JOBRIVER_BASE}/jobs/?${qs}` : `${JOBRIVER_BASE}/jobs/`
}

function normalizeJobriverSearchLocation(raw: string): string {
  if (!raw) return ''
  const first = raw.split(',')[0]?.trim() ?? ''
  return first
}

function normalizeJobriverResultLocation(raw: string, fallbackRaw: string): string {
  const source = (raw && raw.trim()) ? raw : fallbackRaw
  const first = source.split(',')[0]?.trim() ?? ''
  return first
}

function parseJobriverDateSnippet(raw: string): string {
  const t = (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!t) return ''

  const isoMatch = t.match(/\d{4}-\d{2}-\d{2}/)
  if (isoMatch) {
    const d = parseISO(isoMatch[0])
    if (isValid(d)) return d.toISOString()
  }

  const deDate = t.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/)
  if (deDate) {
    const d = new Date(Number(deDate[3]), Number(deDate[2]) - 1, Number(deDate[1]))
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }

  if (/heute|today|just now|gerade eben/.test(t)) return new Date().toISOString()
  if (/gestern|yesterday/.test(t)) return subDays(new Date(), 1).toISOString()

  const mins = t.match(/(?:vor\s+)?(\d+)\s*(minute|minuten|min|minutes?)\b/)
  if (mins) return subMinutes(new Date(), parseInt(mins[1], 10)).toISOString()

  const hours = t.match(/(?:vor\s+)?(\d+)\s*(stunde|stunden|hour|hours)\b/)
  if (hours) return subHours(new Date(), parseInt(hours[1], 10)).toISOString()

  const days = t.match(/(?:vor\s+)?(\d+)\s*(tag|tagen|tage|day|days)\b/)
  if (days) return subDays(new Date(), parseInt(days[1], 10)).toISOString()

  const weeks = t.match(/(?:vor\s+)?(\d+)\s*(woche|wochen|week|weeks)\b/)
  if (weeks) return subWeeks(new Date(), parseInt(weeks[1], 10)).toISOString()

  const enHours = t.match(/(\d+)\s*(hour|hours)\s+ago/)
  if (enHours) return subHours(new Date(), parseInt(enHours[1], 10)).toISOString()

  const enDays = t.match(/(\d+)\s*(day|days)\s+ago/)
  if (enDays) return subDays(new Date(), parseInt(enDays[1], 10)).toISOString()

  return ''
}

// Publish time enrichment disabled to keep scraping stable and avoid repeated page refresh loops.

async function tryDismissConsent(page: Page): Promise<void> {
  const selectors = [
    '#onetrust-accept-btn-handler',
    'button[id*="accept"]',
    'button[class*="accept"]',
    'button[aria-label*="Akzept"]',
    'button[aria-label*="Accept"]',
  ]
  for (const sel of selectors) {
    const handle = await page.$(sel).catch(() => null)
    if (!handle) continue
    await handle.click().catch(() => undefined)
    await sleep(350)
    break
  }
}

type JobriverScrollState = {
  cardCount: number
  uniqueUrls: number
  hasContainer: boolean
  atBottom: boolean
}

async function getJobriverScrollState(page: Page): Promise<JobriverScrollState> {
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

    var cardSelectors = 'li, article, [role="listitem"], [data-job-id], [data-id], [class*="job-item"], [class*="job-card"], [class*="result-item"]'
    var cards = Array.prototype.slice.call(document.querySelectorAll(cardSelectors)).filter(function (el) {
      var txt = (el.innerText || el.textContent || '').trim()
      return txt.length > 20
    })
    var uniqueCount = cards.length

    var roots = [
      document.querySelector('[data-testid="jobs-scroll-area"]'),
      document.querySelector('.jobs-search-results-list'),
      document.querySelector('.jobs-list'),
      document.querySelector('[class*="jobs-list"]'),
      document.querySelector('[class*="result-list"]'),
      document.querySelector('main ul'),
      document.querySelector('main [role="list"]'),
    ].filter(Boolean)

    var candidates = roots.slice()
    var firstCard = cards[0] || null
    var fromCard = findScrollableAncestor(firstCard)
    if (fromCard) candidates.push(fromCard)

    var usable = candidates.filter(function (el) { return el.scrollHeight > el.clientHeight + 12 })
    usable.sort(function (a, b) { return b.clientHeight - a.clientHeight })
    var listContainer = usable.length > 0 ? usable[0] : null

    if (!listContainer) {
      return { cardCount: cards.length, uniqueUrls: uniqueCount, hasContainer: false, atBottom: false }
    }

    var remaining = listContainer.scrollHeight - listContainer.clientHeight - listContainer.scrollTop
    return { cardCount: cards.length, uniqueUrls: uniqueCount, hasContainer: true, atBottom: remaining <= 12 }
  })()`)

  return result as JobriverScrollState
}

async function scrollJobriverList(page: Page): Promise<void> {
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

    var candidates = [
      document.querySelector('[data-testid="jobs-scroll-area"]'),
      document.querySelector('.jobs-search-results-list'),
      document.querySelector('.jobs-list'),
      document.querySelector('[class*="jobs-list"]'),
      document.querySelector('[class*="result-list"]'),
      document.querySelector('main ul'),
      document.querySelector('main [role="list"]'),
    ].filter(Boolean)

    var firstLink = document.querySelector('a[href*="/jobs/"], a[href*="/job/"]')
    var fromCard = findScrollableAncestor(firstLink)
    if (fromCard) candidates.push(fromCard)

    var usable = candidates.filter(function (el) { return el.scrollHeight > el.clientHeight + 12 })
    usable.sort(function (a, b) { return b.clientHeight - a.clientHeight })
    var listContainer = usable.length > 0 ? usable[0] : null

    if (listContainer) {
      listContainer.scrollTop += Math.max(500, Math.floor(listContainer.clientHeight * 0.9))
      listContainer.dispatchEvent(new Event('scroll', { bubbles: true }))
    } else {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.9))
    }
  })()`)
}

type JobriverExtractRow = {
  jobId: string
  href: string
  title: string
  company: string
  location: string
  jobType: string
  dateSnippet: string
}

async function enrichPostedDatesFromOpenedOffer(
  page: Page,
  jobs: Array<{ jobId?: string; postedDate: string }>,
): Promise<void> {
  const pending = jobs.filter((j) => !j.postedDate && j.jobId)
  if (!pending.length) return

  for (const job of pending) {
    try {
      const clicked = await page.evaluate((jobId) => {
        const id = String(jobId || '')
        if (!id) return false
        const el = document.querySelector(`[data-job-id="${id}"]`) as HTMLElement | null
        if (!el) return false
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
        el.click()
        return true
      }, job.jobId)
      if (!clicked) continue

      await sleep(180)
      const rel = await page.evaluate(() => {
        const txt = ((document.querySelector('main') as HTMLElement | null)?.innerText || document.body.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
        const m =
          txt.match(/vor\s+\d+\s+(?:Sekunden?|Min(?:ute|uten)?|Stunde(?:n)?|Tag(?:e|en)?|Woche(?:n)?|Monat(?:e|en)?)/i) ||
          txt.match(/\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?)\s+ago/i)
        return m ? m[0] : ''
      })
      if (!rel) continue
      const parsed = parseJobriverDateSnippet(rel)
      if (parsed) job.postedDate = parsed
    } catch {
      // best effort only
    }
  }
}

type ExtractedJobriverJob = Omit<ScrapedJob, 'id' | 'platform'> & { jobId?: string }

async function extractJobriver(page: Page): Promise<ExtractedJobriverJob[]> {
  const rows = await page.evaluate(`(function () {
    function cleanText(v) { return (v || '').replace(/\\s+/g, ' ').trim() }
    function cleanHref(href) {
      try {
        var u = new URL(href, window.location.origin)
        u.hash = ''
        return u.origin + u.pathname
      } catch {
        return href || ''
      }
    }
    function uniqJoin(arr) {
      var seen = {}
      var out = []
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i]
        var k = v.toLowerCase()
        if (!v || seen[k]) continue
        seen[k] = true
        out.push(v)
      }
      return out.join(', ')
    }
    function looksLikeDateLine(line) {
      if (!line) return false
      return /vor\\s+\\d+\\s+(?:sekunden?|min(?:ute|uten)?|stunde(?:n)?|tag(?:e|en)?|woche(?:n)?|monat(?:e|en)?)/i.test(line)
        || /\\d+\\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?)\\s+ago/i.test(line)
        || /\\d{1,2}\\.\\d{1,2}\\.\\d{4}/.test(line)
    }
    function looksLikeTypeLine(line) {
      if (!line) return false
      return /\\b(remote|hybrid|vor ort|on[- ]?site|vollzeit|teilzeit|freelance|freiberuflich|praktikum|werkstudent|vertrag|befristet|unbefristet|junior|mid[- ]?level|senior|lead|principal)\\b/i.test(line)
    }
    function isBadTitle(line) {
      if (!line) return true
      if (line.length < 4) return true
      if (/^\\d+\\s*%$/.test(line)) return true
      if (/^(neueste|relevanz|gehalt|zurück|filter|job auswählen|anmelden)$/i.test(line)) return true
      return false
    }
    function isSalaryLine(line) {
      return /€|eur|jahr|year/i.test(line || '')
    }

    var out = []
    var seenIds = {}
    var urlById = {}
    var jobLinks = Array.prototype.slice.call(document.querySelectorAll('a[href*="/jobs/"]'))
    for (var j = 0; j < jobLinks.length; j++) {
      var hrefRaw = jobLinks[j].getAttribute('href') || jobLinks[j].href || ''
      if (!hrefRaw) continue
      var abs = cleanHref(hrefRaw)
      var m = abs.match(/-(\\d+)(?:[/?#]|$)/)
      if (!m) continue
      if (!urlById[m[1]]) urlById[m[1]] = abs
    }
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-job-id]'))

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i]
      var jobId = cleanText(node.getAttribute('data-job-id') || '')
      if (!jobId || seenIds[jobId]) continue

      var card = node.closest('[data-id]') || node.closest('[class*="job"]') || node.parentElement || node
      var rawText = card.innerText || card.textContent || ''
      var lines = String(rawText).split(/\\n+/).map(function (x) { return cleanText(x) }).filter(Boolean)
      lines = lines.filter(function (l) { return l !== '100%' })
      if (lines.length < 2) continue

      var title = lines[0] || ''
      if (isBadTitle(title)) continue

      var company = lines[1] || 'Unknown'
      if (looksLikeTypeLine(company) || looksLikeDateLine(company) || isSalaryLine(company)) {
        company = 'Unknown'
      }

      var location = ''
      var typeParts = []
      var dateSnippet = ''
      for (var l = 2; l < lines.length; l++) {
        var line = lines[l]
        if (!line) continue
        if (!dateSnippet && looksLikeDateLine(line)) {
          dateSnippet = line
          continue
        }
        if (looksLikeTypeLine(line)) {
          typeParts.push(line)
          continue
        }
        if (!location && !isSalaryLine(line) && line !== '·') {
          location = line
        }
      }

      var href = urlById[jobId] || ''
      if (!href) {
        var linkNode = card.querySelector('a[href*="/jobs/"], a[href*="/job/"]')
        href = linkNode ? cleanHref(linkNode.getAttribute('href') || linkNode.href || '') : ''
      }
      if (!href) href = window.location.origin + '/jobs/#job-' + jobId

      seenIds[jobId] = true
      out.push({
        jobId: jobId,
        href: href,
        title: title,
        company: company || 'Unknown',
        location: location || '',
        jobType: uniqJoin(typeParts),
        dateSnippet: dateSnippet,
      })
    }

    return out
  })()`) as JobriverExtractRow[]

  return rows.map((r) => ({
    jobId: r.jobId,
    title: r.title,
    company: r.company,
    location: normalizeJobriverResultLocation(r.location, ''),
    url: r.href.startsWith('http') ? r.href : `${JOBRIVER_BASE}${r.href.startsWith('/') ? '' : '/'}${r.href}`,
    postedDate: parseJobriverDateSnippet(r.dateSnippet),
    jobType: r.jobType || undefined,
  }))
}

export async function scrapeJobriver(
  jobTitle: string,
  location: string,
  onProgress: ProgressCallback,
  userId = 'admin',
): Promise<ScrapedJob[]> {
  if (!getSession(userId, 'jobriver')) {
    onProgress({
      type: 'error',
      platform: 'jobriver',
      error: 'Jobriver is not enabled. Open Settings → Jobriver → Connect.',
    })
    return []
  }

  onProgress({ type: 'progress', platform: 'jobriver', progress: 5 })

  let page: Page | null = null
  try {
    page = await getBrowserPage(false)
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' })

    const url = buildJobriverSearchUrl(jobTitle, location)
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const status = response?.status() ?? 0
    if (status >= 400) throw new Error(`Jobriver returned HTTP ${status}`)

    await sleep(1700)
    await tryDismissConsent(page)
    await sleep(450)

    onProgress({ type: 'progress', platform: 'jobriver', progress: 22 })

    let prevUnique = 0
    let stuck = 0
    const merged = new Map<string, ExtractedJobriverJob>()

    const mergeExtracted = (batch: Omit<ScrapedJob, 'id' | 'platform'>[]) => {
      for (const j of batch) {
        if (!merged.has(j.url)) {
          merged.set(j.url, {
            ...j,
            location: normalizeJobriverResultLocation(j.location, location),
          })
        }
      }
    }

    mergeExtracted(await extractJobriver(page))

    for (let round = 0; round < 48; round++) {
      if (merged.size >= JOBRIVER_LIMIT) break
      if (merged.size >= SCRAPE_JOBS_PER_PLATFORM_LIMIT * 3) break

      const state = await getJobriverScrollState(page).catch(() => ({
        cardCount: 0,
        uniqueUrls: 0,
        hasContainer: false,
        atBottom: false,
      }))

      const pct = Math.min(95, 22 + Math.round((round / 48) * 70))
      onProgress({ type: 'progress', platform: 'jobriver', progress: pct })

      if (state.uniqueUrls === prevUnique) stuck += 1
      else stuck = 0
      prevUnique = state.uniqueUrls

      if (stuck >= 5 && round > 3) break
      if (state.atBottom && stuck >= 2) break

      await scrollJobriverList(page)
      await jitter(460, 860)
      mergeExtracted(await extractJobriver(page))
      if (merged.size >= JOBRIVER_LIMIT) break
    }

    const raw = [...merged.values()].map((j) => ({
      ...j,
      id: nanoid(),
      platform: 'jobriver' as const,
    }))
    await enrichPostedDatesFromOpenedOffer(page, raw)
    onProgress({ type: 'progress', platform: 'jobriver', progress: 100 })
    return raw
      .sort((a, b) => {
        const ta = new Date(a.postedDate).getTime()
        const tb = new Date(b.postedDate).getTime()
        const aKey = Number.isNaN(ta) ? 0 : ta
        const bKey = Number.isNaN(tb) ? 0 : tb
        return bKey - aKey
      })
      .slice(0, JOBRIVER_LIMIT)
  } catch (err) {
    onProgress({
      type: 'error',
      platform: 'jobriver',
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  } finally {
    if (page) await page.close().catch(() => undefined)
  }
}
