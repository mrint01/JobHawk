import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import scrapeRouter from './routes/scrape'
import authRouter, { AUTH_MODE } from './routes/auth'
import jobsRouter from './routes/jobs'
import usersRouter from './routes/users'
import { sessionsForUser, saveSession, hasSession, clearSession, loadSessionsFromDisk } from './utils/sessions'
import { closeBrowser } from './utils/browser'
import { closeLinkedInFirefoxBrowser } from './utils/linkedinFirefox'
import { materializeLinkedInSessionFromLiAt } from './utils/linkedinBootstrap'
import {
  readLinkedInSessionFile,
  isLinkedInSessionExpired,
  sessionFileToPuppeteerCookies,
  sessionNeedsPuppeteerMaterialization,
} from './utils/linkedinSession'

const PORT = Number(process.env.PORT ?? 3001)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())

const app = express()

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
      cb(new Error(`CORS: origin ${origin} is not allowed`))
    },
    credentials: true,
  }),
)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/ping', (_req, res) => { res.json({ pong: true, v: 2 }) })

// Health check — returns connected platforms for the requesting user
app.get('/api/health', (req, res) => {
  const userId = String(req.header('x-user-id') || 'admin')
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connectedPlatforms: Object.keys(sessionsForUser(userId)),
    authMode: AUTH_MODE,
  })
})

app.use('/api/auth', authRouter)
app.use('/api/scrape', scrapeRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/users', usersRouter)

// ── Debug: view Puppeteer screenshots ────────────────────────────────────────
app.get('/api/debug/screenshots', (req, res) => {
  try {
    const files = fs.readdirSync('/tmp')
      .filter((f) => f.endsWith('.png'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join('/tmp', f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    const links = files.map((f) => `https://${req.headers.host}/api/debug/screenshot/${f.name}`)
    res.json({ count: files.length, files: links })
  } catch (err) {
    res.json({ count: 0, files: [], error: String(err) })
  }
})

app.get('/api/debug/screenshot/:filename', (req, res) => {
  try {
    const filename = path.basename(String(req.params.filename))
    const filepath = path.join('/tmp', filename)
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: 'File not found', looked: filepath })
      return
    }
    const data = fs.readFileSync(filepath)
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Length', data.length)
    res.end(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ── LinkedIn session watchdog (every 30 min) — monitors admin's preloaded session ──
setInterval(() => {
  if (!hasSession('admin', 'linkedin')) return
  const file = readLinkedInSessionFile()
  if (!file || isLinkedInSessionExpired(file)) {
    clearSession('admin', 'linkedin')
    console.log('[session-monitor] LinkedIn session cleared — file missing or expired')
  }
}, 30 * 60 * 1000)

async function preloadLinkedInSessionFromDisk(): Promise<void> {
  const linkedInFile = readLinkedInSessionFile()
  if (!linkedInFile) return
  if (isLinkedInSessionExpired(linkedInFile)) {
    console.log('⚠️   LinkedIn session file found but expired — run the capture script again')
    return
  }

  try {
    if (sessionNeedsPuppeteerMaterialization(linkedInFile)) {
      await materializeLinkedInSessionFromLiAt(linkedInFile.liAt, linkedInFile.username, 'admin')
      console.log(`✅  LinkedIn session materialized on startup (user: ${linkedInFile.username})`)
      return
    }
    const puppeteerCookies = sessionFileToPuppeteerCookies(linkedInFile)
    saveSession('admin', 'linkedin', {
      cookies: puppeteerCookies,
      loggedInAt: new Date(linkedInFile.capturedAt),
      username: linkedInFile.username,
    })
    console.log(`✅  LinkedIn session pre-loaded (${puppeteerCookies.length} cookies, user: ${linkedInFile.username})`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`⚠️   LinkedIn startup session failed: ${msg}`)
    try {
      const again = readLinkedInSessionFile()
      if (!again) return
      const fallback = sessionFileToPuppeteerCookies(again)
      if (fallback.length > 0) {
        saveSession('admin', 'linkedin', {
          cookies: fallback,
          loggedInAt: new Date(again.capturedAt),
          username: again.username,
        })
        console.log('✅  LinkedIn session pre-loaded (li_at fallback only — run import again if scrapes fail)')
      }
    } catch {
      // ignore
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
loadSessionsFromDisk()
void preloadLinkedInSessionFromDisk().finally(() => {
  const server = app.listen(PORT, () => {
    console.log(`✅  JobHawk API  →  http://localhost:${PORT}`)
    console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
  })

  async function shutdown() {
    console.log('\nShutting down…')
    await closeLinkedInFirefoxBrowser()
    await closeBrowser()
    server.close(() => process.exit(0))
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
})

