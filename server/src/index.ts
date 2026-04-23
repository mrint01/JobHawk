import 'dotenv/config'
import http from 'http'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import scrapeRouter from './routes/scrape'
import authRouter, { AUTH_MODE } from './routes/auth'
import jobsRouter from './routes/jobs'
import usersRouter from './routes/users'
import { sessionsForUser, saveSession, hasSession, clearSession, loadSessionsFromDB } from './utils/sessions'
import { loadAdminUUID, resolveUserId } from './utils/userStore'
import { closeBrowser } from './utils/browser'
import { closeLinkedInFirefoxBrowser } from './utils/linkedinFirefox'
import { materializeLinkedInSessionFromLiAt } from './utils/linkedinBootstrap'
import {
  readLinkedInSessionFile,
  isLinkedInSessionExpired,
  sessionFileToPuppeteerCookies,
  sessionNeedsPuppeteerMaterialization,
} from './utils/linkedinSession'
import {
  registerAgent,
  unregisterAgent,
  handleAgentMessage,
  getAgentStatus,
} from './utils/linkedinAgentHub'

const PORT = Number(process.env.PORT ?? 3001)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())

// Works for both dev (src/) and prod (dist/) because scripts/ is one level up from either
const AGENT_SCRIPT_PATH = path.resolve(__dirname, '../scripts/linkedin_agent.py')

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

app.get('/api/health', (req, res) => {
  const rawUserId = String(req.header('x-user-id') || 'admin')
  const userId = resolveUserId(rawUserId)

  const sessionPlatforms = Object.keys(sessionsForUser(rawUserId)) as string[]

  // Include linkedin if the local agent is connected and has a session
  const agentStatus = getAgentStatus()
  if (agentStatus.connected && agentStatus.hasSession && !sessionPlatforms.includes('linkedin')) {
    sessionPlatforms.push('linkedin')
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connectedPlatforms: sessionPlatforms,
    authMode: AUTH_MODE,
  })
})

// ── LinkedIn Agent endpoints ──────────────────────────────────────────────────

app.get('/api/linkedin/agent-status', (_req, res) => {
  res.json(getAgentStatus())
})

app.get('/api/linkedin/agent/download', (req, res) => {
  if (!fs.existsSync(AGENT_SCRIPT_PATH)) {
    res.status(404).json({ error: 'Agent script not found on server' })
    return
  }
  try {
    // Bake the backend URL into the downloaded script so the user never has to enter it
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol
    const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host
    const backendUrl = `${proto}://${host}`
    const content = fs.readFileSync(AGENT_SCRIPT_PATH, 'utf8')
      .replace('"BACKEND_URL_PLACEHOLDER"', JSON.stringify(backendUrl))
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="linkedin_agent.py"')
    res.send(content)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
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

// ── LinkedIn session watchdog (every 30 min) ─────────────────────────────────
setInterval(() => {
  if (!hasSession('admin', 'linkedin')) return
  const file = readLinkedInSessionFile()
  if (!file || isLinkedInSessionExpired(file)) {
    void clearSession('admin', 'linkedin')
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
    await saveSession('admin', 'linkedin', {
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
        await saveSession('admin', 'linkedin', {
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
async function start() {
  await loadAdminUUID()
  await loadSessionsFromDB()
  await preloadLinkedInSessionFromDisk()

  const server = http.createServer(app)

  // ── LinkedIn Agent WebSocket server ─────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? ''
    if (url.startsWith('/ws/linkedin-agent')) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    } else {
      socket.destroy()
    }
  })

  wss.on('connection', (ws: WebSocket) => {
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }))
      }
    }, 30_000)

    ws.on('message', (data: Buffer) => {
      const raw = data.toString()
      try {
        const msg = JSON.parse(raw)
        if (msg.type === 'hello') {
          registerAgent(ws, Boolean(msg.hasSession), String(msg.username ?? ''), String(msg.version ?? '1.0'))
        } else {
          handleAgentMessage(raw)
        }
      } catch {
        // ignore malformed messages
      }
    })

    ws.on('close', () => {
      clearInterval(pingInterval)
      unregisterAgent()
    })

    ws.on('error', () => {
      clearInterval(pingInterval)
      unregisterAgent()
    })
  })

  server.listen(PORT, () => {
    console.log(`✅  JobHawk API  →  http://localhost:${PORT}`)
    console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
    console.log(`   LinkedIn agent WS: ws://localhost:${PORT}/ws/linkedin-agent`)
  })

  async function shutdown() {
    console.log('\nShutting down…')
    await closeLinkedInFirefoxBrowser()
    await closeBrowser()
    server.close(() => process.exit(0))
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void start()
