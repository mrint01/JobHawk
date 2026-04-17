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

// ── Debug: view latest Puppeteer screenshot ───────────────────────────────────
// Temporary endpoint — remove once debugging is done.
// Lists all /tmp/*.png files or serves the latest one.
app.get('/api/debug/screenshots', (_req, res) => {
  try {
    const files = fs.readdirSync('/tmp')
      .filter((f) => f.endsWith('.png'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join('/tmp', f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    res.json({ files: files.map((f) => `/api/debug/screenshot/${f.name}`) })
  } catch {
    res.json({ files: [] })
  }
})

app.get('/api/debug/screenshot/:filename', (req, res) => {
  const filename = path.basename(req.params.filename)
  const filepath = path.join('/tmp', filename)
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'File not found' })
    return
  }
  res.setHeader('Content-Type', 'image/png')
  res.sendFile(filepath)
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
