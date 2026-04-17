import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import scrapeRouter from './routes/scrape'
import authRouter, { AUTH_MODE } from './routes/auth'
import jobsRouter from './routes/jobs'
import { allSessions } from './utils/sessions'
import { closeBrowser } from './utils/browser'

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

// Health check — includes which platforms have active sessions
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connectedPlatforms: Object.keys(allSessions()),
    authMode: AUTH_MODE,
  })
})

app.use('/api/auth', authRouter)
app.use('/api/scrape', scrapeRouter)
app.use('/api/jobs', jobsRouter)

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

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`✅  JobHawk API  →  http://localhost:${PORT}`)
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
})

async function shutdown() {
  console.log('\nShutting down…')
  await closeBrowser()
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
