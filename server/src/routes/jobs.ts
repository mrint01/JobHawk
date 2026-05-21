import { Router, type Request, type Response } from 'express'
import {
  readJobsForUser,
  markAppliedForUser,
  markUnappliedForUser,
  markStatusForUser,
  updateJobInterviewForUser,
  clearJobsForUser,
  clearNewJobOffersForUser,
  deleteJobForUser,
  analyticsByUser,
  analyticsAllUsers,
  analyticsAllUsersSeries,
  analyticsCitiesByUser,
  analyticsCitiesAllUsers,
  analyticsPlatformsByUser,
  analyticsPlatformsAllUsers,
} from '../utils/jobStore'
import { isAdmin, resolveUserId } from '../utils/userStore'
import type { JobStatus } from '../scrapers/types'
import { isAgentReady, sendDescribeJobs } from '../utils/linkedinAgentHub'
import { isIndeedAgentReady, sendDescribeIndeedJobs } from '../utils/indeedAgentHub'
import { enrichJobsBackground } from '../utils/descriptionEnricher'

const router = Router()
const ALLOWED_STATUSES = new Set([
  'new',
  'applied',
  'hr_interview',
  'technical_interview',
  'second_technical_interview',
  'refused',
  'accepted',
])

function getUserId(req: Request): string {
  return resolveUserId(String(req.header('x-user-id') || 'admin'))
}

router.get('/', async (req: Request, res: Response) => {
  res.json(await readJobsForUser(getUserId(req)))
})

router.delete('/offers', async (req: Request, res: Response) => {
  res.json(await clearNewJobOffersForUser(getUserId(req)))
})

router.patch('/:id/apply', async (req: Request, res: Response) => {
  const userId = getUserId(req)
  const id = String(req.params.id)
  const jobs = await markAppliedForUser(userId, id)

  // Fetch description in the background for this newly-applied job
  const job = jobs.find((j) => j.id === id)
  if (job && !job.description) {
    if (job.platform === 'linkedin' && isAgentReady()) {
      sendDescribeJobs([{ url: job.url }], userId)
    } else if (job.platform === 'indeed' && isIndeedAgentReady()) {
      sendDescribeIndeedJobs([{ url: job.url }], userId)
    } else {
      enrichJobsBackground([{ id: job.id, url: job.url, platform: job.platform, userId }])
    }
  }

  res.json(jobs)
})

router.patch('/:id/unapply', async (req: Request, res: Response) => {
  res.json(await markUnappliedForUser(getUserId(req), String(req.params.id)))
})

router.patch('/:id/status', async (req: Request, res: Response) => {
  const status = String(req.body?.status ?? '')
  if (!ALLOWED_STATUSES.has(status)) {
    res.status(400).json({ error: 'Invalid status' })
    return
  }
  let opts: { interviewAt?: string | null } | undefined
  const body = req.body as Record<string, unknown>
  if (body && typeof body === 'object' && 'interviewAt' in body) {
    const v = body.interviewAt
    if (v === null || v === '') opts = { interviewAt: null }
    else if (typeof v === 'string') {
      const d = new Date(v)
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: 'Invalid interviewAt' })
        return
      }
      opts = { interviewAt: d.toISOString() }
    }
  }
  res.json(await markStatusForUser(getUserId(req), String(req.params.id), status as JobStatus, opts))
})

router.patch('/:id/interview', async (req: Request, res: Response) => {
  const id = String(req.params.id)
  const body = req.body as Record<string, unknown>
  const hasAt = body && typeof body === 'object' && 'interviewAt' in body
  const hasNotes = body && typeof body === 'object' && 'interviewNotes' in body
  if (!hasAt && !hasNotes) {
    res.status(400).json({ error: 'No interview fields to update' })
    return
  }
  const patch: { interviewAt?: string | null; interviewNotes?: string | null } = {}
  if (hasAt) {
    const raw = body.interviewAt
    if (raw === null || raw === '') patch.interviewAt = null
    else if (typeof raw === 'string') {
      const d = new Date(raw)
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ error: 'Invalid interviewAt' })
        return
      }
      patch.interviewAt = d.toISOString()
    }
  }
  if (hasNotes) {
    const n = body.interviewNotes
    patch.interviewNotes = n === null || n === '' ? null : typeof n === 'string' ? n : null
  }
  res.json(await updateJobInterviewForUser(getUserId(req), id, patch))
})

router.delete('/:id', async (req: Request, res: Response) => {
  res.json(await deleteJobForUser(getUserId(req), String(req.params.id)))
})

router.delete('/', async (req: Request, res: Response) => {
  await clearJobsForUser(getUserId(req))
  res.json({ ok: true })
})

router.get('/analytics/series', async (req: Request, res: Response) => {
  const requesterId = getUserId(req)
  const fromRaw = String(req.query.from ?? '')
  const from = new Date(fromRaw)
  const safeFrom = Number.isNaN(from.getTime()) ? new Date(0) : from
  const toRaw = String(req.query.to ?? '')
  const toParsed = new Date(toRaw)
  const safeTo = toRaw && !Number.isNaN(toParsed.getTime()) ? toParsed : null
  const city = String(req.query.city ?? '').trim()
  const cityFilter = city.length > 0 ? city : undefined

  const rawTarget = String(req.query.targetUserId ?? '')
  if (rawTarget === 'all' && (await isAdmin(requesterId))) {
    res.json(await analyticsAllUsersSeries(safeFrom, cityFilter, safeTo))
    return
  }
  const userId =
    rawTarget && rawTarget !== requesterId && (await isAdmin(requesterId)) ? rawTarget : requesterId
  res.json(await analyticsByUser(userId, safeFrom, cityFilter, safeTo))
})

router.get('/analytics/users', async (req: Request, res: Response) => {
  const userId = getUserId(req)
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: 'Admin only' })
    return
  }
  const fromRaw = String(req.query.from ?? '')
  const from = new Date(fromRaw)
  const safeFrom = Number.isNaN(from.getTime()) ? new Date(0) : from
  const toRaw = String(req.query.to ?? '')
  const to = new Date(toRaw)
  const safeTo = Number.isNaN(to.getTime()) ? null : to
  res.json(await analyticsAllUsers(safeFrom, safeTo))
})

router.get('/analytics/cities', async (req: Request, res: Response) => {
  const requesterId = getUserId(req)
  const fromRaw = String(req.query.from ?? '')
  const from = new Date(fromRaw)
  const safeFrom = Number.isNaN(from.getTime()) ? new Date(0) : from

  const rawTarget = String(req.query.targetUserId ?? '')
  if (rawTarget === 'all' && (await isAdmin(requesterId))) {
    res.json(await analyticsCitiesAllUsers(safeFrom))
    return
  }
  const userId =
    rawTarget && rawTarget !== requesterId && (await isAdmin(requesterId)) ? rawTarget : requesterId
  res.json(await analyticsCitiesByUser(userId, safeFrom))
})

router.get('/analytics/platforms', async (req: Request, res: Response) => {
  const requesterId = getUserId(req)
  const fromRaw = String(req.query.from ?? '')
  const from = new Date(fromRaw)
  const safeFrom = Number.isNaN(from.getTime()) ? new Date(0) : from

  const rawTarget = String(req.query.targetUserId ?? '')
  if (rawTarget === 'all' && (await isAdmin(requesterId))) {
    res.json(await analyticsPlatformsAllUsers(safeFrom))
    return
  }
  const userId =
    rawTarget && rawTarget !== requesterId && (await isAdmin(requesterId)) ? rawTarget : requesterId
  res.json(await analyticsPlatformsByUser(userId, safeFrom))
})

export default router
