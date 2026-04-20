/**
 * LinkedIn scraper — Playwright Firefox session.
 *
 * Root cause of "0 results" bug that was fixed here:
 *   LinkedIn renders TWO <a href="/jobs/view/{id}"> per card:
 *     1. A full-card invisible overlay link  (empty textContent)
 *     2. The visible title link              (has the job title)
 *   The old code added the URL to `seen` BEFORE validating the title.
 *   So the overlay was processed first, failed title check, but its URL
 *   was already in `seen`. When the title link arrived (same URL) it was
 *   immediately skipped → every job was dropped → 0 results.
 *   Fix: deduplicate by jobId AFTER we have confirmed a valid title.
 */
import type { Page } from 'playwright'
import type { Protocol } from 'puppeteer'
import { getLinkedInFirefoxPage } from '../utils/linkedinFirefox'
import { playwrightCookiesToProtocol, protocolCookiesToPlaywright } from '../utils/linkedinPlaywrightCookies'
import { jitter, sleep } from '../utils/browser'
import { sanitizeLinkedInCookiesForReplay } from '../utils/linkedinCookies'
import {
  puppeteerCookiesToFileEntries,
  writeLinkedInSessionFile,
} from '../utils/linkedinSession'
import { clearSession, getSession, saveSession } from '../utils/sessions'
import { subHours, subDays } from 'date-fns'
import type { ScrapedJob, ProgressCallback } from './types'
import { limitScrapedJobs, SCRAPE_JOBS_PER_PLATFORM_LIMIT } from './limits'

const LINKEDIN_LIST_CONTAINER_SELECTORS = [
  '.scaffold-layout__list',
  '.scaffold-layout__list-container',
  '.jobs-search-results-list',
  '.jobs-search-results__list',
  '[data-results-list-top-scroll-sentinel]',
  'main [role="list"]',
  'main ul',
]

const LINKEDIN_JOB_CARD_SELECTORS = [
  'li[data-occludable-job-id]',
  'li[data-job-id]',
  '.jobs-search-results__list-item',
]

function parseLinkedInDate(raw: string): string {
  if (!raw) return ''
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!t) return ''

  if (t.includes('just now') || t.includes('gerade eben')) return new Date().toISOString()

  const m = t.match(/(\d+)\s+(\w+)\s+ago/)
  if (m) {
    const n = Number(m[1])
    const unit = m[2]
    if (unit.startsWith('mo')) return subDays(new Date(), n * 30).toISOString()
    if (unit.startsWith('m')) return new Date(Date.now() - n * 60_000).toISOString()
    if (unit.startsWith('h')) return subHours(new Date(), n).toISOString()
    if (unit.startsWith('d')) return subDays(new Date(), n).toISOString()
    if (unit.startsWith('w')) return subDays(new Date(), n * 7).toISOString()
    if (unit.startsWith('s')) return new Date(Date.now() - n * 1_000).toISOString()
  }

  const gm = t.match(/\bvor\s+(\d+)\s+(\w+)/)
  if (gm) {
    const n = Number(gm[1])
    const unit = gm[2]
    if (unit.startsWith('sek')) return new Date(Date.now() - n * 1_000).toISOString()
    if (unit.startsWith('min')) return new Date(Date.now() - n * 60_000).toISOString()
    if (unit.startsWith('stu')) return subHours(new Date(), n).toISOString()
    if (unit.startsWith('tag')) return subDays(new Date(), n).toISOString()
    if (unit.startsWith('woc')) return subDays(new Date(), n * 7).toISOString()
    if (unit.startsWith('mon')) return subDays(new Date(), n * 30).toISOString()
  }

  const d = new Date(raw)
  return isNaN(d.getTime()) ? '' : d.toISOString()
}

function isLinkedInRedirectLoopError(message: string): boolean {
  return message.includes('ERR_TOO_MANY_REDIRECTS') || message.includes('too many redirects')
}

function isRetryableNavigationError(message: string): boolean {
  return (
    message.includes('NS_ERROR_NET_EMPTY_RESPONSE')
    || message.includes('NS_ERROR_NET')
    || message.includes('net::ERR_')
    || message.includes('Navigation timeout')
    || message.includes('Timeout')
    || message.includes('ECONNRESET')
    || message.includes('EPIPE')
  )
}

function isJobSearchListUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname.includes('linkedin.com') && u.pathname.startsWith('/jobs/search')
  } catch {
    return false
  }
}

/** LinkedIn opens job detail in the same tab; recover the search results list. */
async function ensureJobSearchListPage(page: Page, searchUrl: string): Promise<boolean> {
  if (isJobSearchListUrl(page.url())) return true
  const here = page.url().slice(0, 120)
  console.warn(`[linkedin] left job search view (${here}…) — reloading results`)
  try {
    await gotoWithRetries(page, searchUrl, { waitUntil: 'domcontentloaded', timeout: 55_000 })
    await sleep(2800)
    return isJobSearchListUrl(page.url())
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    console.warn(`[linkedin] could not reload job search: ${m.slice(0, 200)}`)
    return false
  }
}

async function gotoWithRetries(
  page: Page,
  url: string,
  opts: { waitUntil?: 'domcontentloaded' | 'networkidle' | 'load'; timeout: number },
): Promise<void> {
  let lastErr: Error | null = null
  for (let i = 0; i < 4; i++) {
    try {
      await page.goto(url, opts)
      return
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (!isRetryableNavigationError(lastErr.message) || i === 3) throw lastErr
      // Firefox NS_ERROR_NET_EMPTY_RESPONSE needs longer backoff than Chrome
      const backoff = lastErr.message.includes('NS_ERROR') ? 4000 + i * 3500 : 1800 + i * 1200
      console.warn(`[linkedin] goto retry ${i + 1}/4: ${lastErr.message.slice(0, 120)}`)
      await sleep(backoff)
    }
  }
  throw lastErr ?? new Error('goto failed')
}

async function isLinkedInRateLimitedPage(page: Page): Promise<boolean> {
  const title = (await page.title().catch(() => '')).toLowerCase()
  if (
    title.includes('429')
    || title.includes('too many requests')
    || title.includes("this page isn't working")
    || title.includes("this page isn\u2019t working")
  ) return true

  const body = await page.evaluate(() => (document.body?.innerText ?? '').slice(0, 8000)).catch(() => '')
  const hay = body.toLowerCase()
  return (
    hay.includes('http error 429')
    || hay.includes('429 too many requests')
    || hay.includes('too many requests')
    || hay.includes('problem with this site')
    || hay.includes("this page isn't working")
    || hay.includes("this page isn\u2019t working")
  )
}

async function persistLinkedInSessionFromPage(page: Page, username: string, userId: string): Promise<void> {
  try {
    const raw = await page.context().cookies(['https://www.linkedin.com'])
    const sanitized = playwrightCookiesToProtocol(raw)
    const liAt = sanitized.find((c) => c.name === 'li_at' && c.value.length > 0)?.value
    if (!liAt) return
    saveSession(userId, 'linkedin', { cookies: sanitized, loggedInAt: new Date(), username })
    writeLinkedInSessionFile({
      liAt,
      capturedAt: new Date().toISOString(),
      username,
      jarVersion: 2,
      puppeteerCookies: puppeteerCookiesToFileEntries(sanitized),
    })
    console.log(`[linkedin] persisted ${sanitized.length} cookies (full jar on disk, jarVersion 2)`)
  } catch {
    // ignore
  }
}

async function gotoLinkedInJobSearch(page: Page, url: string): Promise<void> {
  const attempts: Array<{ label: string; fn: () => Promise<void> }> = [
    {
      label: 'direct jobs',
      fn: async () => {
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
        await gotoWithRetries(page, url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      },
    },
    {
      label: 'feed then jobs',
      fn: async () => {
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
        await gotoWithRetries(page, 'https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 35_000 })
        await gotoWithRetries(page, url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      },
    },
    {
      label: 'jobs networkidle',
      fn: async () => {
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
        await gotoWithRetries(page, url, { waitUntil: 'networkidle', timeout: 55_000 })
      },
    },
  ]

  let lastErr: Error | null = null
  for (const attempt of attempts) {
    try {
      await attempt.fn()
      if (attempt.label !== 'direct jobs') {
        console.log(`[linkedin] job navigation ok via: ${attempt.label}`)
      }
      return
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      lastErr = e
      if (!isLinkedInRedirectLoopError(e.message)) throw e
      console.warn(`[linkedin] job navigation failed (${attempt.label}): ${e.message}`)
    }
  }
  throw lastErr ?? new Error('LinkedIn navigation failed')
}

function isBlockedLinkedInUrl(url: string): boolean {
  return url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint') || url.includes('/challenge')
}

function isTransientEvalError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('Execution context was destroyed')
    || msg.includes('Cannot find context with specified id')
    || msg.includes('Protocol error')
    || msg.includes('Target page, context or browser has been closed')
}

function isPageClosedError(message: string): boolean {
  return (
    message.includes('Target page, context or browser has been closed')
    || message.includes('has been closed')
    || message.includes('Browser has been closed')
  )
}

async function getLinkedInListState(page: Page): Promise<{
  cardCount: number
  hasContainer: boolean
  atBottom: boolean
}> {
  const result = await page.evaluate(`(() => {
    const containerSelectors = ${JSON.stringify(LINKEDIN_LIST_CONTAINER_SELECTORS)};
    const cardSelectors = ${JSON.stringify(LINKEDIN_JOB_CARD_SELECTORS)};

    const findScrollableAncestor = (start) => {
      let node = (start && start.parentElement) ? start.parentElement : null;
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        const isScrollable = ['auto', 'scroll', 'overlay'].includes(overflowY)
          && node.scrollHeight > node.clientHeight + 8;
        if (isScrollable) return node;
        node = node.parentElement;
      }
      return null;
    };

    const cards = Array.from(document.querySelectorAll(cardSelectors.join(',')));
    const uniqueIds = new Set();
    for (const card of cards) {
      const idFromCard = card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id');
      const link = card.querySelector('a[href*="/jobs/view/"]');
      const idFromLink = link && link.href ? ((link.href.match(/\\/jobs\\/view\\/(\\d+)/) || [])[1]) : '';
      const id = idFromCard || idFromLink;
      if (id) uniqueIds.add(id);
    }

    const candidates = [];
    for (const selector of containerSelectors) {
      const el = document.querySelector(selector);
      if (el) candidates.push(el);
    }

    const sentinel = document.querySelector('[data-results-list-top-scroll-sentinel]');
    const sentinelScrollable = findScrollableAncestor(sentinel);
    if (sentinelScrollable) candidates.push(sentinelScrollable);

    const firstCard = document.querySelector('li[data-occludable-job-id], li[data-job-id], .scaffold-layout__list-item');
    const cardScrollable = findScrollableAncestor(firstCard);
    if (cardScrollable) candidates.push(cardScrollable);

    const usable = candidates.filter((el) => el.scrollHeight > el.clientHeight + 8);
    usable.sort((a, b) => b.clientHeight - a.clientHeight);
    const listContainer = usable.length > 0 ? usable[0] : null;

    if (!listContainer) {
      return { cardCount: uniqueIds.size, hasContainer: false, atBottom: false };
    }

    const remaining = listContainer.scrollHeight - listContainer.clientHeight - listContainer.scrollTop;
    return { cardCount: uniqueIds.size, hasContainer: true, atBottom: remaining <= 8 };
  })()`)

  return result as { cardCount: number; hasContainer: boolean; atBottom: boolean }
}

async function extractVisibleLinkedInJobs(page: Page): Promise<ScrapedJob[]> {
  const jobs = await page.evaluate(`(() => {
    const results = [];
    const seenIds = new Set();
    const cards = document.querySelectorAll('li[data-occludable-job-id], li[data-job-id], .jobs-search-results__list-item, .scaffold-layout__list-item');

    cards.forEach((card) => {
      const idFromCard = card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id');
      const linkEl = card.querySelector('a.job-card-list__title--link[href*="/jobs/view/"], a[href*="/jobs/view/"]');
      const idFromLink = linkEl && linkEl.href ? ((linkEl.href.match(/\\/jobs\\/view\\/(\\d+)/) || [])[1]) : '';
      const jobId = idFromCard || idFromLink;
      if (!jobId || seenIds.has(jobId)) return;

      const strongEl = card.querySelector('.job-card-list__title--link strong');
      const titleFromStrong = strongEl && strongEl.textContent ? strongEl.textContent.trim() : '';
      const titleFromLink = linkEl && linkEl.textContent ? linkEl.textContent.trim() : '';
      const ariaLabel = linkEl ? (linkEl.getAttribute('aria-label') || '') : '';
      const titleFromAria = ariaLabel.includes(' with verification')
        ? ariaLabel.replace(' with verification', '').trim()
        : ariaLabel.trim();
      const title = titleFromStrong || titleFromLink || titleFromAria;
      if (!title || title.length < 2) return;

      seenIds.add(jobId);

      const companyNode = card.querySelector('.artdeco-entity-lockup__subtitle span, .job-card-container__company-name, .job-card-container__primary-description');
      const company = companyNode && companyNode.textContent ? companyNode.textContent.trim() : '';

      const extractRelative = (sourceText) => {
        if (!sourceText) return '';
        const txt = sourceText.replace(/\\s+/g, ' ').trim();
        if (/just now/i.test(txt)) return 'just now';
        const m = txt.match(/(\\d+)\\s+(\\w+)\\s+ago/i);
        return m ? (m[1] + ' ' + m[2] + ' ago') : '';
      };

      const normalizeText = (text) => text ? text.replace(/\\s+/g, ' ').trim() : '';

      const metadataTexts = Array.from(card.querySelectorAll('.job-card-container__metadata-wrapper li span, .job-card-container__metadata-wrapper li'))
        .map((el) => normalizeText(el.textContent))
        .filter(Boolean);
      const metadataLineNode = card.querySelector('.job-card-container__metadata-wrapper');
      const metadataLine = metadataLineNode ? normalizeText(metadataLineNode.textContent) : '';

      const fallbackLocNode = card.querySelector('.job-card-container__metadata-item, [class*="metadata-item"]');
      const fallbackLoc = fallbackLocNode ? normalizeText(fallbackLocNode.textContent) : '';
      const locationFromLine = metadataLine
        ? normalizeText((metadataLine.split('·')[0] || '').trim())
        : '';
      const locationRaw = locationFromLine || metadataTexts[0] || fallbackLoc || '';

      const locationClean = locationRaw
        .replace(/\\((?:remote|hybrid|on[- ]?site)\\)/ig, '')
        .replace(/\\s+,/g, ',')
        .replace(/\\s{2,}/g, ' ')
        .trim();

      const typeCandidates = [];
      const pushType = (value) => {
        const cleaned = normalizeText(value);
        if (cleaned) typeCandidates.push(cleaned);
      };

      const parenMatches = Array.from(locationRaw.matchAll(/\\(([^)]+)\\)/g));
      for (const match of parenMatches) pushType(match[1]);

      for (const token of metadataTexts.slice(1)) {
        if (!token) continue;
        if (extractRelative(token)) continue;
        if (/applicants?/i.test(token)) continue;
        if (/easy apply/i.test(token)) continue;

        const subTokens = token
          .split(/[·|,]/)
          .map((x) => normalizeText(x))
          .filter(Boolean);

        for (const sub of subTokens) {
          if (/^(remote|hybrid|on[- ]?site|full[- ]?time|part[- ]?time|internship|contract|temporary|freelance|apprenticeship|working student|werkstudent)$/i.test(sub)) {
            pushType(sub);
          }
        }
      }

      if (metadataLine) {
        const lineTokens = metadataLine
          .split(/[·|]/)
          .map((x) => normalizeText(x))
          .filter(Boolean);
        for (const token of lineTokens) {
          if (!token) continue;
          if (extractRelative(token)) continue;
          if (/people clicked apply|person clicked apply|applicants?/i.test(token)) continue;
          if (/^(remote|hybrid|on[- ]?site|full[- ]?time|part[- ]?time|internship|contract|temporary|freelance|apprenticeship|working student|werkstudent)$/i.test(token)) {
            pushType(token);
          }
        }
      }

      const dedupTypes = [];
      const seenType = new Set();
      for (const item of typeCandidates) {
        const key = item.toLowerCase();
        if (seenType.has(key)) continue;
        seenType.add(key);
        dedupTypes.push(item);
      }
      const jobType = dedupTypes.join(', ');

      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      const textParts = [];
      let walkerNode;
      while ((walkerNode = walker.nextNode())) {
        const t = (walkerNode.nodeValue || '').trim();
        if (t) textParts.push(t);
      }
      const allCardText = textParts.join(' ');

      const timeEl = card.querySelector('time');
      const dateAttr = timeEl ? (timeEl.getAttribute('datetime') || '') : '';
      const dateStr = extractRelative(allCardText) || dateAttr;

      results.push({
        id: crypto.randomUUID(),
        title,
        company: company || 'Unknown',
        location: locationClean || locationRaw,
        jobType: jobType,
        platform: 'linkedin',
        url: 'https://www.linkedin.com/jobs/view/' + jobId + '/',
        postedDate: dateStr,
      });
    });

    return results;
  })()`)

  return jobs as ScrapedJob[]
}

/**
 * In-page scroll only — no Playwright mouse (avoids opening job detail / leaving /jobs/search).
 */
async function scrollLinkedInListOnce(page: Page): Promise<boolean> {
  const ok = await page.evaluate(`(() => {
    const containerSelectors = ${JSON.stringify(LINKEDIN_LIST_CONTAINER_SELECTORS)};

    const findScrollableAncestor = (start) => {
      let node = (start && start.parentElement) ? start.parentElement : null;
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        const isScrollable = ['auto', 'scroll', 'overlay'].includes(overflowY)
          && node.scrollHeight > node.clientHeight + 8;
        if (isScrollable) return node;
        node = node.parentElement;
      }
      return null;
    };

    const candidates = [];
    for (const selector of containerSelectors) {
      const el = document.querySelector(selector);
      if (el) candidates.push(el);
    }

    const sentinel = document.querySelector('[data-results-list-top-scroll-sentinel]');
    const sentinelScrollable = findScrollableAncestor(sentinel);
    if (sentinelScrollable) candidates.push(sentinelScrollable);

    const firstCard = document.querySelector('li[data-occludable-job-id], li[data-job-id], .scaffold-layout__list-item');
    const cardScrollable = findScrollableAncestor(firstCard);
    if (cardScrollable) candidates.push(cardScrollable);

    const usable = candidates.filter((el) => el.scrollHeight > el.clientHeight + 8);
    if (usable.length === 0) return false;
    usable.sort((a, b) => b.clientHeight - a.clientHeight);
    const listContainer = usable[0];

    if (typeof listContainer.focus === 'function') listContainer.focus({ preventScroll: true });
    listContainer.scrollBy({ top: Math.max(520, Math.floor(listContainer.clientHeight * 0.9)), behavior: 'auto' });
    listContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    return true;
  })()`)

  return Boolean(ok)
}

export async function scrapeLinkedIn(
  jobTitle: string,
  location: string,
  onProgress: ProgressCallback,
  userId = 'admin',
): Promise<ScrapedJob[]> {
  const session = getSession(userId, 'linkedin')
  if (!session) {
    onProgress({ type: 'error', platform: 'linkedin', error: 'LinkedIn is not connected. Go to Settings → connect.' })
    return []
  }

  let page = null
  try {
    page = await getLinkedInFirefoxPage()

    const replayCookies = sanitizeLinkedInCookiesForReplay(session.cookies as Protocol.Network.CookieParam[])
    const hasLiAtInStore = replayCookies.some((c) => c.name === 'li_at' && c.value.length > 0)
    if (!hasLiAtInStore) {
      clearSession(userId, 'linkedin')
      onProgress({
        type: 'error',
        platform: 'linkedin',
        error: 'Stored LinkedIn token is missing. Reconnect LinkedIn in Settings.',
      })
      return []
    }
    // Do NOT clear the whole cookie jar here — that wipes local/session storage LinkedIn uses and
    // looks like a brand-new client every scrape (429, NS_ERROR_NET_EMPTY_RESPONSE). Manual Connect
    // keeps a live profile; we only merge/overwrite cookies from memory (same as reconnecting tabs).
    await page.context().addCookies(protocolCookiesToPlaywright(replayCookies))
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

    // Space out navigations — LinkedIn aggressively rate-limits (HTTP 429) on repeated loads.
    const preNavBase = Number(process.env.LINKEDIN_PRE_NAV_COOLDOWN_MS ?? '10000')
    await sleep(Math.max(0, preNavBase) + Math.random() * 8000)
    await jitter(400, 1200)

    onProgress({ type: 'progress', platform: 'linkedin', progress: 10 })

    const params = new URLSearchParams({
      keywords: jobTitle,
      location,
      f_TPR: 'r604800',
      sortBy: 'DD',
      start: '0',
    })
    const searchUrl = `https://www.linkedin.com/jobs/search/?${params}`
    console.log('[linkedin] navigating →', searchUrl)

    let rateLimited = false
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        console.log('[linkedin] rate limited — waiting ~90s then retrying navigation once')
        await sleep(75_000 + Math.random() * 30_000)
      }
      await gotoLinkedInJobSearch(page, searchUrl)
      rateLimited = await isLinkedInRateLimitedPage(page)
      if (!rateLimited) break
    }

    const currentUrl = page.url()
    if (rateLimited) {
      onProgress({
        type: 'error',
        platform: 'linkedin',
        error:
          'LinkedIn returned HTTP 429 (too many requests). Wait 30–60 minutes, avoid running scrapes back-to-back, and set PUPPETEER_HEADLESS=false locally to reduce automation signals.',
      })
      return []
    }
    if (isBlockedLinkedInUrl(currentUrl)) {
      clearSession(userId, 'linkedin')
      onProgress({
        type: 'error',
        platform: 'linkedin',
        error: 'LinkedIn redirected to login/checkpoint. Session cleared — reconnect with a fresh li_at token.',
      })
      return []
    }

    onProgress({ type: 'progress', platform: 'linkedin', progress: 25 })

    let jobCardCount = 0
    let hasListContainer = false
    for (let i = 0; i < 14; i++) {
      await sleep(1500)
      if (isBlockedLinkedInUrl(page.url())) {
        clearSession(userId, 'linkedin')
        onProgress({
          type: 'error',
          platform: 'linkedin',
          error: 'LinkedIn redirected to login/security during scrape. Session cleared — reconnect in Settings.',
        })
        return []
      }

      let state: { cardCount: number; hasContainer: boolean; atBottom: boolean }
      try {
        state = await getLinkedInListState(page)
      } catch (err) {
        if (isTransientEvalError(err)) {
          console.log(`[linkedin] transient eval error during poll ${i + 1}: ${err instanceof Error ? err.message : String(err)}`)
          continue
        }
        throw err
      }
      jobCardCount = state.cardCount
      hasListContainer = state.hasContainer
      console.log(`[linkedin] poll ${i + 1}: cards=${jobCardCount}, listContainer=${hasListContainer ? 'yes' : 'no'}`)
      if (jobCardCount > 0) break
    }

    if (jobCardCount === 0) {
      if (await isLinkedInRateLimitedPage(page)) {
        onProgress({
          type: 'error',
          platform: 'linkedin',
          error: 'LinkedIn returned HTTP 429 instead of jobs. Wait 15-30 minutes before next scrape.',
        })
        return []
      }
      onProgress({
        type: 'error',
        platform: 'linkedin',
        error: 'No job results loaded. Session may be expired — disconnect and re-connect LinkedIn in Settings.',
      })
      return []
    }

    await sleep(3500)
    onProgress({ type: 'progress', platform: 'linkedin', progress: 50 })

    const collectedByUrl = new Map<string, ScrapedJob>()
    const mergeCollected = (jobs: ScrapedJob[]) => {
      for (const job of jobs) {
        const existing = collectedByUrl.get(job.url)
        if (!existing || (!existing.postedDate && job.postedDate)) {
          collectedByUrl.set(job.url, job)
        }
      }
    }

    let initialVisibleJobs: ScrapedJob[] = []
    try {
      initialVisibleJobs = await extractVisibleLinkedInJobs(page)
    } catch (err) {
      if (isTransientEvalError(err)) {
        console.log(`[linkedin] transient eval error during initial extract: ${err instanceof Error ? err.message : String(err)}`)
      } else {
        throw err
      }
    }
    mergeCollected(initialVisibleJobs)
    console.log(`[linkedin] visible extraction (initial): ${initialVisibleJobs.length}, collected=${collectedByUrl.size}`)

    let prev = jobCardCount
    let stuck = 0
    let noScrollStreak = 0
    for (let round = 0; round < 50; round++) {
      if (page.isClosed()) {
        console.warn('[linkedin] page closed during scroll — returning partial results')
        break
      }
      if (isBlockedLinkedInUrl(page.url())) {
        clearSession(userId, 'linkedin')
        onProgress({
          type: 'error',
          platform: 'linkedin',
          error: 'LinkedIn redirected to login/security during scrolling. Session cleared — reconnect in Settings.',
        })
        return []
      }

      const stillOnSearch = await ensureJobSearchListPage(page, searchUrl)
      if (!stillOnSearch) {
        console.warn('[linkedin] could not load job search — finishing with partial results')
        break
      }

      if (await isLinkedInRateLimitedPage(page)) {
        onProgress({
          type: 'error',
          platform: 'linkedin',
          error:
            'LinkedIn rate limited (HTTP 429). Wait 20–40 minutes between scrapes; increase LINKEDIN_PRE_NAV_COOLDOWN_MS if needed.',
        })
        return []
      }

      let scrolled = false
      try {
        scrolled = await scrollLinkedInListOnce(page)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (isPageClosedError(msg)) {
          console.warn('[linkedin] page died during scroll — returning partial results')
          break
        }
        if (isTransientEvalError(err)) {
          console.log(`[linkedin] transient eval error during scroll ${round + 1}: ${msg}`)
          await sleep(900)
          continue
        }
        throw err
      }

      if (!scrolled) {
        noScrollStreak++
        console.log('[linkedin] list container not found during scroll; retrying after delay')
        if (noScrollStreak >= 10) {
          console.warn('[linkedin] list container missing too many times — finishing with partial results')
          break
        }
        await sleep(1000)
        continue
      }
      noScrollStreak = 0

      await sleep(900)

      let state: { cardCount: number; hasContainer: boolean; atBottom: boolean }
      let visibleJobs: ScrapedJob[] = []
      try {
        state = await getLinkedInListState(page)
        visibleJobs = await extractVisibleLinkedInJobs(page)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (isPageClosedError(msg)) {
          console.warn('[linkedin] page died after scroll — returning partial results')
          break
        }
        if (isTransientEvalError(err)) {
          console.log(`[linkedin] transient eval error after scroll ${round + 1}: ${msg}`)
          continue
        }
        throw err
      }
      const beforeMerge = collectedByUrl.size
      mergeCollected(visibleJobs)
      const newlyCollected = collectedByUrl.size - beforeMerge

      const count = state.cardCount
      console.log(`[linkedin] scroll round ${round + 1}: cards=${count}, atBottom=${state.atBottom ? 'yes' : 'no'}, +${newlyCollected} jobs, total=${collectedByUrl.size}`)

      if (collectedByUrl.size >= SCRAPE_JOBS_PER_PLATFORM_LIMIT) {
        console.log(`[linkedin] collected ${SCRAPE_JOBS_PER_PLATFORM_LIMIT} jobs — done (no extra scrolling)`)
        break
      }

      if (count === 0 && prev > 0) {
        if (isJobSearchListUrl(page.url())) {
          console.warn('[linkedin] 0 cards but still on /jobs/search — list may be repainting; waiting')
          await sleep(2200)
          continue
        }
        console.warn('[linkedin] card count dropped to 0 — navigated off job search; recovering')
        const ok = await ensureJobSearchListPage(page, searchUrl)
        if (!ok) {
          console.warn('[linkedin] recovery failed — finishing with partial results')
          break
        }
        prev = 0
        stuck = 0
        continue
      }

      if (count > prev) {
        stuck = 0
      } else {
        stuck++
      }

      if (round >= 8 && state.atBottom && stuck >= 2) {
        console.log('[linkedin] reached list bottom with no new cards; done scrolling')
        break
      }

      if (count >= 120) {
        console.log('[linkedin] reached 120 cards cap — done scrolling')
        break
      }

      if (stuck >= 6) {
        console.log('[linkedin] no new cards after 6 list-scroll rounds — stopping')
        break
      }

      prev = count
    }

    await sleep(800)
    onProgress({ type: 'progress', platform: 'linkedin', progress: 75 })

    let finalVisibleJobs: ScrapedJob[] = []
    try {
      finalVisibleJobs = await extractVisibleLinkedInJobs(page)
    } catch (err) {
      if (isTransientEvalError(err)) {
        console.log(`[linkedin] transient eval error during final extract: ${err instanceof Error ? err.message : String(err)}`)
      } else {
        throw err
      }
    }
    mergeCollected(finalVisibleJobs)
    const rawJobs = Array.from(collectedByUrl.values())

    console.log(`[linkedin] extracted ${rawJobs.length} jobs`)

    const normalized = rawJobs.map((j) => ({
      ...j,
      postedDate: parseLinkedInDate(j.postedDate),
    }))
    console.log(`[linkedin] normalized postedDate for ${normalized.filter((j) => !!j.postedDate).length}/${normalized.length} jobs`)

    await persistLinkedInSessionFromPage(page, session.username, userId)

    onProgress({ type: 'progress', platform: 'linkedin', progress: 100 })
    return limitScrapedJobs(normalized)

  } catch (err) {
    console.error('[linkedin] scrape error:', err)
    const msg = err instanceof Error ? err.message : String(err)
    if (isLinkedInRedirectLoopError(msg)) {
      clearSession(userId, 'linkedin')
      onProgress({
        type: 'error',
        platform: 'linkedin',
        error: 'LinkedIn session entered redirect loop. Session cleared — paste a fresh li_at token in Settings and retry.',
      })
      return []
    }
    onProgress({ type: 'error', platform: 'linkedin', error: msg })
    return []
  } finally {
    // Close tab only — keep Firefox + browser context alive so the next scrape reuses the same
    // session fingerprint (like AUTH_MANUAL_CONNECT). Tearing down the whole browser each run
    // triggered 429 and flaky navigations.
    if (page) await page.close().catch(() => undefined)
  }
}
