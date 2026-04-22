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
import { isAdmin, resolveUserId } from '../utils/userStore'

const router = Router()

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
  res.json(await markAppliedForUser(getUserId(req), String(req.params.id)))
})

router.patch('/:id/unapply', async (req: Request, res: Response) => {
  res.json(await markUnappliedForUser(getUserId(req), String(req.params.id)))
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

  const rawTarget = String(req.query.targetUserId ?? '')
  if (rawTarget === 'all' && (await isAdmin(requesterId))) {
    res.json(await analyticsAllUsersSeries(safeFrom))
    return
  }
  const userId =
    rawTarget && rawTarget !== requesterId && (await isAdmin(requesterId)) ? rawTarget : requesterId
  res.json(await analyticsByUser(userId, safeFrom))
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
  res.json(await analyticsAllUsers(safeFrom))
})

export default router
