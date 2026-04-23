#!/usr/bin/env python3
"""
JobHawk LinkedIn Agent

Run:  python3 linkedin_agent.py
"""

import sys

# ── Dependency check ──────────────────────────────────────────────────────────
_missing = []
try:
    import websockets
except ImportError:
    _missing.append("websockets>=12.0")
try:
    from playwright.async_api import async_playwright
    _playwright_missing = False
except ImportError:
    _playwright_missing = True
    _missing.append("playwright>=1.44.0")

if _missing:
    print("Missing dependencies. Install them with:")
    print(f"\n    pip install {' '.join(_missing)}")
    if _playwright_missing:
        print("    playwright install chromium")
    print()
    sys.exit(1)

# ── Imports (safe after check) ────────────────────────────────────────────────
import asyncio
import json
import os
import re
import uuid
import signal
import logging
import argparse
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from urllib.parse import urlencode
from playwright.async_api import BrowserContext, Page

# ── Config ────────────────────────────────────────────────────────────────────

VERSION = "1.0.0"
PROFILE_DIR = Path.home() / ".jobradar_agent"
CHROME_PROFILE = PROFILE_DIR / "chrome_profile"

# This URL is replaced at download time by the backend.
# If you downloaded this script manually, set JOBRADAR_BACKEND_URL env var instead.
DEFAULT_BACKEND_URL = "https://jobhawk-server-production.up.railway.app"
# DEFAULT_BACKEND_URL = "http://localhost:3001"
# DEFAULT_SERVER_BACKEND_URL = "https://jobhawk-server-production.up.railway.app"


HEARTBEAT_INTERVAL = 25
RECONNECT_DELAY = 5
MAX_JOBS = 100

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("linkedin-agent")

# ── Date parsing ──────────────────────────────────────────────────────────────

def parse_linkedin_date(raw: str) -> str:
    if not raw:
        return ""
    t = raw.lower().strip()
    now = datetime.utcnow()
    fmt = "%Y-%m-%dT%H:%M:%SZ"

    if "just now" in t or "gerade eben" in t:
        return now.strftime(fmt)

    m = re.search(r"(\d+)\s+(\w+)\s+ago", t)
    if m:
        n, u = int(m.group(1)), m.group(2)
        if u.startswith("mo"): return (now - timedelta(days=n * 30)).strftime(fmt)
        if u.startswith("m"):  return (now - timedelta(minutes=n)).strftime(fmt)
        if u.startswith("h"):  return (now - timedelta(hours=n)).strftime(fmt)
        if u.startswith("d"):  return (now - timedelta(days=n)).strftime(fmt)
        if u.startswith("w"):  return (now - timedelta(weeks=n)).strftime(fmt)
        if u.startswith("s"):  return (now - timedelta(seconds=n)).strftime(fmt)

    m = re.search(r"vor\s+(\d+)\s+(\w+)", t)
    if m:
        n, u = int(m.group(1)), m.group(2)
        if u.startswith("sek"): return (now - timedelta(seconds=n)).strftime(fmt)
        if u.startswith("min"): return (now - timedelta(minutes=n)).strftime(fmt)
        if u.startswith("stu"): return (now - timedelta(hours=n)).strftime(fmt)
        if u.startswith("tag"): return (now - timedelta(days=n)).strftime(fmt)
        if u.startswith("woc"): return (now - timedelta(weeks=n)).strftime(fmt)
        if u.startswith("mon"): return (now - timedelta(days=n * 30)).strftime(fmt)

    return ""

# ── LinkedIn DOM helpers (exact logic from the Node.js scraper) ───────────────

_SCROLL_JS = """
(() => {
    const sels = ['.scaffold-layout__list','.scaffold-layout__list-container',
        '.jobs-search-results-list','.jobs-search-results__list',"main [role='list']",'main ul'];
    const findSc = el => {
        let n = el && el.parentElement;
        while (n && n !== document.body) {
            const s = window.getComputedStyle(n);
            if (['auto','scroll','overlay'].includes(s.overflowY) && n.scrollHeight > n.clientHeight + 8) return n;
            n = n.parentElement;
        }
        return null;
    };
    const cs = [];
    for (const s of sels) { const e = document.querySelector(s); if (e) cs.push(e); }
    const fc = document.querySelector('li[data-occludable-job-id],li[data-job-id]');
    if (fc) { const sc = findSc(fc); if (sc) cs.push(sc); }
    const usable = cs.filter(e => e.scrollHeight > e.clientHeight + 8);
    if (!usable.length) return false;
    usable.sort((a,b) => b.clientHeight - a.clientHeight);
    const c = usable[0];
    c.scrollBy({ top: Math.max(520, Math.floor(c.clientHeight * 0.9)), behavior: 'auto' });
    c.dispatchEvent(new Event('scroll', { bubbles: true }));
    return true;
})()
"""

_STATE_JS = """
(() => {
    const cSels = ['li[data-occludable-job-id]','li[data-job-id]','.jobs-search-results__list-item'];
    const cards = document.querySelectorAll(cSels.join(','));
    const ids = new Set();
    for (const c of cards) {
        const id = c.getAttribute('data-occludable-job-id') || c.getAttribute('data-job-id');
        const lk = c.querySelector('a[href*="/jobs/view/"]');
        const il = lk && lk.href ? (lk.href.match(/\\/jobs\\/view\\/(\\d+)/) || [])[1] : '';
        if (id || il) ids.add(id || il);
    }
    const sels = ['.scaffold-layout__list','.scaffold-layout__list-container',
        '.jobs-search-results-list','.jobs-search-results__list',"main [role='list']",'main ul'];
    const findSc = el => {
        let n = el && el.parentElement;
        while (n && n !== document.body) {
            const s = window.getComputedStyle(n);
            if (['auto','scroll','overlay'].includes(s.overflowY) && n.scrollHeight > n.clientHeight + 8) return n;
            n = n.parentElement;
        }
        return null;
    };
    const cs = [];
    for (const s of sels) { const e = document.querySelector(s); if (e) cs.push(e); }
    const fc = document.querySelector('li[data-occludable-job-id],li[data-job-id]');
    const sc = findSc(fc); if (sc) cs.push(sc);
    const usable = cs.filter(e => e.scrollHeight > e.clientHeight + 8);
    usable.sort((a,b) => b.clientHeight - a.clientHeight);
    const container = usable.length ? usable[0] : null;
    const remaining = container ? container.scrollHeight - container.clientHeight - container.scrollTop : 0;
    return { count: ids.size, atBottom: remaining <= 8 };
})()
"""

_EXTRACT_JS = """
(() => {
    const results = [], seenIds = new Set();
    const cards = document.querySelectorAll(
        'li[data-occludable-job-id],li[data-job-id],.jobs-search-results__list-item,.scaffold-layout__list-item');
    cards.forEach(card => {
        const idc = card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id');
        const lk = card.querySelector('a.job-card-list__title--link[href*="/jobs/view/"],a[href*="/jobs/view/"]');
        const idl = lk && lk.href ? (lk.href.match(/\\/jobs\\/view\\/(\\d+)/) || [])[1] : '';
        const jobId = idc || idl;
        if (!jobId || seenIds.has(jobId)) return;
        const st = card.querySelector('.job-card-list__title--link strong');
        const title = (st && st.textContent ? st.textContent.trim() : '')
            || (lk && lk.textContent ? lk.textContent.trim() : '')
            || (lk ? (lk.getAttribute('aria-label') || '').replace(' with verification','').trim() : '');
        if (!title || title.length < 2) return;
        seenIds.add(jobId);
        const cn = card.querySelector('.artdeco-entity-lockup__subtitle span,.job-card-container__company-name,.job-card-container__primary-description');
        const company = cn && cn.textContent ? cn.textContent.trim() : '';
        const nt = t => t ? t.replace(/\\s+/g,' ').trim() : '';
        const er = txt => {
            if (!txt) return '';
            const t = txt.replace(/\\s+/g,' ').trim();
            if (/just now/i.test(t)) return 'just now';
            const m = t.match(/(\\d+)\\s+(\\w+)\\s+ago/i);
            return m ? `${m[1]} ${m[2]} ago` : '';
        };
        const mts = Array.from(card.querySelectorAll(
            '.job-card-container__metadata-wrapper li span,.job-card-container__metadata-wrapper li'
        )).map(e => nt(e.textContent)).filter(Boolean);
        const mln = card.querySelector('.job-card-container__metadata-wrapper');
        const ml = mln ? nt(mln.textContent) : '';
        const fln = card.querySelector('.job-card-container__metadata-item,[class*="metadata-item"]');
        const fl = fln ? nt(fln.textContent) : '';
        const lr = (ml ? nt((ml.split('·')[0]||'').trim()) : '') || mts[0] || fl || '';
        const lc = lr.replace(/\\((?:remote|hybrid|on[- ]?site)\\)/ig,'').replace(/\\s+,/g,',').replace(/\\s{2,}/g,' ').trim();
        const tc = [], st2 = new Set();
        const pt = v => { const c=nt(v); if(c) tc.push(c); };
        for (const m of Array.from(lr.matchAll(/\\(([^)]+)\\)/g))) pt(m[1]);
        const tp = /^(remote|hybrid|on[- ]?site|full[- ]?time|part[- ]?time|internship|contract|temporary|freelance|apprenticeship|working student|werkstudent)$/i;
        for (const tk of mts.slice(1)) {
            if (!tk||er(tk)||/applicants?/i.test(tk)||/easy apply/i.test(tk)) continue;
            for (const s of tk.split(/[·|,]/).map(x=>nt(x)).filter(Boolean)) if(tp.test(s)) pt(s);
        }
        if (ml) for (const tk of ml.split(/[·|]/).map(x=>nt(x)).filter(Boolean)) {
            if (!tk||er(tk)||/people clicked|applicants?/i.test(tk)) continue;
            if(tp.test(tk)) pt(tk);
        }
        const dd = [];
        for (const i of tc) { const k=i.toLowerCase(); if(!st2.has(k)){st2.add(k);dd.push(i);} }
        const wk = document.createTreeWalker(card,NodeFilter.SHOW_TEXT);
        const tp2 = []; let nd;
        while((nd=wk.nextNode())){const t=(nd.nodeValue||'').trim();if(t)tp2.push(t);}
        const te = card.querySelector('time');
        const ds = er(tp2.join(' ')) || (te?te.getAttribute('datetime')||'':'');
        results.push({ title, company:company||'Unknown', location:lc||lr, jobType:dd.join(', '),
            platform:'linkedin', url:'https://www.linkedin.com/jobs/view/'+jobId+'/', postedDate:ds });
    });
    return results;
})()
"""


async def scrape_linkedin(page: Page, keywords: str, location: str, max_jobs: int, progress_cb=None) -> List[Dict]:
    params = urlencode({"keywords": keywords, "location": location, "f_TPR": "r604800", "sortBy": "DD", "start": "0"})
    url = f"https://www.linkedin.com/jobs/search/?{params}"
    log.info(f"Navigating → {url}")
    await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
    await asyncio.sleep(2)

    if any(x in page.url for x in ["/login", "/authwall", "/checkpoint", "/challenge"]):
        raise RuntimeError("LinkedIn redirected to login. Restart the agent and log in again.")

    for i in range(15):
        state = await page.evaluate(_STATE_JS)
        log.info(f"Poll {i+1}: cards={state['count']}")
        if state["count"] > 0:
            break
        await asyncio.sleep(1.5)

    state = await page.evaluate(_STATE_JS)
    if state["count"] == 0:
        raise RuntimeError("No jobs loaded. Session may be expired — restart the agent to log in again.")

    if progress_cb:
        await progress_cb(25)

    collected: Dict[str, Dict] = {}

    def merge(jobs):
        for j in jobs:
            u = j["url"]
            if u not in collected or (not collected[u].get("postedDate") and j.get("postedDate")):
                collected[u] = j

    merge(await page.evaluate(_EXTRACT_JS))
    log.info(f"Initial: {len(collected)} jobs")

    stuck, prev_count, no_scroll = 0, state["count"], 0
    for rnd in range(50):
        if len(collected) >= max_jobs:
            break
        scrolled = await page.evaluate(_SCROLL_JS)
        if not scrolled:
            no_scroll += 1
            if no_scroll >= 10:
                break
            await asyncio.sleep(1.0)
            continue
        no_scroll = 0
        await asyncio.sleep(0.9)
        state = await page.evaluate(_STATE_JS)
        before = len(collected)
        merge(await page.evaluate(_EXTRACT_JS))
        log.info(f"Round {rnd+1}: cards={state['count']} atBottom={state['atBottom']} +{len(collected)-before} total={len(collected)}")
        if progress_cb:
            await progress_cb(min(90, 25 + int(len(collected) / max(max_jobs, 1) * 65)))
        if state["count"] > prev_count:
            stuck = 0
        else:
            stuck += 1
        if rnd >= 8 and state["atBottom"] and stuck >= 2:
            break
        if state["count"] >= 120 or stuck >= 6:
            break
        prev_count = state["count"]

    merge(await page.evaluate(_EXTRACT_JS))
    result = list(collected.values())[:max_jobs]
    log.info(f"Total: {len(result)} jobs")

    for j in result:
        j["id"] = str(uuid.uuid4())
        j["postedDate"] = parse_linkedin_date(j.get("postedDate", ""))
    return result


# ── Agent ─────────────────────────────────────────────────────────────────────

class LinkedInAgent:
    def __init__(self, backend_url: str):
        self.backend_url = backend_url.rstrip("/")
        self.ws_url = self.backend_url.replace("https://", "wss://").replace("http://", "ws://") + "/ws/linkedin-agent"
        self.context: Optional[BrowserContext] = None
        self.has_session = False
        self.running = True

    async def _open_context(self, playwright, headless: bool):
        return await playwright.chromium.launch_persistent_context(
            str(CHROME_PROFILE),
            headless=headless,
            args=["--no-sandbox", "--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"],
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )

    async def _check_logged_in(self) -> bool:
        page = await self.context.new_page()
        try:
            await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=20_000)
            return "feed" in page.url and "login" not in page.url and "authwall" not in page.url
        except Exception:
            return False
        finally:
            await page.close()

    async def _run_setup(self):
        print("\n=== LinkedIn Login Setup ===")
        print("A browser window will open. Please log in to LinkedIn.")
        print("After you see your LinkedIn feed, press Enter here.\n")
        page = await self.context.new_page()
        await page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: input("Press Enter after you have logged in...\n"))
        try:
            await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=15_000)
            if "feed" in page.url:
                print("\n✅  Login successful! Profile saved.")
            else:
                print("\n⚠️  Could not verify, but profile is saved. Try running the agent now.")
        except Exception as e:
            print(f"\n⚠️  Navigation check failed ({e}), but profile is saved.")
        finally:
            await page.close()

    async def _handle_scrape(self, ws, request_id: str, params: dict):
        page = await self.context.new_page()
        try:
            async def progress(pct: int):
                try:
                    await ws.send(json.dumps({"type": "scrape_progress", "requestId": request_id, "progress": pct}))
                except Exception:
                    pass

            await progress(10)
            jobs = await scrape_linkedin(page, params.get("keywords", ""), params.get("location", ""), int(params.get("maxJobs", MAX_JOBS)), progress)
            await progress(100)
            await ws.send(json.dumps({"type": "scrape_result", "requestId": request_id, "jobs": jobs, "count": len(jobs)}))
            log.info(f"Scrape complete — {len(jobs)} jobs sent")
        except Exception as e:
            log.error(f"Scrape error: {e}")
            try:
                await ws.send(json.dumps({"type": "scrape_error", "requestId": request_id, "error": str(e)}))
            except Exception:
                pass
        finally:
            await page.close()

    async def _ws_loop(self):
        log.info(f"Connecting to {self.ws_url}")
        async with websockets.connect(self.ws_url, ping_interval=None, close_timeout=10, open_timeout=15) as ws:
            log.info("✅  Connected to backend")
            await ws.send(json.dumps({"type": "hello", "hasSession": self.has_session, "version": VERSION}))

            async def heartbeat():
                while self.running:
                    await asyncio.sleep(HEARTBEAT_INTERVAL)
                    try:
                        await ws.send(json.dumps({"type": "pong", "ts": int(datetime.utcnow().timestamp() * 1000)}))
                    except Exception:
                        break

            hb = asyncio.create_task(heartbeat())
            try:
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    t = msg.get("type")
                    if t == "ping":
                        await ws.send(json.dumps({"type": "pong", "ts": msg.get("ts", 0)}))
                    elif t == "scrape_start":
                        asyncio.create_task(self._handle_scrape(ws, msg.get("requestId", ""), msg.get("params", {})))
                    elif t == "check_session":
                        ok = await self._check_logged_in()
                        self.has_session = ok
                        await ws.send(json.dumps({"type": "session_status", "hasSession": ok}))
            finally:
                hb.cancel()

    async def run(self):
        PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        async with async_playwright() as p:
            browser = await self._open_context(p, headless=True)
            self.context = browser

            log.info("Checking LinkedIn session...")
            if not await self._check_logged_in():
                print("\n⚠️  No active LinkedIn session found.")
                await browser.close()

                browser = await self._open_context(p, headless=False)
                self.context = browser
                await self._run_setup()
                if not await self._check_logged_in():
                    print("\n❌  Login was not completed. Please run again and finish the LinkedIn login.")
                    await browser.close()
                    sys.exit(1)

                await browser.close()
                browser = await self._open_context(p, headless=True)
                self.context = browser
                if not await self._check_logged_in():
                    print("\n❌  Session could not be reloaded after login. Please run again.")
                    await browser.close()
                    sys.exit(1)

            self.has_session = True
            log.info("✅  Session active. Connecting to backend...")

            while self.running:
                try:
                    await self._ws_loop()
                except (websockets.exceptions.ConnectionClosed, websockets.exceptions.InvalidURI, OSError) as e:
                    log.warning(f"Connection lost ({e}). Reconnecting in {RECONNECT_DELAY}s...")
                    await asyncio.sleep(RECONNECT_DELAY)
                except Exception as e:
                    log.error(f"Unexpected error: {e}. Reconnecting in {RECONNECT_DELAY}s...")
                    await asyncio.sleep(RECONNECT_DELAY)

            await browser.close()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="JobHawk LinkedIn Agent")
    parser.add_argument("--backend", help="Override backend URL")
    args = parser.parse_args()

    backend_url = args.backend or os.environ.get("JOBRADAR_BACKEND_URL") or DEFAULT_BACKEND_URL

    if not backend_url or backend_url == "BACKEND_URL_PLACEHOLDER":
        print("Backend URL is not set.")
        print("Download this script from your app's Settings page (it bakes in the URL),")
        print("or set the JOBRADAR_BACKEND_URL environment variable.")
        sys.exit(1)

    agent = LinkedInAgent(backend_url)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def handle_exit(sig, frame):
        agent.running = False
        loop.call_soon_threadsafe(loop.stop)
        print("\nStopping...")

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    try:
        loop.run_until_complete(agent.run())
    except (RuntimeError, KeyboardInterrupt):
        pass


if __name__ == "__main__":
    main()
