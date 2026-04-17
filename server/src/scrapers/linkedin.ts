/**
 * LinkedIn scraper — authenticated Puppeteer session.
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
import path from 'path'
import { getBrowserPage, sleep } from '../utils/browser'
import { getSession } from '../utils/sessions'
import { subHours, subDays } from 'date-fns'
import type { ScrapedJob, ProgressCallback } from './types'
import { limitScrapedJobs } from './limits'

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

  // Find "NUMBER UNIT ago" — grab the 2 words before "ago"
  const m = t.match(/(\d+)\s+(\w+)\s+ago/)
  if (m) {
    const n = Number(m[1])
    const unit = m[2]
    if (unit.startsWith('mo')) return subDays(new Date(), n * 30).toISOString()  // month — before 'm'
    if (unit.startsWith('m')) return new Date(Date.now() - n * 60_000).toISOString()  // minute/min
    if (unit.startsWith('h')) return subHours(new Date(), n).toISOString()           // hour/hr
    if (unit.startsWith('d')) return subDays(new Date(), n).toISOString()            // day
    if (unit.startsWith('w')) return subDays(new Date(), n * 7).toISOString()        // week
    if (unit.startsWith('s')) return new Date(Date.now() - n * 1_000).toISOString() // second
  }

  // German: "vor N Einheit" (no "ago")
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

  // ISO / absolute date fallback (e.g. datetime="2026-04-15T09:00:00.000Z")
  const d = new Date(raw)
  return isNaN(d.getTime()) ? '' : d.toISOString()
}

async function saveScreenshot(page: import('puppeteer').Page, name: string) {
  const p = path.join('/tmp', name)
  await page.screenshot({ path: p }).catch(() => {})
  console.log(`[linkedin] screenshot → ${p}`)
}

function isBlockedLinkedInUrl(url: string): boolean {
  return url.includes('/login') || url.includes('/authwall') || url.includes('/checkpoint') || url.includes('/challenge')
}

function isTransientEvalError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('Execution context was destroyed')
    || msg.includes('Cannot find context with specified id')
    || msg.includes('Protocol error')
}

async function getLinkedInListState(page: import('puppeteer').Page): Promise<{
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

async function extractVisibleLinkedInJobs(page: import('puppeteer').Page): Promise<ScrapedJob[]> {
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

      // Find "NUMBER UNIT ago" — no \b anchors because textContent can concatenate
      // words without spaces (e.g. "Berlin3hoursago"), making \b unreliable.
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

      // (Hybrid), (Remote), (On-site) shown inside location.
      const parenMatches = Array.from(locationRaw.matchAll(/\\(([^)]+)\\)/g));
      for (const match of parenMatches) pushType(match[1]);

      // Additional metadata tags often include work mode / contract type.
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

      // Parse tags from the same metadata line:
      // "Düsseldorf ... (Hybrid) · Reposted 22 minutes ago · Over 100 people clicked apply"
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

      // Walk every text node under the card and join with spaces. This is the only
      // bulletproof way to get properly-separated text from arbitrary DOM — both
      // card.textContent (concatenates without spaces: "Berlin3hoursago") and
      // card.innerText (empty for occluded cards) fail in LinkedIn's virtualized
      // list. TreeWalker visits every text node regardless of layout/visibility.
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

async function scrollLinkedInListOnce(page: import('puppeteer').Page): Promise<boolean> {
  const result = await page.evaluate(`(() => {
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
    if (usable.length === 0) return { ok: false, x: 0, y: 0 };
    usable.sort((a, b) => b.clientHeight - a.clientHeight);
    const listContainer = usable[0];

    if (typeof listContainer.focus === 'function') listContainer.focus();
    listContainer.scrollBy({ top: Math.max(520, Math.floor(listContainer.clientHeight * 0.9)), behavior: 'auto' });
    listContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    listContainer.dispatchEvent(new WheelEvent('wheel', { deltaY: 520, bubbles: true, cancelable: true }));

    const rect = listContainer.getBoundingClientRect();
    return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`) as { ok: boolean; x: number; y: number }

  if (result.ok) {
    // Also send real wheel events at list-center; LinkedIn lazy-load often hooks this.
    await page.mouse.move(result.x, result.y)
    await page.mouse.wheel({ deltaY: 640 })
    return true
  }

  return false
}

export async function scrapeLinkedIn(
  jobTitle: string,
  location: string,
  onProgress: ProgressCallback,
): Promise<ScrapedJob[]> {
  const session = getSession('linkedin')
  if (!session) {
    onProgress({ type: 'error', platform: 'linkedin', error: 'LinkedIn is not connected. Go to Settings → connect.' })
    return []
  }

  let page = null
  try {
    page = await getBrowserPage(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.setCookie(...(session.cookies as any[]))
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

    onProgress({ type: 'progress', platform: 'linkedin', progress: 10 })

    const params = new URLSearchParams({
      keywords: jobTitle,
      location,
      f_TPR:  'r604800',
      sortBy: 'DD',
      start:  '0',
    })
    const searchUrl = `https://www.linkedin.com/jobs/search/?${params}`
    console.log('[linkedin] navigating →', searchUrl)

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35_000 })

    const currentUrl = page.url()
    if (isBlockedLinkedInUrl(currentUrl)) {
      await saveScreenshot(page, 'linkedin-blocked.png')
      onProgress({ type: 'error', platform: 'linkedin', error: 'Session expired or security check. Re-connect LinkedIn in Settings.' })
      return []
    }

    await saveScreenshot(page, 'linkedin-after-load.png')
    onProgress({ type: 'progress', platform: 'linkedin', progress: 25 })

    // ── Poll until job cards appear (max ~21 s) ───────────────────────────────
    let jobCardCount = 0
    let hasListContainer = false
    for (let i = 0; i < 14; i++) {
      await sleep(1500)
      if (isBlockedLinkedInUrl(page.url())) {
        await saveScreenshot(page, 'linkedin-blocked-during-poll.png')
        onProgress({ type: 'error', platform: 'linkedin', error: 'LinkedIn redirected to login/security page during scrape. Re-connect LinkedIn.' })
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
      console.log(
        `[linkedin] poll ${i + 1}: cards=${jobCardCount}, listContainer=${hasListContainer ? 'yes' : 'no'}`,
      )
      if (jobCardCount > 0) break
    }

    if (jobCardCount === 0) {
      await saveScreenshot(page, 'linkedin-no-results.png')
      onProgress({
        type: 'error',
        platform: 'linkedin',
        error: 'No job results loaded. Session may be expired — disconnect and re-connect LinkedIn in Settings.',
      })
      return []
    }

    // Wait a bit after first cards appear to avoid early close/extract.
    await sleep(3500)
    onProgress({ type: 'progress', platform: 'linkedin', progress: 50 })

    const collectedByUrl = new Map<string, ScrapedJob>()
    const mergeCollected = (jobs: ScrapedJob[]) => {
      for (const job of jobs) {
        const existing = collectedByUrl.get(job.url)
        // Always prefer the version that has time data. LinkedIn uses virtual
        // scrolling (occlusion): a card first captured while partially rendered
        // may have no postedDate — a later full render will have it, so we must
        // allow the update.
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

    // ── Scroll the job-list container itself (not document/body) ──────────────
    // LinkedIn job results are inside an inner scrollable panel. Scrolling the
    // full page often does nothing for lazy-loaded cards.
    let prev = jobCardCount
    let stuck = 0
    for (let round = 0; round < 50; round++) {
      if (isBlockedLinkedInUrl(page.url())) {
        await saveScreenshot(page, 'linkedin-blocked-during-scroll.png')
        onProgress({ type: 'error', platform: 'linkedin', error: 'LinkedIn redirected to login/security page during scrolling. Re-connect LinkedIn.' })
        return []
      }

      let scrolled = false
      try {
        scrolled = await scrollLinkedInListOnce(page)
      } catch (err) {
        if (isTransientEvalError(err)) {
          console.log(`[linkedin] transient eval error during scroll ${round + 1}: ${err instanceof Error ? err.message : String(err)}`)
          await sleep(900)
          continue
        }
        throw err
      }

      if (!scrolled) {
        console.log('[linkedin] list container not found during scroll; retrying after delay')
        await sleep(1000)
        continue
      }

      await sleep(900)

      let state: { cardCount: number; hasContainer: boolean; atBottom: boolean }
      let visibleJobs: ScrapedJob[] = []
      try {
        state = await getLinkedInListState(page)
        visibleJobs = await extractVisibleLinkedInJobs(page)
      } catch (err) {
        if (isTransientEvalError(err)) {
          console.log(`[linkedin] transient eval error after scroll ${round + 1}: ${err instanceof Error ? err.message : String(err)}`)
          continue
        }
        throw err
      }
      const beforeMerge = collectedByUrl.size
      mergeCollected(visibleJobs)
      const newlyCollected = collectedByUrl.size - beforeMerge

      const count = state.cardCount
      console.log(
        `[linkedin] scroll round ${round + 1}: cards=${count}, atBottom=${state.atBottom ? 'yes' : 'no'}, +${newlyCollected} jobs, total=${collectedByUrl.size}`,
      )

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
    if (rawJobs.length === 0) await saveScreenshot(page, 'linkedin-extract-empty.png')

    const normalized = rawJobs.map((j) => ({
      ...j,
      postedDate: parseLinkedInDate(j.postedDate),
    }))
    console.log(
      `[linkedin] normalized postedDate for ${normalized.filter((j) => !!j.postedDate).length}/${normalized.length} jobs`,
    )

    onProgress({ type: 'progress', platform: 'linkedin', progress: 100 })
    return limitScrapedJobs(normalized)

  } catch (err) {
    if (page) await saveScreenshot(page, 'linkedin-error.png')
    console.error('[linkedin] scrape error:', err)
    onProgress({ type: 'error', platform: 'linkedin', error: err instanceof Error ? err.message : String(err) })
    return []
  } finally {
    if (page) await page.close().catch(() => undefined)
  }
}
