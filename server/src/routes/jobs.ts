/**
 * Job CRUD API.
 *
 * GET    /api/jobs              — fetch all persisted jobs
 * PATCH  /api/jobs/:id/apply   — mark a job as applied
 * PATCH  /api/jobs/:id/unapply — move a job back to new
 * DELETE /api/jobs              — wipe all jobs (dev/debug)
 */
import { Router, type Request, type Response } from 'express'
import {
  readJobsForUser,
  markAppliedForUser,
  markUnappliedForUser,
  clearJobsForUser,
  clearNewJobOffersForUser,
  deleteJobForUser,
  analyticsByUser,
  analyticsAllUsers,
  analyticsAllUsersSeries,
} from '../utils/jobStore'
import { readUsers } from '../utils/userStore'

const router = Router()
function getUserId(req: Request): string {
  return String(req.header('x-user-id') || 'admin')
}
function isAdmin(userId: string): boolean {
  return readUsers().some((u) => u.id === userId && u.role === 'admin')
}

router.get('/', (_req: Request, res: Response) => {
  const userId = getUserId(_req)
  res.json(readJobsForUser(userId))
})

/** DELETE — remove job offers only (status `new`), keep applied */
router.delete('/offers', (_req: Request, res: Response) => {
  const userId = getUserId(_req)
  res.json(clearNewJobOffersForUser(userId))
})

router.patch('/:id/apply', (req: Request, res: Response) => {
  const userId = getUserId(req)
  res.json(markAppliedForUser(userId, String(req.params.id)))
})

router.patch('/:id/unapply', (req: Request, res: Response) => {
  const userId = getUserId(req)
  res.json(markUnappliedForUser(userId, String(req.params.id)))
})

router.delete('/:id', (req: Request, res: Response) => {
  const userId = getUserId(req)
  res.json(deleteJobForUser(userId, String(req.params.id)))
})

router.delete('/', (_req: Request, res: Response) => {
  const userId = getUserId(_req)
  clearJobsForUser(userId)
  res.json({ ok: true })
})

router.get('/analytics/series', (req: Request, res: Response) => {
  const requesterId = getUserId(req)
  const fromRaw = String(req.query.from ?? '')
  const from = new Date(fromRaw)
  const safeFrom = Number.isNaN(from.getTime()) ? new Date(0) : from

  const rawTarget = String(req.query.targetUserId ?? '')
  if (rawTarget === 'all' && isAdmin(requesterId)) {
    res.json(analyticsAllUsersSeries(safeFrom))
    return
  }
  const userId = (rawTarget && rawTarget !== requesterId && isAdmin(requesterId)) ? rawTarget : requesterId
  res.json(analyticsByUser(userId, safeFrom))
})

router.get('/analytics/users', (req: Request, res: Response) => {
  const userId = getUserId(req)
  if (!isAdmin(userId)) {
    res.status(403).json({ error: 'Admin only' })
    return
  }
  const fromRaw = String(req.query.from ?? '')
  const from = new Date(fromRaw)
  const safeFrom = Number.isNaN(from.getTime()) ? new Date(0) : from
  res.json(analyticsAllUsers(safeFrom))
})

export default router
