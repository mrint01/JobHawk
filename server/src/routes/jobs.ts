/**
 * Job CRUD API.
 *
 * GET    /api/jobs              — fetch all persisted jobs
 * PATCH  /api/jobs/:id/apply   — mark a job as applied
 * PATCH  /api/jobs/:id/unapply — move a job back to new
 * DELETE /api/jobs              — wipe all jobs (dev/debug)
 */
import { Router, type Request, type Response } from 'express'
import { readJobs, markApplied, markUnapplied, clearJobs, clearNewJobOffers } from '../utils/jobStore'

const router = Router()

router.get('/', (_req: Request, res: Response) => {
  res.json(readJobs())
})

/** DELETE — remove job offers only (status `new`), keep applied */
router.delete('/offers', (_req: Request, res: Response) => {
  res.json(clearNewJobOffers())
})

router.patch('/:id/apply', (req: Request, res: Response) => {
  res.json(markApplied(String(req.params.id)))
})

router.patch('/:id/unapply', (req: Request, res: Response) => {
  res.json(markUnapplied(String(req.params.id)))
})

router.delete('/', (_req: Request, res: Response) => {
  clearJobs()
  res.json({ ok: true })
})

export default router
