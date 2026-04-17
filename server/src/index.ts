import 'dotenv/config'
import express from 'express'
import cors from 'cors'
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

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`✅  JobRadar API  →  http://localhost:${PORT}`)
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`)
})

async function shutdown() {
  console.log('\nShutting down…')
  await closeBrowser()
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
