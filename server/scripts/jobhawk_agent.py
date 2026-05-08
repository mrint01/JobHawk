#!/usr/bin/env python3
"""
JobHawk Agent  —  LinkedIn + Indeed

Connects to the JobHawk backend via two WebSocket channels and handles
scrape requests for both platforms simultaneously.

  LinkedIn: requires login (persistent Chromium profile)
  Indeed:   public listings only — no login needed (persistent WebKit/Safari profile)
            Stops immediately if "Zusätzliche Verifizierung erforderlich" captcha is detected.

Run:
    python3 jobhawk_agent.py

Dependencies:
    pip install playwright websockets playwright-stealth
    playwright install chromium webkit

Optional anti-bot extension for LinkedIn (Chromium-only):
    git clone https://github.com/obra/superpowers.git ~/.jobradar_agent/superpowers_ext
"""

import sys

# ── Dependency check ───────────────────────────────────────────────────────────
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

# Optional stealth layer
try:
    from playwright_stealth import stealth_async as _stealth_async
    _stealth_available = True
except ImportError:
    _stealth_available = False

# ── Imports ────────────────────────────────────────────────────────────────────
import asyncio
import json
import os
import re
import uuid
import signal
import logging
import argparse
import random
import shutil
import subprocess
from urllib.request import urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from playwright.async_api import BrowserContext, Page

# ── Config ─────────────────────────────────────────────────────────────────────
VERSION = "2.0.0"

PROFILE_DIR           = Path.home() / ".jobradar_agent"
LINKEDIN_PROFILE      = PROFILE_DIR / "chrome_profile_linkedin"
INDEED_PROFILE        = PROFILE_DIR / "webkit_profile_indeed"
SUPERPOWERS_EXT       = PROFILE_DIR / "superpowers_ext"
INDEED_CHROME_PROFILE    = Path.home() / ".config" / "jobhawk-chrome"
INDEED_FF_PROFILE        = PROFILE_DIR / "firefox_profile_indeed"
INDEED_WEBKIT_PROFILE    = PROFILE_DIR / "webkit_profile_indeed"
INDEED_CHROMIUM_PROFILE  = PROFILE_DIR / "chromium_profile_indeed"

# Baked in at download time; override via env var or --backend flag.
DEFAULT_BACKEND_URL = "https://jobhawk-server-production.up.railway.app"
# DEFAULT_BACKEND_URL = "http://localhost:3001"
# DEFAULT_SERVER_BACKEND_URL = "https://jobhawk-server-production.up.railway.app"
# Set to False to see the browser window (useful for debugging captchas).
LINKEDIN_HEADLESS = True
INDEED_HEADLESS   = True
HEARTBEAT_INTERVAL       = 25
RECONNECT_DELAY          = 5
MAX_RECONNECT_DELAY      = 60
OPEN_TIMEOUT_SECONDS     = 45
WAKE_TIMEOUT_SECONDS     = 12
WS_PING_INTERVAL_SECONDS = 20
WS_PING_TIMEOUT_SECONDS  = 20
MAX_JOBS                 = 100

INDEED_BASE = "https://de.indeed.com"
CONTRACT_TOKENS_DE = [
    "Vollzeit", "Teilzeit", "Praktikum", "Werkstudent", "Trainee",
    "Aushilfe", "Minijob", "Befristet", "Unbefristet", "Festanstellung",
    "Feste Anstellung", "Freiberuflich", "Remote", "Hybrid", "Homeoffice",
    "Home Office", "Hybrides Arbeiten",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("jobhawk-agent")


# ── Chrome auto-launch (for Indeed CDP mode) ──────────────────────────────────

def _find_chrome_binary() -> Optional[str]:
    for name in ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium", "chrome"]:
        path = shutil.which(name)
        if path:
            return path
    return None


async def _chrome_cdp_ready(port: int) -> bool:
    """Return True if Chrome is already listening on the CDP port."""
    try:
        await asyncio.to_thread(
            lambda: urlopen(f"http://localhost:{port}/json/version", timeout=2).read(256)
        )
        return True
    except Exception:
        return False


async def _ensure_chrome_running(port: int) -> bool:
    """Start Chrome for Indeed if it's not already up. Returns True when ready."""
    if await _chrome_cdp_ready(port):
        log.info(f"[indeed] Chrome already running on port {port}")
        return True

    chrome = _find_chrome_binary()
    if not chrome:
        print("\n❌  Could not find Chrome. Install google-chrome or chromium.")
        return False

    INDEED_CHROME_PROFILE.mkdir(parents=True, exist_ok=True)
    cmd = [
        chrome,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={INDEED_CHROME_PROFILE}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
    ]
    log.info(f"[indeed] launching Chrome: {' '.join(cmd)}")
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Poll until CDP is up (up to 15 s)
    for _ in range(30):
        await asyncio.sleep(0.5)
        if await _chrome_cdp_ready(port):
            log.info(f"[indeed] ✅ Chrome ready on port {port}")
            return True

    print(f"\n❌  Chrome launched but did not respond on port {port} within 15 s.")
    return False


# ── Superpowers extension ──────────────────────────────────────────────────────

def _superpowers_path() -> Optional[str]:
    """Return path to the superpowers Chrome extension if available."""
    p = SUPERPOWERS_EXT
    if p.exists() and (p / "manifest.json").exists():
        return str(p)
    return None


def _build_stealth_args(ext_path: Optional[str] = None) -> List[str]:
    args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--window-size=1366,768",
    ]
    if ext_path:
        args += [
            f"--load-extension={ext_path}",
            f"--disable-extensions-except={ext_path}",
        ]
    return args


async def _apply_stealth(page: Page, chromium: bool = False) -> None:
    if _stealth_available:
        await _stealth_async(page)
    else:
        # window.chrome only exists in Chromium — injecting it in WebKit/Firefox looks fake
        chrome_patch = "window.chrome = { runtime: {} };" if chromium else ""
        await page.add_init_script(f"""
            Object.defineProperty(navigator, 'webdriver', {{ get: () => undefined }});
            Object.defineProperty(navigator, 'plugins', {{ get: () => [1,2,3,4,5] }});
            Object.defineProperty(navigator, 'languages', {{ get: () => ['de-DE','de','en-US','en'] }});
            {chrome_patch}
        """)


# ── LinkedIn date parsing ──────────────────────────────────────────────────────

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


# ── Indeed captcha detection ───────────────────────────────────────────────────

class IndeedCaptchaError(Exception):
    """Raised when Indeed serves a verification/captcha wall."""


# German and English patterns Indeed shows when it blocks automation
_CAPTCHA_PATTERNS = [
    "zusätzliche verifizierung erforderlich",
    "additional verification required",
    "verify you are human",
    "are you a robot",
    "bitte bestätigen sie, dass sie kein roboter",
    "please verify you are a human",
    "access to this page has been denied",
    "just a moment",           # Cloudflare interstitial
    "checking your browser",   # Cloudflare
    "enable javascript and cookies to continue",
    "cf-browser-verification",
    "cf_chl_prog",             # Cloudflare challenge
    "security check",
    "automated access",
]


async def _check_indeed_captcha(page: Page) -> bool:
    """Return True if the current page is a bot-detection / captcha wall."""
    try:
        title = (await page.title()).lower()
        # Fast path: title often gives it away
        for p in _CAPTCHA_PATTERNS:
            if p in title:
                return True
        # Slower path: scan visible text (avoids loading full HTML)
        body_text = await page.evaluate("document.body ? document.body.innerText.toLowerCase() : ''")
        for p in _CAPTCHA_PATTERNS:
            if p in body_text:
                return True
    except Exception:
        pass
    return False


# ── Indeed date parsing ────────────────────────────────────────────────────────

def parse_indeed_date(raw: str) -> str:
    t = (raw or "").replace("\n", " ").strip().lower()
    if not t:
        return ""
    now = datetime.utcnow()
    fmt = "%Y-%m-%dT%H:%M:%SZ"

    iso = re.search(r"(\d{4}-\d{2}-\d{2})", raw)
    if iso:
        try:
            return datetime.strptime(iso.group(1), "%Y-%m-%d").strftime(fmt)
        except ValueError:
            pass

    if re.search(r"heute|today|just posted|gerade|vor wenigen", t):
        return now.strftime(fmt)

    m = re.search(r"vor\s+(\d+)\s*(minute|minuten|min)\b", t)
    if m: return (now - timedelta(minutes=int(m.group(1)))).strftime(fmt)

    m = re.search(r"vor\s+(\d+)\s*(stunde|stunden)\b", t)
    if m: return (now - timedelta(hours=int(m.group(1)))).strftime(fmt)

    m = re.search(r"vor\s+(\d+)\s*(tag|tagen|tage)\b", t)
    if m: return (now - timedelta(days=int(m.group(1)))).strftime(fmt)

    m = re.search(r"vor\s+(\d+)\s*(woche|wochen)\b", t)
    if m: return (now - timedelta(weeks=int(m.group(1)))).strftime(fmt)

    m = re.search(r"(\d+)\s*(hour|hours)\s+ago", t)
    if m: return (now - timedelta(hours=int(m.group(1)))).strftime(fmt)

    m = re.search(r"(\d+)\s*(day|days)\s+ago", t)
    if m: return (now - timedelta(days=int(m.group(1)))).strftime(fmt)

    return ""


# ── WebKit (Indeed) init script — injected before any page JS runs ────────────

_WEBKIT_INIT_SCRIPT = """
(function () {
    // Safari/Mac fingerprint patches
    function def(obj, prop, val) {
        try { Object.defineProperty(obj, prop, { get: function(){ return val; }, configurable: true }); } catch(e) {}
    }
    def(navigator, 'webdriver',          undefined);
    def(navigator, 'platform',           'MacIntel');
    def(navigator, 'vendor',             'Apple Computer, Inc.');
    def(navigator, 'hardwareConcurrency', 8);
    def(navigator, 'maxTouchPoints',      0);
    def(navigator, 'deviceMemory',        8);
    def(navigator, 'languages',          ['de-DE', 'de', 'en']);
    def(navigator, 'plugins',            []);

    // Screen: MacBook 1440×900, Retina colour depth
    def(screen, 'width',       1440);
    def(screen, 'height',       900);
    def(screen, 'availWidth',  1440);
    def(screen, 'availHeight',  877);
    def(screen, 'colorDepth',    30);
    def(screen, 'pixelDepth',    30);

    // Canvas fingerprint noise — imperceptible offset so every session differs
    try {
        var origGC = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type) {
            var ctx = origGC.apply(this, arguments);
            if (ctx && type === '2d') {
                var origFT = ctx.fillText.bind(ctx);
                ctx.fillText = function(text, x, y) {
                    var extra = arguments.length > 3 ? [arguments[3]] : [];
                    return origFT.apply(ctx, [text, x + (Math.random() * 0.4 - 0.2), y].concat(extra));
                };
            }
            return ctx;
        };
    } catch(e) {}

    // Permissions API — degrade gracefully instead of throwing
    if (navigator.permissions && navigator.permissions.query) {
        var origQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = function(desc) {
            return origQuery(desc).catch(function() {
                return Promise.resolve({ state: 'denied', onchange: null });
            });
        };
    }
})();
"""


async def _random_mouse_wander(page: Page, steps: int = 3) -> None:
    """Move mouse to a few random viewport positions to mimic natural reading."""
    for _ in range(steps):
        x = random.randint(180, 1180)
        y = random.randint(80, 640)
        try:
            await page.mouse.move(x, y)
        except Exception:
            break
        await asyncio.sleep(random.uniform(0.07, 0.20))


# ── LinkedIn JS snippets ───────────────────────────────────────────────────────

_LI_SCROLL_JS = """
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

_LI_STATE_JS = """
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

_LI_EXTRACT_JS = """
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


# ── LinkedIn scraper ───────────────────────────────────────────────────────────

async def scrape_linkedin(page: Page, keywords: str, location: str, max_jobs: int, progress_cb=None) -> List[Dict]:
    params = urlencode({"keywords": keywords, "location": location, "f_TPR": "r604800", "sortBy": "DD", "start": "0"})
    url = f"https://www.linkedin.com/jobs/search/?{params}"
    log.info(f"[linkedin] → {url}")
    await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
    await asyncio.sleep(2)

    if any(x in page.url for x in ["/login", "/authwall", "/checkpoint", "/challenge"]):
        raise RuntimeError("LinkedIn redirected to login. Restart the agent and log in again.")

    for i in range(15):
        state = await page.evaluate(_LI_STATE_JS)
        if state["count"] > 0:
            break
        await asyncio.sleep(1.5)

    state = await page.evaluate(_LI_STATE_JS)
    if state["count"] == 0:
        raise RuntimeError("No jobs loaded. Session may be expired — restart the agent.")

    if progress_cb:
        await progress_cb(25)

    collected: Dict[str, Dict] = {}

    def merge(jobs):
        for j in jobs:
            u = j["url"]
            if u not in collected or (not collected[u].get("postedDate") and j.get("postedDate")):
                collected[u] = j

    merge(await page.evaluate(_LI_EXTRACT_JS))
    log.info(f"[linkedin] initial: {len(collected)} jobs")

    stuck, prev_count, no_scroll = 0, state["count"], 0
    for rnd in range(50):
        if len(collected) >= max_jobs:
            break
        scrolled = await page.evaluate(_LI_SCROLL_JS)
        if not scrolled:
            no_scroll += 1
            if no_scroll >= 10:
                break
            await asyncio.sleep(1.0)
            continue
        no_scroll = 0
        await asyncio.sleep(0.9)
        state = await page.evaluate(_LI_STATE_JS)
        before = len(collected)
        merge(await page.evaluate(_LI_EXTRACT_JS))
        log.info(f"[linkedin] round {rnd+1}: cards={state['count']} atBottom={state['atBottom']} +{len(collected)-before} total={len(collected)}")
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

    merge(await page.evaluate(_LI_EXTRACT_JS))
    result = list(collected.values())[:max_jobs]
    log.info(f"[linkedin] total: {len(result)} jobs")

    for j in result:
        j["id"] = str(uuid.uuid4())
        j["postedDate"] = parse_linkedin_date(j.get("postedDate", ""))
    return result


# ── Indeed JS snippets ─────────────────────────────────────────────────────────

_INDEED_SCROLL_JS = """(function () {
    function findSc(start) {
        var node = start;
        while (node && node !== document.body) {
            var s = window.getComputedStyle(node), oy = s.overflowY;
            if ((oy==='auto'||oy==='scroll'||oy==='overlay') && node.scrollHeight > node.clientHeight + 12) return node;
            node = node.parentElement;
        }
        return null;
    }
    var roots = [
        document.querySelector('#jobsearch-MainContainer'),
        document.querySelector('[data-testid="jobs-scroll-area"]'),
        document.querySelector('#mosaic-provider-jobcards'),
        document.querySelector('.jobsearch-LeftPane'),
        document.querySelector('[class*="jobsearch-LeftPane"]'),
    ].filter(Boolean);
    var cands = roots.slice();
    var firstJk = document.querySelector('[data-jk]');
    var fc = findSc(firstJk); if (fc) cands.push(fc);
    var mosaic = document.querySelector('#mosaic-provider-jobcards');
    var fm = mosaic ? findSc(mosaic) : null; if (fm) cands.push(fm);
    var usable = cands.filter(function(e){ return e.scrollHeight > e.clientHeight + 12; });
    usable.sort(function(a,b){ return b.clientHeight - a.clientHeight; });
    var c = usable.length ? usable[0] : null;
    if (c) { c.scrollTop += Math.floor(c.clientHeight * 0.92); }
    else { window.scrollBy(0, Math.floor(window.innerHeight * 0.85)); }
})()"""

_INDEED_STATE_JS = """(function () {
    function findSc(start) {
        var node = start;
        while (node && node !== document.body) {
            var s = window.getComputedStyle(node), oy = s.overflowY;
            if ((oy==='auto'||oy==='scroll'||oy==='overlay') && node.scrollHeight > node.clientHeight + 12) return node;
            node = node.parentElement;
        }
        return null;
    }
    var jkNodes = Array.prototype.slice.call(document.querySelectorAll('[data-jk]')).filter(function(el){
        var jk = el.getAttribute('data-jk'); return !!(jk && jk.length > 3 && jk !== 'false');
    });
    var seen = {}, uniqueCount = 0;
    for (var i=0; i<jkNodes.length; i++) {
        var jk = jkNodes[i].getAttribute('data-jk');
        if (jk && !seen[jk]) { seen[jk]=true; uniqueCount++; }
    }
    var roots = [
        document.querySelector('#jobsearch-MainContainer'),
        document.querySelector('[data-testid="jobs-scroll-area"]'),
        document.querySelector('#mosaic-provider-jobcards'),
        document.querySelector('.jobsearch-LeftPane'),
    ].filter(Boolean);
    var cands = roots.slice();
    var firstJk = document.querySelector('[data-jk]');
    var fc = findSc(firstJk); if (fc) cands.push(fc);
    var usable = cands.filter(function(e){ return e.scrollHeight > e.clientHeight + 12; });
    usable.sort(function(a,b){ return b.clientHeight - a.clientHeight; });
    var listC = usable.length ? usable[0] : null;
    var remaining = listC ? listC.scrollHeight - listC.clientHeight - listC.scrollTop : 0;
    return { cardCount: jkNodes.length, uniqueJk: uniqueCount, hasContainer: !!listC, atBottom: remaining <= 12 };
})()"""


def _build_indeed_extract_js(tokens: List[str]) -> str:
    tokens_json = json.dumps(tokens)
    return f"""(function (tokens) {{
    var out = [], seen = {{}};
    var roots = Array.prototype.slice.call(document.querySelectorAll('[data-jk]')).filter(function(el){{
        var jk = el.getAttribute('data-jk'); return !!(jk && jk.length > 3 && jk !== 'false');
    }});
    function cardFor(el) {{
        var c = el.closest('.slider_item,.job_seen_beacon,.tapItem,li,article,[class*="cardOutline"],[class*="jobCard"]');
        return c || el;
    }}
    function uniqJoin(arr) {{
        var u={{}}, r=[];
        for(var i=0;i<arr.length;i++){{ if(!u[arr[i]]){{u[arr[i]]=true;r.push(arr[i]);}} }}
        return r.join(', ');
    }}
    for (var i=0; i<roots.length; i++) {{
        var node=roots[i], jk=node.getAttribute('data-jk');
        if (!jk || seen[jk]) continue;
        var card = cardFor(node);
        var link = card.querySelector('h2.jobTitle a,h2 a[data-jk],a.jcs-JobTitle') ||
                   card.querySelector('a[href*="viewjob"],a[href*="/rc/clk"]');
        var titleEl = card.querySelector('h2.jobTitle span');
        var title = (titleEl && titleEl.textContent ? titleEl.textContent.trim() : '') ||
            (function(){{ var t=card.querySelector('.jcs-JobTitle,[data-testid="jobTitle"]');
              return t&&t.textContent?t.textContent.trim():''; }})() ||
            (link && link.textContent ? link.textContent.trim() : '') || '';
        if (!title || title.length < 2) continue;
        var cn = card.querySelector('[data-testid="company-name"],.companyName,span[data-testid="companyName"]');
        var company = (cn && cn.textContent ? cn.textContent.trim() : '') ||
            (function(){{ var t=card.querySelector('span[class*="company"]');
              return t&&t.textContent?t.textContent.trim():''; }})() || '';
        var locEl = card.querySelector('[data-testid="text-location"],.companyLocation');
        var location = locEl && locEl.textContent ? locEl.textContent.trim() : '';
        var blob = (card.innerText || card.textContent || '').toLowerCase();
        var matchedTypes = [];
        for (var t=0; t<tokens.length; t++) {{
            if (blob.indexOf(tokens[t].toLowerCase()) !== -1) matchedTypes.push(tokens[t]);
        }}
        var jobType = uniqJoin(matchedTypes);
        var dsEl = card.querySelector('[data-testid="myJobsStateDate"],.date,span[class*="date"]');
        var dateSnippet = dsEl && dsEl.textContent ? dsEl.textContent.trim() : '';
        seen[jk] = true;
        out.push({{ jk:jk, title:title, company:company||'Unknown',
                    location:location||'', jobType:jobType, dateSnippet:dateSnippet }});
    }}
    return out;
}})({tokens_json})"""


# ── Indeed scraper ─────────────────────────────────────────────────────────────

async def _dismiss_indeed_consent(page: Page) -> None:
    selectors = [
        '#onetrust-accept-btn-handler',
        'button[data-testid="privacy-banner-accept"]',
        'button[id*="accept"][class*="privacy"]',
        'button[aria-label*="Akzeptieren"]',
        'button[aria-label*="Accept"]',
    ]
    for sel in selectors:
        try:
            handle = await page.query_selector(sel)
            if handle:
                await handle.click()
                await asyncio.sleep(0.4)
                break
        except Exception:
            pass


async def _navigate_indeed(page: Page, search_url: str) -> int:
    base = INDEED_BASE + "/"
    try:
        await page.goto(base, wait_until="domcontentloaded", timeout=60_000)
    except Exception:
        pass
    # Dwell on homepage like a real user, move mouse around a bit
    await asyncio.sleep(random.uniform(0.8, 1.8))
    await _random_mouse_wander(page, steps=random.randint(2, 4))
    await asyncio.sleep(random.uniform(0.3, 0.8))

    try:
        resp = await page.goto(search_url, wait_until="domcontentloaded", timeout=90_000,
                               referer=base)
        status = resp.status if resp else 0
    except Exception as e:
        log.warning(f"[indeed] domcontentloaded failed ({e!s:.120}) — retrying with commit")
        try:
            resp = await page.goto(search_url, wait_until="commit", timeout=60_000, referer=base)
            status = resp.status if resp else 0
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=75_000)
            except Exception:
                pass
        except Exception as e2:
            raise RuntimeError(f"Indeed navigation failed: {e2}") from e2

    if status in (401, 403):
        await asyncio.sleep(1.4 + random.uniform(0, 1.4))
        try:
            await page.goto(base, wait_until="domcontentloaded", timeout=60_000)
        except Exception:
            pass
        await asyncio.sleep(random.uniform(0.45, 1.2))
        try:
            resp = await page.goto(search_url, wait_until="domcontentloaded", timeout=90_000, referer=base)
            status = resp.status if resp else status
        except Exception:
            pass

    return status


async def scrape_indeed(page: Page, keywords: str, location: str, max_jobs: int, progress_cb=None) -> List[Dict]:
    from urllib.parse import urlencode as _ue
    params: Dict[str, str] = {"q": keywords.strip(), "sort": "date", "fromage": "last"}
    if location.strip():
        params["l"] = location.strip()
    search_url = f"{INDEED_BASE}/jobs?{_ue(params)}"
    log.info(f"[indeed] → {search_url}")

    await _apply_stealth(page, chromium=False)
    http_status = await _navigate_indeed(page, search_url)
    await asyncio.sleep(1.6)

    # ── Captcha / bot-wall check ───────────────────────────────────────────────
    if await _check_indeed_captcha(page):
        raise IndeedCaptchaError(
            "Zusätzliche Verifizierung erforderlich — Indeed requires human verification. "
            "Scraping stopped. Try again later or from a different network."
        )

    await _dismiss_indeed_consent(page)
    await asyncio.sleep(0.5)

    if progress_cb:
        await progress_cb(22)

    extract_js = _build_indeed_extract_js(CONTRACT_TOKENS_DE)
    merged: Dict[str, Dict] = {}

    def merge_batch(rows):
        for r in rows:
            url = f"https://{INDEED_BASE.split('://')[1]}/viewjob?jk={r['jk']}"
            if url not in merged:
                merged[url] = {
                    "title": r["title"],
                    "company": r["company"],
                    "location": r["location"],
                    "jobType": r.get("jobType") or "",
                    "url": url,
                    "postedDate": parse_indeed_date(r.get("dateSnippet", "")),
                    "platform": "indeed",
                }

    first_batch = await page.evaluate(extract_js)
    if http_status >= 400 and len(first_batch) == 0:
        hint = " Try a different network or set INDEED_PROXY_SERVER." if http_status == 403 else ""
        raise RuntimeError(f"Indeed returned HTTP {http_status}.{hint}")

    merge_batch(first_batch)
    prev_unique = len(merged)
    stuck = 0

    for rnd in range(48):
        if len(merged) >= max_jobs:
            break

        state = await page.evaluate(_INDEED_STATE_JS)
        pct = min(95, 22 + round((rnd / 48) * 70))
        if progress_cb:
            await progress_cb(pct)

        if state["uniqueJk"] == prev_unique:
            stuck += 1
        else:
            stuck = 0
        prev_unique = state["uniqueJk"]

        if stuck >= 5 and rnd > 3:
            break
        if state["atBottom"] and stuck >= 2:
            break

        await page.evaluate(_INDEED_SCROLL_JS)

        # Human-like delay: base 0.5–1.8 s, occasional longer "reading pause"
        delay = random.uniform(0.5, 1.8)
        if rnd % 6 == 5:
            delay += random.uniform(1.8, 3.5)
        await asyncio.sleep(delay)

        # Occasionally scroll back up slightly (looks like re-reading a listing)
        if rnd > 0 and random.random() < 0.18:
            try:
                await page.mouse.wheel(0, -random.randint(80, 220))
            except Exception:
                pass
            await asyncio.sleep(random.uniform(0.25, 0.55))

        # Occasionally move the mouse while "reading"
        if rnd % 4 == 3:
            await _random_mouse_wander(page, steps=random.randint(1, 3))

        merge_batch(await page.evaluate(extract_js))
        log.info(f"[indeed] round {rnd+1}: uniqueJk={state['uniqueJk']} collected={len(merged)}")

    result = list(merged.values())[:max_jobs]
    log.info(f"[indeed] total: {len(result)} jobs")
    for j in result:
        j["id"] = str(uuid.uuid4())
    return result


# ── JobHawk Agent ──────────────────────────────────────────────────────────────

class JobHawkAgent:
    def __init__(self, backend_url: str, cdp_port: Optional[int] = None):
        self.backend_url = backend_url.rstrip("/")
        base_ws = self.backend_url.replace("https://", "wss://").replace("http://", "ws://")
        self.linkedin_ws_url = base_ws + "/ws/linkedin-agent"
        self.indeed_ws_url   = base_ws + "/ws/indeed-agent"

        self.playwright = None
        self.linkedin_ctx:         Optional[BrowserContext] = None
        self.indeed_firefox_ctx:   Optional[BrowserContext] = None  # lazy-init per browser
        self.indeed_webkit_ctx:    Optional[BrowserContext] = None
        self.indeed_chromium_ctx:  Optional[BrowserContext] = None
        self._indeed_lock = asyncio.Lock()
        self.cdp_port = cdp_port  # CDP port for Chrome; defaults to 9222 if not passed

        self.linkedin_has_session = False
        self.running = True
        self._li_reconnect   = RECONNECT_DELAY
        self._ind_reconnect  = RECONNECT_DELAY

    # ── Browser helpers ────────────────────────────────────────────────────────

    async def _open_ctx(self, profile_dir: Path, headless: bool, ext_path: Optional[str] = None) -> BrowserContext:
        """Chromium persistent context — used for LinkedIn."""
        args = _build_stealth_args(ext_path)
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        return await self.playwright.chromium.launch_persistent_context(
            str(profile_dir),
            headless=headless,
            args=args,
            user_agent=ua,
            viewport={"width": 1366, "height": 768},
            locale="de-DE",
            timezone_id="Europe/Berlin",
        )

    async def _open_webkit_ctx(self, profile_dir: Path, headless: bool = True) -> BrowserContext:
        """WebKit (Safari engine) persistent context — used for Indeed.
        Non-Chromium fingerprint avoids most Indeed bot-detection heuristics."""
        ua = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) "
            "Version/17.4.1 Safari/605.1.15"
        )
        ctx = await self.playwright.webkit.launch_persistent_context(
            str(profile_dir),
            headless=headless,
            user_agent=ua,
            viewport={"width": 1366, "height": 768},
            locale="de-DE",
            timezone_id="Europe/Berlin",
            extra_http_headers={
                "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Upgrade-Insecure-Requests": "1",
            },
        )
        await ctx.add_init_script(_WEBKIT_INIT_SCRIPT)
        return ctx

    async def _get_firefox_ctx(self) -> BrowserContext:
        """Lazy-init a persistent Firefox profile for Indeed. Created once, reused across scrapes."""
        if self.indeed_firefox_ctx is None:
            INDEED_FF_PROFILE.mkdir(parents=True, exist_ok=True)
            log.info("[indeed] launching Firefox (first use)…")
            ua = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
            self.indeed_firefox_ctx = await self.playwright.firefox.launch_persistent_context(
                str(INDEED_FF_PROFILE),
                headless=INDEED_HEADLESS,
                user_agent=ua,
                viewport={"width": 1366, "height": 768},
                locale="de-DE",
                timezone_id="Europe/Berlin",
                extra_http_headers={
                    "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                },
            )
            log.info("[indeed] ✅ Firefox ready")
        return self.indeed_firefox_ctx

    async def _get_webkit_ctx(self) -> BrowserContext:
        """Lazy-init WebKit (Safari engine) persistent profile for Indeed."""
        if self.indeed_webkit_ctx is None:
            INDEED_WEBKIT_PROFILE.mkdir(parents=True, exist_ok=True)
            log.info("[indeed] launching WebKit/Safari (first use)…")
            self.indeed_webkit_ctx = await self._open_webkit_ctx(INDEED_WEBKIT_PROFILE, headless=INDEED_HEADLESS)
            log.info("[indeed] ✅ WebKit ready")
        return self.indeed_webkit_ctx

    async def _get_chromium_ctx(self) -> BrowserContext:
        """Lazy-init Playwright Chromium persistent profile for Indeed (no real Chrome needed)."""
        if self.indeed_chromium_ctx is None:
            INDEED_CHROMIUM_PROFILE.mkdir(parents=True, exist_ok=True)
            log.info("[indeed] launching Chromium (first use)…")
            ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            self.indeed_chromium_ctx = await self.playwright.chromium.launch_persistent_context(
                str(INDEED_CHROMIUM_PROFILE),
                headless=INDEED_HEADLESS,
                args=_build_stealth_args(),
                user_agent=ua,
                viewport={"width": 1366, "height": 768},
                locale="de-DE",
                timezone_id="Europe/Berlin",
                extra_http_headers={
                    "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                },
            )
            log.info("[indeed] ✅ Chromium ready")
        return self.indeed_chromium_ctx

    # ── LinkedIn auth ──────────────────────────────────────────────────────────

    async def _linkedin_logged_in(self) -> bool:
        page = await self.linkedin_ctx.new_page()
        try:
            await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=20_000)
            return "feed" in page.url and "login" not in page.url and "authwall" not in page.url
        except Exception:
            return False
        finally:
            await page.close()

    async def _linkedin_setup(self):
        print("\n=== LinkedIn Login Setup ===")
        print("A browser window will open. Please log in to LinkedIn.")
        print("After you see your LinkedIn feed, press Enter here.\n")
        page = await self.linkedin_ctx.new_page()
        await page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: input("Press Enter after you have logged in...\n"))
        try:
            await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=15_000)
            if "feed" in page.url:
                print("\n✅  Login successful! Profile saved.")
            else:
                print("\n⚠️  Could not verify, but profile is saved. Try running again.")
        except Exception as e:
            print(f"\n⚠️  Navigation check failed ({e}), but profile is saved.")
        finally:
            await page.close()

    # ── LinkedIn WS ────────────────────────────────────────────────────────────

    async def _handle_linkedin_scrape(self, ws, request_id: str, params: dict):
        page = await self.linkedin_ctx.new_page()
        try:
            async def progress(pct: int):
                try:
                    await ws.send(json.dumps({"type": "scrape_progress", "requestId": request_id, "progress": pct}))
                except Exception:
                    pass

            await progress(10)
            jobs = await scrape_linkedin(
                page,
                params.get("keywords", ""),
                params.get("location", ""),
                int(params.get("maxJobs", MAX_JOBS)),
                progress,
            )
            await progress(100)
            await ws.send(json.dumps({"type": "scrape_result", "requestId": request_id, "jobs": jobs, "count": len(jobs)}))
            log.info(f"[linkedin] scrape done — {len(jobs)} jobs")
        except Exception as e:
            log.error(f"[linkedin] scrape error: {e}")
            try:
                await ws.send(json.dumps({"type": "scrape_error", "requestId": request_id, "error": str(e)}))
            except Exception:
                pass
        finally:
            await page.close()

    async def _linkedin_ws_loop(self):
        log.info(f"[linkedin] connecting → {self.linkedin_ws_url}")
        async with websockets.connect(
            self.linkedin_ws_url,
            ping_interval=WS_PING_INTERVAL_SECONDS,
            ping_timeout=WS_PING_TIMEOUT_SECONDS,
            close_timeout=10,
            open_timeout=OPEN_TIMEOUT_SECONDS,
        ) as ws:
            log.info("[linkedin] ✅ connected")
            self._li_reconnect = RECONNECT_DELAY
            await ws.send(json.dumps({"type": "hello", "hasSession": self.linkedin_has_session, "version": VERSION}))

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
                        asyncio.create_task(self._handle_linkedin_scrape(ws, msg.get("requestId", ""), msg.get("params", {})))
                    elif t == "check_session":
                        ok = await self._linkedin_logged_in()
                        self.linkedin_has_session = ok
                        await ws.send(json.dumps({"type": "session_status", "hasSession": ok}))
            finally:
                hb.cancel()

    async def _run_linkedin(self):
        ext = _superpowers_path()
        # Superpowers extension requires a visible window (extensions don't work headless).
        headless = LINKEDIN_HEADLESS and (ext is None)

        # Initial LinkedIn setup: auth flow
        ctx = await self._open_ctx(LINKEDIN_PROFILE, headless=headless, ext_path=ext)
        self.linkedin_ctx = ctx

        log.info("[linkedin] checking session…")
        if not await self._linkedin_logged_in():
            print("\n⚠️  No active LinkedIn session.")
            await ctx.close()
            ctx = await self._open_ctx(LINKEDIN_PROFILE, headless=False, ext_path=ext)
            self.linkedin_ctx = ctx
            await self._linkedin_setup()
            if not await self._linkedin_logged_in():
                print("\n❌  Login incomplete. Re-run the script and log in.")
                await ctx.close()
                return
            await ctx.close()
            ctx = await self._open_ctx(LINKEDIN_PROFILE, headless=headless, ext_path=ext)
            self.linkedin_ctx = ctx
            if not await self._linkedin_logged_in():
                print("\n❌  Session could not reload after login. Re-run the script.")
                await ctx.close()
                return

        self.linkedin_has_session = True
        log.info("[linkedin] ✅ session active — entering WS loop")

        while self.running:
            try:
                await self._linkedin_ws_loop()
            except Exception as e:
                log.warning(f"[linkedin] WS error: {e}. Reconnecting in {self._li_reconnect}s…")
                await asyncio.sleep(self._li_reconnect + random.uniform(0, 1.5))
                self._li_reconnect = min(MAX_RECONNECT_DELAY, self._li_reconnect * 2)

        await ctx.close()

    # ── Indeed WS ─────────────────────────────────────────────────────────────

    async def _handle_indeed_scrape(self, ws, request_id: str, params: dict):
        async with self._indeed_lock:
            browser_choice = str(params.get("browser", "chrome")).lower()
            ctx = None
            persistent = False  # True = keep a blank keeper tab; False = close everything

            if browser_choice == "firefox":
                ctx = await self._get_firefox_ctx()
                persistent = True
            elif browser_choice == "webkit":
                ctx = await self._get_webkit_ctx()
                persistent = True
            elif browser_choice == "chromium":
                ctx = await self._get_chromium_ctx()
                persistent = True
            else:
                # Chrome via CDP — fresh connection per scrape, no stale context issues
                cdp_port = self.cdp_port or 9222
                if not await _ensure_chrome_running(cdp_port):
                    try:
                        await ws.send(json.dumps({"type": "scrape_error", "requestId": request_id,
                                                  "error": "Could not launch Chrome. Check that google-chrome is installed."}))
                    except Exception:
                        pass
                    return
                try:
                    browser = await self.playwright.chromium.connect_over_cdp(f"http://localhost:{cdp_port}")
                    ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
                except Exception as e:
                    try:
                        await ws.send(json.dumps({"type": "scrape_error", "requestId": request_id,
                                                  "error": f"Chrome CDP connect failed: {e}"}))
                    except Exception:
                        pass
                    return

            page = await ctx.new_page()
            try:
                async def progress(pct: int):
                    try:
                        await ws.send(json.dumps({"type": "scrape_progress", "requestId": request_id, "progress": pct}))
                    except Exception:
                        pass

                await progress(10)
                jobs = await scrape_indeed(
                    page,
                    params.get("keywords", ""),
                    params.get("location", ""),
                    int(params.get("maxJobs", MAX_JOBS)),
                    progress,
                )
                await progress(100)
                await ws.send(json.dumps({"type": "scrape_result", "requestId": request_id, "jobs": jobs, "count": len(jobs)}))
                log.info(f"[indeed] scrape done — {len(jobs)} jobs ({browser_choice})")
            except IndeedCaptchaError as e:
                log.warning(f"[indeed] captcha detected — stopping: {e}")
                try:
                    await ws.send(json.dumps({"type": "scrape_error", "requestId": request_id, "error": str(e)}))
                except Exception:
                    pass
            except Exception as e:
                log.error(f"[indeed] scrape error: {e}")
                try:
                    await ws.send(json.dumps({"type": "scrape_error", "requestId": request_id, "error": str(e)}))
                except Exception:
                    pass
            finally:
                if persistent:
                    # Firefox: keep one blank tab so the context stays alive for next scrape
                    try:
                        keeper = await ctx.new_page()
                    except Exception:
                        keeper = None
                    for p in list(ctx.pages):
                        if p is keeper:
                            continue
                        try:
                            await p.close()
                        except Exception:
                            pass
                else:
                    # Chrome CDP: close everything; next scrape reconnects fresh
                    for p in list(ctx.pages):
                        try:
                            await p.close()
                        except Exception:
                            pass

    async def _indeed_ws_loop(self):
        log.info(f"[indeed] connecting → {self.indeed_ws_url}")
        async with websockets.connect(
            self.indeed_ws_url,
            ping_interval=WS_PING_INTERVAL_SECONDS,
            ping_timeout=WS_PING_TIMEOUT_SECONDS,
            close_timeout=10,
            open_timeout=OPEN_TIMEOUT_SECONDS,
        ) as ws:
            log.info("[indeed] ✅ connected")
            self._ind_reconnect = RECONNECT_DELAY
            await ws.send(json.dumps({"type": "hello", "platform": "indeed", "version": VERSION}))

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
                        asyncio.create_task(self._handle_indeed_scrape(ws, msg.get("requestId", ""), msg.get("params", {})))
            finally:
                hb.cancel()

    async def _run_indeed(self):
        # No browser setup at startup — browser is launched on first scrape.
        # Chrome: per-scrape CDP connect (fresh context, no stale state).
        # Firefox: lazy-init persistent profile (created on first Firefox scrape).
        log.info("[indeed] ready — browser will launch on first scrape")

        while self.running:
            try:
                await self._indeed_ws_loop()
            except Exception as e:
                log.warning(f"[indeed] WS error: {e}. Reconnecting in {self._ind_reconnect}s…")
                await asyncio.sleep(self._ind_reconnect + random.uniform(0, 1.5))
                self._ind_reconnect = min(MAX_RECONNECT_DELAY, self._ind_reconnect * 2)

        for ctx in filter(None, [self.indeed_firefox_ctx, self.indeed_webkit_ctx, self.indeed_chromium_ctx]):
            try:
                await ctx.close()
            except Exception:
                pass

    # ── Wake backend ───────────────────────────────────────────────────────────

    async def _wake_backend(self):
        url = f"{self.backend_url}/api/ping"
        try:
            await asyncio.to_thread(lambda: urlopen(url, timeout=WAKE_TIMEOUT_SECONDS).read(64))
        except Exception:
            pass

    # ── Entry point ────────────────────────────────────────────────────────────

    async def run(self):
        for d in [PROFILE_DIR, LINKEDIN_PROFILE, INDEED_CHROME_PROFILE,
                  INDEED_FF_PROFILE, INDEED_WEBKIT_PROFILE, INDEED_CHROMIUM_PROFILE]:
            d.mkdir(parents=True, exist_ok=True)

        ext = _superpowers_path()
        if ext:
            log.info(f"✅  Superpowers extension loaded (LinkedIn/Chromium): {ext}")
        if not _stealth_available:
            print("\n💡  Tip: install playwright-stealth for better anti-bot protection:")
            print("       pip install playwright-stealth")
            print("   LinkedIn also supports the superpowers Chromium extension:")
            print("       git clone https://github.com/obra/superpowers.git ~/.jobradar_agent/superpowers_ext")
            print("   Indeed uses WebKit (Safari engine) — no extension needed.\n")

        await self._wake_backend()

        async with async_playwright() as p:
            self.playwright = p
            await asyncio.gather(
                self._run_linkedin(),
                self._run_indeed(),
            )


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="JobHawk Agent — LinkedIn + Indeed")
    parser.add_argument("--backend", help="Override backend URL")
    parser.add_argument(
        "--cdp-port", type=int, default=None, metavar="PORT",
        help="Connect Indeed scraping to your real running Chrome via CDP (e.g. 9222). "
             "Chrome must be launched with --remote-debugging-port=PORT.",
    )
    args = parser.parse_args()

    backend_url = args.backend or os.environ.get("JOBRADAR_BACKEND_URL") or DEFAULT_BACKEND_URL

    if not backend_url or backend_url == "BACKEND_URL_PLACEHOLDER":
        print("Backend URL is not set.")
        print("Download this script from your app's Settings page (it bakes in the URL),")
        print("or set JOBRADAR_BACKEND_URL env var.")
        sys.exit(1)

    if args.cdp_port:
        print(f"\n🔗  Indeed will use Chrome via CDP on port {args.cdp_port} (auto-launched if not running)")
        print(f"   Profile: {INDEED_CHROME_PROFILE}\n")

    agent = JobHawkAgent(backend_url, cdp_port=args.cdp_port)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def handle_exit(sig, frame):
        agent.running = False
        loop.call_soon_threadsafe(loop.stop)
        print("\nStopping…")

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    try:
        loop.run_until_complete(agent.run())
    except (RuntimeError, KeyboardInterrupt):
        pass


if __name__ == "__main__":
    main()
