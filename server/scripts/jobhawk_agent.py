#!/usr/bin/env python3
"""
JobHawk Agent  —  LinkedIn + Indeed

Connects to the JobHawk backend via two WebSocket channels and handles
scrape requests for both platforms simultaneously.

  LinkedIn: requires login (persistent Chromium profile)
  Indeed:   requires login (persistent browser profile — default Patchright/Chromium)
            Session is checked at agent startup; scraping uses the saved profile.
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

# Optional patchright — patched Playwright Chromium with all automation flags removed.
# Replaces standard Playwright for Indeed so the browser looks like real Chrome to websites.
# Install: pip install patchright && patchright install chromium
try:
    from patchright.async_api import async_playwright as _patchright_playwright
    _patchright_available = True
except ImportError:
    _patchright_available = False

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
from urllib.request import urlopen
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from playwright.async_api import BrowserContext, Page

# ── Config ─────────────────────────────────────────────────────────────────────
VERSION = "2.0.0"

PROFILE_DIR             = Path.home() / ".jobradar_agent"
LINKEDIN_PROFILE        = PROFILE_DIR / "chrome_profile_linkedin"
SUPERPOWERS_EXT         = PROFILE_DIR / "superpowers_ext"
INDEED_FF_PROFILE       = PROFILE_DIR / "firefox_profile_indeed"
INDEED_WEBKIT_PROFILE   = PROFILE_DIR / "webkit_profile_indeed"
INDEED_CHROMIUM_PROFILE = PROFILE_DIR / "chromium_profile_indeed"

# Baked in at download time; override via env var or --backend flag.
DEFAULT_BACKEND_URL = "http://localhost:3001"
# DEFAULT_BACKEND_URL = "http://localhost:3001"
# DEFAULT_SERVER_BACKEND_URL = "https://jobhawk-production.up.railway.app"
# Set to False to see the browser window (useful for debugging captchas).
LINKEDIN_HEADLESS = True
INDEED_HEADLESS   = False
HEARTBEAT_INTERVAL       = 25
RECONNECT_DELAY          = 5
MAX_RECONNECT_DELAY      = 60
OPEN_TIMEOUT_SECONDS     = 45
WAKE_TIMEOUT_SECONDS     = 12
WS_PING_INTERVAL_SECONDS = 20
WS_PING_TIMEOUT_SECONDS  = 20
MAX_JOBS                 = 100

INDEED_BASE = "https://de.indeed.com"
INDEED_LOGIN_URL = "https://secure.indeed.com/auth"
# Browser profile used for Indeed login + session (must match scraping browser for cookies).
INDEED_LOGIN_BROWSER = os.environ.get("INDEED_LOGIN_BROWSER", "browseruse").strip().lower()
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


# Cloudflare JS challenges — patchright can auto-solve these if we just wait
_CLOUDFLARE_PATTERNS = [
    "just a moment",
    "checking your browser",
    "cf-browser-verification",
    "cf_chl_prog",
    "enable javascript and cookies to continue",
]

# Hard bot-walls that require human intervention — stop immediately
_HARD_CAPTCHA_PATTERNS = [
    "zusätzliche verifizierung erforderlich",
    "additional verification required",
    "verify you are human",
    "are you a robot",
    "bitte bestätigen sie, dass sie kein roboter",
    "please verify you are a human",
    "access to this page has been denied",
    "security check",
    "automated access",
]


async def _page_text(page: Page) -> str:
    try:
        title = (await page.title()).lower()
        body = await page.evaluate("document.body ? document.body.innerText.toLowerCase() : ''")
        return title + " " + body
    except Exception:
        return ""


async def _check_indeed_captcha(page: Page) -> bool:
    """Return True if blocked by a wall that won't auto-resolve.
    Cloudflare JS challenges are given up to 20 s for patchright to solve them."""
    text = await _page_text(page)

    if any(p in text for p in _HARD_CAPTCHA_PATTERNS):
        return True

    if any(p in text for p in _CLOUDFLARE_PATTERNS):
        log.info("[indeed] Cloudflare challenge — waiting for auto-resolve…")
        for _ in range(10):
            await asyncio.sleep(2.0)
            text2 = await _page_text(page)
            if not any(p in text2 for p in _CLOUDFLARE_PATTERNS):
                if any(p in text2 for p in _HARD_CAPTCHA_PATTERNS):
                    return True
                log.info("[indeed] ✅ Cloudflare resolved")
                return False
        log.warning("[indeed] Cloudflare did not resolve within 20 s")
        return True

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
    function def(obj, prop, val) {
        try { Object.defineProperty(obj, prop, { get: function(){ return val; }, configurable: true }); } catch(e) {}
    }

    // Safari/Mac fingerprint
    def(navigator, 'webdriver',           undefined);
    def(navigator, 'platform',            'MacIntel');
    def(navigator, 'vendor',              'Apple Computer, Inc.');
    def(navigator, 'hardwareConcurrency',  8);
    def(navigator, 'maxTouchPoints',       0);
    def(navigator, 'deviceMemory',         8);
    def(navigator, 'languages',           ['de-DE', 'de', 'en']);
    def(navigator, 'plugins',             []);

    // Screen: MacBook 1440×900, Retina colour depth
    def(screen, 'width',       1440);
    def(screen, 'height',       900);
    def(screen, 'availWidth',  1440);
    def(screen, 'availHeight',  877);
    def(screen, 'colorDepth',    30);
    def(screen, 'pixelDepth',    30);

    // Canvas fingerprint noise — imperceptible offset, unique per session
    try {
        var _cx = Math.random() * 0.4 - 0.2, _cy = Math.random() * 0.4 - 0.2;
        var origGC = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type) {
            var ctx = origGC.apply(this, arguments);
            if (ctx && type === '2d') {
                var origFT = ctx.fillText.bind(ctx);
                ctx.fillText = function(text, x, y) {
                    var extra = arguments.length > 3 ? [arguments[3]] : [];
                    return origFT.apply(ctx, [text, x + _cx, y + _cy].concat(extra));
                };
            }
            return ctx;
        };
    } catch(e) {}

    // WebGL vendor / renderer — report Apple GPU
    try {
        var _patchWGL = function(klass) {
            if (!window[klass]) return;
            var _orig = window[klass].prototype.getParameter;
            window[klass].prototype.getParameter = function(p) {
                if (p === 37445) return 'Apple Inc.';
                if (p === 37446) return 'Apple GPU';
                return _orig.call(this, p);
            };
        };
        _patchWGL('WebGLRenderingContext');
        _patchWGL('WebGL2RenderingContext');
    } catch(e) {}

    // AudioContext — per-session noise so audio fingerprint differs
    try {
        var _aNoise = (Math.random() * 2e-7) - 1e-7;
        var _origCB = AudioContext.prototype.createBuffer;
        AudioContext.prototype.createBuffer = function(ch, len, sr) {
            var buf = _origCB.call(this, ch, len, sr);
            for (var c = 0; c < buf.numberOfChannels; c++) {
                var d = buf.getChannelData(c);
                for (var i = 0; i < Math.min(d.length, 100); i++) d[i] += _aNoise;
            }
            return buf;
        };
    } catch(e) {}

    // Battery API — report nearly-full, on charger
    try {
        def(navigator, 'getBattery', function() {
            return Promise.resolve({
                charging: true, chargingTime: 0, dischargingTime: Infinity,
                level: 0.97 + Math.random() * 0.02,
                onchargingchange: null, onchargingtimechange: null,
                ondischargingtimechange: null, onlevelchange: null
            });
        });
    } catch(e) {}

    // Network connection info
    try {
        def(navigator, 'connection', {
            downlink: 10, effectiveType: '4g', rtt: 50, saveData: false, onchange: null
        });
    } catch(e) {}

    // Performance timing noise — prevent timing-based fingerprinting
    try {
        var _pNoise = Math.random() * 3;
        var _origNow = Performance.prototype.now;
        Performance.prototype.now = function() { return _origNow.call(this) + _pNoise; };
    } catch(e) {}

    // Permissions API — degrade gracefully instead of throwing
    if (navigator.permissions && navigator.permissions.query) {
        var _origQ = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = function(desc) {
            return _origQ(desc).catch(function() {
                return Promise.resolve({ state: 'denied', onchange: null });
            });
        };
    }
})();
"""

# Init script applied to Indeed's Chromium context (Chromium-appropriate fingerprint)
_CHROMIUM_INDEED_INIT_SCRIPT = """
(function () {
    function def(obj, prop, val) {
        try { Object.defineProperty(obj, prop, { get: function(){ return val; }, configurable: true }); } catch(e) {}
    }

    def(navigator, 'webdriver',           undefined);
    def(navigator, 'platform',            'Win32');
    def(navigator, 'vendor',              'Google Inc.');
    def(navigator, 'hardwareConcurrency',  8);
    def(navigator, 'maxTouchPoints',       0);
    def(navigator, 'deviceMemory',         8);
    def(navigator, 'languages',           ['de-DE', 'de', 'en-US', 'en']);

    // Minimal chrome object so scripts that probe window.chrome don't flag headless
    try {
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) window.chrome.runtime = {
            onConnect:  { addListener: function(){}, removeListener: function(){} },
            onMessage:  { addListener: function(){}, removeListener: function(){} },
            id: undefined
        };
        if (!window.chrome.app) window.chrome.app = { isInstalled: false };
    } catch(e) {}

    // Canvas noise
    try {
        var _cx = Math.random() * 0.4 - 0.2, _cy = Math.random() * 0.4 - 0.2;
        var origGC = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type) {
            var ctx = origGC.apply(this, arguments);
            if (ctx && type === '2d') {
                var origFT = ctx.fillText.bind(ctx);
                ctx.fillText = function(text, x, y) {
                    var extra = arguments.length > 3 ? [arguments[3]] : [];
                    return origFT.apply(ctx, [text, x + _cx, y + _cy].concat(extra));
                };
            }
            return ctx;
        };
    } catch(e) {}

    // WebGL — Intel GPU (common Windows laptop)
    try {
        var _patchWGL = function(klass) {
            if (!window[klass]) return;
            var _orig = window[klass].prototype.getParameter;
            window[klass].prototype.getParameter = function(p) {
                if (p === 37445) return 'Google Inc. (Intel)';
                if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                return _orig.call(this, p);
            };
        };
        _patchWGL('WebGLRenderingContext');
        _patchWGL('WebGL2RenderingContext');
    } catch(e) {}

    // AudioContext noise
    try {
        var _aNoise = (Math.random() * 2e-7) - 1e-7;
        var _origCB = AudioContext.prototype.createBuffer;
        AudioContext.prototype.createBuffer = function(ch, len, sr) {
            var buf = _origCB.call(this, ch, len, sr);
            for (var c = 0; c < buf.numberOfChannels; c++) {
                var d = buf.getChannelData(c);
                for (var i = 0; i < Math.min(d.length, 100); i++) d[i] += _aNoise;
            }
            return buf;
        };
    } catch(e) {}

    // Battery API
    try {
        def(navigator, 'getBattery', function() {
            return Promise.resolve({
                charging: true, chargingTime: 0, dischargingTime: Infinity,
                level: 0.95 + Math.random() * 0.04,
                onchargingchange: null, onchargingtimechange: null,
                ondischargingtimechange: null, onlevelchange: null
            });
        });
    } catch(e) {}

    // Connection info
    try {
        def(navigator, 'connection', {
            downlink: 10, effectiveType: '4g', rtt: 50, saveData: false, onchange: null
        });
    } catch(e) {}

    // Performance noise
    try {
        var _pNoise = Math.random() * 3;
        var _origNow = Performance.prototype.now;
        Performance.prototype.now = function() { return _origNow.call(this) + _pNoise; };
    } catch(e) {}

    // Permissions
    if (navigator.permissions && navigator.permissions.query) {
        var _origQ = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = function(desc) {
            return _origQ(desc).catch(function() {
                return Promise.resolve({ state: 'prompt', onchange: null });
            });
        };
    }
})();
"""


# Per-page mouse position tracking for Bezier movement (Indeed only)
_mouse_positions: Dict[int, tuple] = {}


async def _human_mouse_move(page: Page, tx: float, ty: float) -> None:
    """Move mouse to (tx, ty) along a quadratic Bezier arc — mimics natural hand movement."""
    pid = id(page)
    sx, sy = _mouse_positions.get(pid, (random.uniform(300, 800), random.uniform(200, 500)))
    # Control point offset creates the arc
    cx = (sx + tx) / 2 + random.uniform(-120, 120)
    cy = (sy + ty) / 2 + random.uniform(-70, 70)
    steps = random.randint(10, 18)
    for i in range(1, steps + 1):
        t = i / steps
        bx = (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t ** 2 * tx
        by = (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t ** 2 * ty
        try:
            await page.mouse.move(bx, by)
        except Exception:
            break
        await asyncio.sleep(random.uniform(0.008, 0.022))
    _mouse_positions[pid] = (tx, ty)


async def _random_mouse_wander(page: Page, steps: int = 3) -> None:
    """Wander the mouse across random viewport positions — indeed-only human simulation."""
    for _ in range(steps):
        x = random.uniform(160, 1200)
        y = random.uniform(80, 650)
        await _human_mouse_move(page, x, y)
        if random.random() < 0.35:
            await asyncio.sleep(random.uniform(0.12, 0.40))


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

_LI_DESC_JS = """
(() => {
    const containers = [
        document.querySelector('#job-details'),
        document.querySelector('.jobs-description__content'),
        document.querySelector('.jobs-description-content__text'),
        document.querySelector('.jobs-description')
    ].filter(Boolean);

    let text = '';
    for (const el of containers) {
        const t = el.innerText.trim();
        if (t.length > 50) { text = t; break; }
    }
    if (!text) {
        const main = document.querySelector('main') || document.querySelector('[role="main"]');
        if (main) text = main.innerText.trim();
    }
    if (!text || text.length < 50) return '';

    // Start from "Details zum Jobangebot" / English equivalents
    const startMarkers = ['Details zum Jobangebot', 'About the job', 'Über die Stelle', 'About this role'];
    for (const m of startMarkers) {
        const idx = text.indexOf(m);
        if (idx !== -1) { text = text.slice(idx); break; }
    }

    // Stop before "Benachrichtigung für ähnliche Jobangebote einrichten" / English equivalents
    const endMarkers = [
        'Benachrichtigung für ähnliche Jobangebote einrichten',
        'Set alert for similar jobs',
        'Ähnliche Jobs per E-Mail',
        'Job-Alert erstellen'
    ];
    for (const m of endMarkers) {
        const idx = text.indexOf(m);
        if (idx !== -1) { text = text.slice(0, idx).trim(); break; }
    }

    return text.length > 50 ? text.slice(0, 20000) : '';
})()
"""

_INDEED_DESC_JS = """
(() => {
    // Detect captcha / security check
    const pageText = (document.body || document.documentElement).innerText || '';
    if (/Zusätzliche Verifizierung erforderlich|captcha|security check|verify you are human|robot|Überprüfung erforderlich/i.test(pageText.slice(0, 3000))) {
        return '__CAPTCHA__';
    }

    const sels = [
        '#jobDescriptionText',
        '.jobsearch-JobComponent-description',
        '.jobsearch-jobDescriptionText',
        '[data-testid="jobsearch-JobComponent-description"]',
        '.jobDescription'
    ];
    let text = '';
    for (const s of sels) {
        const el = document.querySelector(s);
        if (el && el.innerText && el.innerText.trim().length > 50) { text = el.innerText.trim(); break; }
    }
    if (!text) {
        const main = document.querySelector('main') || document.querySelector('[role="main"]');
        if (main && main.innerText) text = main.innerText.trim();
    }
    if (!text || text.length < 50) return '';

    // Start after "Vollständige Stellenbeschreibung" / "Full job description" heading
    const startMarkers = ['Vollständige Stellenbeschreibung', 'Full job description'];
    for (const m of startMarkers) {
        const idx = text.indexOf(m);
        if (idx !== -1) { text = text.slice(idx + m.length).trim(); break; }
    }

    // Stop before "Diesen Job melden" / "Report job" button
    const endMarkers = ['Diesen Job melden', 'Report job', 'Report this job'];
    for (const m of endMarkers) {
        const idx = text.indexOf(m);
        if (idx !== -1) { text = text.slice(0, idx).trim(); break; }
    }

    return text.length > 50 ? text.slice(0, 20000) : '';
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
        merge(await page.evaluate(_LI_EXTRACT_JS))
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


async def _search_indeed_form(page: Page, keywords: str, location: str) -> bool:
    """Type into Indeed's search form — far more human-like than direct URL navigation.
    Returns True if the form was found, filled, and submitted successfully."""
    try:
        what = await page.wait_for_selector(
            '#text-input-what, input[name="q"][type="text"]',
            timeout=6_000,
        )
        if not what:
            return False

        bb = await what.bounding_box()
        if bb:
            await _human_mouse_move(page, bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
        await what.click()
        await asyncio.sleep(random.uniform(0.3, 0.6))
        await page.keyboard.press("Control+a")
        await asyncio.sleep(random.uniform(0.08, 0.18))
        for ch in keywords:
            await page.keyboard.type(ch)
            await asyncio.sleep(random.uniform(0.04, 0.13))
        await asyncio.sleep(random.uniform(0.4, 0.9))

        if location.strip():
            where = await page.query_selector('#text-input-where, input[name="l"][type="text"]')
            if where:
                bb2 = await where.bounding_box()
                if bb2:
                    await _human_mouse_move(page, bb2["x"] + bb2["width"] / 2, bb2["y"] + bb2["height"] / 2)
                await where.triple_click()
                await asyncio.sleep(random.uniform(0.1, 0.3))
                for ch in location:
                    await page.keyboard.type(ch)
                    await asyncio.sleep(random.uniform(0.03, 0.10))
                await asyncio.sleep(random.uniform(0.3, 0.6))

        submitted = False
        for sel in ['button[type="submit"]', 'button[data-testid="findJobsSubmit"]', '#whatWhereFormId button']:
            btn = await page.query_selector(sel)
            if btn:
                bb3 = await btn.bounding_box()
                if bb3:
                    await _human_mouse_move(page, bb3["x"] + bb3["width"] / 2, bb3["y"] + bb3["height"] / 2)
                await btn.click()
                submitted = True
                break
        if not submitted:
            await page.keyboard.press("Enter")

        await page.wait_for_load_state("domcontentloaded", timeout=30_000)
        return "q=" in page.url or "/jobs" in page.url

    except Exception:
        return False


async def _navigate_indeed(page: Page, search_url: str, keywords: str = "", location: str = "") -> int:
    base = INDEED_BASE + "/"
    try:
        await page.goto(base, wait_until="domcontentloaded", timeout=60_000)
    except Exception:
        pass

    await asyncio.sleep(random.uniform(1.5, 2.5))
    await _dismiss_indeed_consent(page)
    await asyncio.sleep(random.uniform(0.3, 0.7))
    await _random_mouse_wander(page, steps=random.randint(2, 4))
    await asyncio.sleep(random.uniform(0.5, 1.0))

    # Primary: type into the search form — most human-like approach
    if keywords and await _search_indeed_form(page, keywords, location):
        return 200

    # Fallback: direct URL navigation with referer
    try:
        resp = await page.goto(search_url, wait_until="domcontentloaded", timeout=90_000, referer=base)
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


async def scrape_indeed(page: Page, keywords: str, location: str, max_jobs: int, progress_cb=None, skip_stealth: bool = False) -> List[Dict]:
    from urllib.parse import urlencode as _ue
    params: Dict[str, str] = {"q": keywords.strip(), "sort": "date", "fromage": "last"}
    if location.strip():
        params["l"] = location.strip()
    search_url = f"{INDEED_BASE}/jobs?{_ue(params)}"
    log.info(f"[indeed] → {search_url}")

    if not skip_stealth:
        await _apply_stealth(page, chromium=False)
    http_status = await _navigate_indeed(page, search_url, keywords=keywords.strip(), location=location.strip())
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

        # Periodic captcha check — stop immediately if a bot-wall appears mid-scrape
        if rnd % 8 == 7:
            if await _check_indeed_captcha(page):
                raise IndeedCaptchaError(
                    "Captcha / bot-wall detected mid-scrape. Stopping immediately."
                )

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

    result = list(merged.values())[:max_jobs]
    log.info(f"[indeed] total: {len(result)} jobs")
    for j in result:
        j["id"] = str(uuid.uuid4())
    return result


# ── JobHawk Agent ──────────────────────────────────────────────────────────────

class JobHawkAgent:
    def __init__(self, backend_url: str):
        self.backend_url = backend_url.rstrip("/")
        base_ws = self.backend_url.replace("https://", "wss://").replace("http://", "ws://")
        self.linkedin_ws_url = base_ws + "/ws/linkedin-agent"
        self.indeed_ws_url   = base_ws + "/ws/indeed-agent"

        self.playwright = None
        self.linkedin_ctx: Optional[BrowserContext] = None
        self.indeed_ctx:   Optional[BrowserContext] = None
        self.indeed_browser_type: str = "webkit"  # set on first scrape
        self._patchright_pcm = None  # patchright context manager (kept alive when browseruse mode)

        self.linkedin_has_session = False
        self.indeed_has_session = False
        self.running = True
        self._li_reconnect  = RECONNECT_DELAY
        self._ind_reconnect = RECONNECT_DELAY

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

    async def _open_indeed_ctx(self, browser_type: str) -> BrowserContext:
        """Create a persistent Indeed browser context for the given engine."""
        if browser_type == "browseruse":
            # Patchright: patched Playwright Chromium with all automation markers removed.
            # Indeed sees it as a regular Chrome — no bot walls, no captcha.
            # Install: pip install patchright && patchright install chromium
            if not _patchright_available:
                raise RuntimeError(
                    "patchright not installed. Run:\n"
                    "    pip install patchright\n"
                    "    patchright install chromium"
                )
            INDEED_CHROMIUM_PROFILE.mkdir(parents=True, exist_ok=True)
            # Start a dedicated patchright instance (kept alive alongside self.indeed_ctx)
            self._patchright_pcm = _patchright_playwright()
            p = await self._patchright_pcm.start()
            ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ctx = await p.chromium.launch_persistent_context(
                str(INDEED_CHROMIUM_PROFILE),
                headless=False,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--window-size=1366,768",
                ],
                user_agent=ua,
                viewport={"width": 1366, "height": 768},
                locale="de-DE",
                timezone_id="Europe/Berlin",
                extra_http_headers={
                    "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                },
            )
            return ctx

        if browser_type == "firefox":
            INDEED_FF_PROFILE.mkdir(parents=True, exist_ok=True)
            ua = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
            return await self.playwright.firefox.launch_persistent_context(
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
        if browser_type == "chromium":
            INDEED_CHROMIUM_PROFILE.mkdir(parents=True, exist_ok=True)
            ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ctx = await self.playwright.chromium.launch_persistent_context(
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
                    "Sec-CH-UA": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
                    "Sec-CH-UA-Mobile": "?0",
                    "Sec-CH-UA-Platform": '"Windows"',
                },
            )
            await ctx.add_init_script(_CHROMIUM_INDEED_INIT_SCRIPT)
            return ctx
        # Default: WebKit (Safari engine) — best anti-bot fingerprint for Indeed
        INDEED_WEBKIT_PROFILE.mkdir(parents=True, exist_ok=True)
        ua = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) "
            "Version/17.4.1 Safari/605.1.15"
        )
        ctx = await self.playwright.webkit.launch_persistent_context(
            str(INDEED_WEBKIT_PROFILE),
            headless=INDEED_HEADLESS,
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

    async def _get_indeed_ctx(self, browser_type: str) -> BrowserContext:
        """Return the persistent Indeed context, creating it on first call."""
        if self.indeed_ctx is None:
            self.indeed_browser_type = browser_type
            label = "patchright (anti-detect Chrome)" if browser_type == "browseruse" else browser_type
            log.info(f"[indeed] launching {label}…")
            self.indeed_ctx = await self._open_indeed_ctx(browser_type)
            log.info(f"[indeed] ✅ {browser_type} ready")
        return self.indeed_ctx

    # ── Indeed auth ────────────────────────────────────────────────────────────

    async def _indeed_logged_in(self) -> bool:
        if not self.indeed_ctx:
            return False
        page = await self.indeed_ctx.new_page()
        try:
            await page.goto(INDEED_BASE + "/", wait_until="domcontentloaded", timeout=25_000)
            await asyncio.sleep(1.2)
            if await _check_indeed_captcha(page):
                log.warning("[indeed] captcha/bot wall during session check")
                return False
            return await page.evaluate("""() => {
                const url = location.href.toLowerCase();
                if (url.includes('secure.indeed.com/auth') || url.includes('/account/login')) return false;
                const body = (document.body?.innerText || '').toLowerCase();
                if (body.includes('abmelden') || body.includes('sign out') || body.includes('mein konto')) return true;
                const accountLink = document.querySelector(
                    'a[href*="account"], a[href*="profile"], [data-gnav-element-name="Account"]'
                );
                if (accountLink) return true;
                const signIn = document.querySelector('a[href*="auth"], a[href*="login"]');
                if (signIn && (signIn.innerText || '').toLowerCase().includes('anmelden')) return false;
                return !url.includes('/auth');
            }""")
        except Exception as e:
            log.warning(f"[indeed] session check failed: {e!s:.120}")
            return False
        finally:
            await page.close()

    async def _indeed_setup(self):
        print("\n=== Indeed Login Setup ===")
        print("A browser window will open. Please log in to Indeed (de.indeed.com).")
        print(f"Profile: {INDEED_LOGIN_BROWSER} — use the same browser in Settings for scraping.")
        print("After you are logged in, press Enter here.\n")
        page = await self.indeed_ctx.new_page()
        try:
            await page.goto(INDEED_LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
            await _dismiss_indeed_consent(page)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: input("Press Enter after you have logged in to Indeed...\n"))
            await page.goto(INDEED_BASE + "/", wait_until="domcontentloaded", timeout=20_000)
            await asyncio.sleep(1.0)
            if await self._indeed_logged_in():
                print("\n✅  Indeed login successful! Profile saved.")
            else:
                print("\n⚠️  Could not verify Indeed login, but profile is saved. Try running again.")
        except Exception as e:
            print(f"\n⚠️  Navigation check failed ({e}), but profile is saved.")
        finally:
            await page.close()

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

    async def _handle_describe_jobs_linkedin(self, ws, request_id: str, jobs: List[Dict]):
        """Phase 2: visit each LinkedIn job URL and send back its description."""
        page = await self.linkedin_ctx.new_page()
        try:
            for job in jobs:
                url = job.get("url", "")
                if not url:
                    continue
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=25_000)
                    await asyncio.sleep(1.0 + random.uniform(0, 0.6))
                    desc = await page.evaluate(_LI_DESC_JS)
                    if desc and len(desc.strip()) > 50:
                        try:
                            await ws.send(json.dumps({
                                "type": "description_update",
                                "requestId": request_id,
                                "url": url,
                                "description": desc.strip(),
                            }))

                        except Exception:
                            return  # WS closed, stop
                except Exception as e:
                    log.warning(f"[linkedin] desc fetch failed for {url}: {e!s:.80}")
                await asyncio.sleep(0.6 + random.uniform(0, 0.5))
        finally:
            await page.close()
        log.info(f"[linkedin] Phase 2 enrichment done for {len(jobs)} jobs")

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
                    elif t == "describe_jobs":
                        asyncio.create_task(self._handle_describe_jobs_linkedin(ws, msg.get("requestId", ""), msg.get("jobs", [])))
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
        if not self.indeed_has_session:
            try:
                await ws.send(json.dumps({
                    "type": "scrape_error",
                    "requestId": request_id,
                    "error": "Indeed is not logged in. Restart jobhawk_agent.py and log in to Indeed when prompted.",
                }))
            except Exception:
                pass
            return

        browser = str(params.get("browser", INDEED_LOGIN_BROWSER)).lower()
        if browser != self.indeed_browser_type:
            log.warning(
                f"[indeed] scrape browser={browser} differs from login profile={self.indeed_browser_type}; "
                f"using login profile for session cookies",
            )
            browser = self.indeed_browser_type
        ctx = await self._get_indeed_ctx(browser)
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
                skip_stealth=(self.indeed_browser_type == "browseruse"),
            )
            await progress(100)
            await ws.send(json.dumps({"type": "scrape_result", "requestId": request_id, "jobs": jobs, "count": len(jobs)}))
            log.info(f"[indeed] scrape done — {len(jobs)} jobs")
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
            await page.close()

    async def _handle_describe_jobs_indeed(self, ws, request_id: str, jobs: List[Dict]):
        """Phase 2: visit each Indeed job URL and send back its description."""
        if not self.indeed_has_session:
            log.warning("[indeed] describe_jobs skipped — no session")
            return
        ctx = await self._get_indeed_ctx(self.indeed_browser_type)
        page = await ctx.new_page()
        try:
            for job in jobs:
                url = job.get("url", "")
                if not url:
                    continue
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=25_000)
                    await asyncio.sleep(1.0 + random.uniform(0, 0.6))

                    # If Indeed shows a bot-wall, save an error message as the description
                    if await _check_indeed_captcha(page):
                        log.warning("[indeed] captcha detected during describe phase")
                        try:
                            await ws.send(json.dumps({
                                "type": "description_update",
                                "requestId": request_id,
                                "url": url,
                                "description": "⚠️ Description not available — Indeed blocked the request (Captcha/Cloudflare). Please open the link manually to view the full description.",
                            }))
                        except Exception:
                            return
                        continue

                    desc = await page.evaluate(_INDEED_DESC_JS)
                    if desc == '__CAPTCHA__':
                        desc = '⚠️ Captcha detected — Indeed blocked the request. Description not available.'
                    if desc and len(desc.strip()) > 10:
                        try:
                            await ws.send(json.dumps({
                                "type": "description_update",
                                "requestId": request_id,
                                "url": url,
                                "description": desc.strip(),
                            }))

                        except Exception:
                            return  # WS closed, stop
                except Exception as e:
                    log.warning(f"[indeed] desc fetch failed for {url}: {e!s:.80}")
                await asyncio.sleep(0.6 + random.uniform(0, 0.5))
        finally:
            await page.close()
        log.info(f"[indeed] Phase 2 enrichment done for {len(jobs)} jobs")

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
            await ws.send(json.dumps({
                "type": "hello",
                "platform": "indeed",
                "hasSession": self.indeed_has_session,
                "version": VERSION,
            }))

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
                    elif t == "describe_jobs":
                        asyncio.create_task(self._handle_describe_jobs_indeed(ws, msg.get("requestId", ""), msg.get("jobs", [])))
                    elif t == "check_session":
                        ok = await self._indeed_logged_in()
                        self.indeed_has_session = ok
                        await ws.send(json.dumps({"type": "session_status", "hasSession": ok}))
            finally:
                hb.cancel()

    async def _run_indeed(self):
        login_browser = INDEED_LOGIN_BROWSER
        if login_browser not in ("browseruse", "webkit", "chromium", "firefox"):
            log.warning(f"[indeed] unknown INDEED_LOGIN_BROWSER={login_browser!r}, using browseruse")
            login_browser = "browseruse"

        log.info(f"[indeed] launching {login_browser} for login/session…")
        self.indeed_ctx = await self._open_indeed_ctx(login_browser)
        self.indeed_browser_type = login_browser
        log.info(f"[indeed] ✅ {login_browser} ready")

        log.info("[indeed] checking session…")
        if not await self._indeed_logged_in():
            print("\n⚠️  No active Indeed session.")
            await self._indeed_setup()
            if not await self._indeed_logged_in():
                print("\n❌  Indeed login incomplete. Re-run the script and log in.")
                try:
                    await self.indeed_ctx.close()
                except Exception:
                    pass
                self.indeed_ctx = None
                return

        self.indeed_has_session = True
        log.info("[indeed] ✅ session active — entering WS loop")

        while self.running:
            try:
                await self._indeed_ws_loop()
            except Exception as e:
                log.warning(f"[indeed] WS error: {e}. Reconnecting in {self._ind_reconnect}s…")
                await asyncio.sleep(self._ind_reconnect + random.uniform(0, 1.5))
                self._ind_reconnect = min(MAX_RECONNECT_DELAY, self._ind_reconnect * 2)

        if self.indeed_ctx:
            try:
                await self.indeed_ctx.close()
            except Exception:
                pass
        if self._patchright_pcm:
            try:
                await self._patchright_pcm.stop()
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
        for d in [
            PROFILE_DIR,
            LINKEDIN_PROFILE,
            INDEED_FF_PROFILE,
            INDEED_WEBKIT_PROFILE,
            INDEED_CHROMIUM_PROFILE,
        ]:
            d.mkdir(parents=True, exist_ok=True)

        ext = _superpowers_path()
        if ext:
            log.info(f"✅  Superpowers extension loaded (LinkedIn/Chromium): {ext}")
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
    args = parser.parse_args()

    backend_url = args.backend or os.environ.get("JOBRADAR_BACKEND_URL") or DEFAULT_BACKEND_URL

    if not backend_url or backend_url == "BACKEND_URL_PLACEHOLDER":
        print("Backend URL is not set.")
        print("Download this script from your app's Settings page (it bakes in the URL),")
        print("or set JOBRADAR_BACKEND_URL env var.")
        sys.exit(1)

    agent = JobHawkAgent(backend_url)

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
