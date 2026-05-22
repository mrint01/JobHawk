import { Router, type Request, type Response } from 'express'
import { readJobByIdForUser } from '../utils/jobStore'
import { resolveUserId } from '../utils/userStore'
import {
  generateCoverLetterContent,
  getCoverLetterMode,
  sanitizeCoverLetterFilename,
} from '../utils/coverLetterGenerator'
import { coverLetterTextToPdfBuffer } from '../utils/coverLetterPdf'
import {
  listCoverLettersForJob,
  readCoverLetterById,
  upsertCoverLetter,
  type CoverLetterLanguage,
} from '../utils/coverLetterStore'

const router = Router()

function getUserId(req: Request): string {
  return resolveUserId(String(req.header('x-user-id') || 'admin'))
}

function parseLanguage(raw: unknown): CoverLetterLanguage | null {
  const v = String(raw ?? '').toLowerCase()
  if (v === 'en' || v === 'de') return v
  return null
}

router.get('/job/:jobId', async (req: Request, res: Response) => {
  const userId = getUserId(req)
  const jobId = String(req.params.jobId)
  const job = await readJobByIdForUser(userId, jobId)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  const letters = await listCoverLettersForJob(userId, jobId)
  res.json({ jobId, letters })
})

router.post('/job/:jobId/generate', async (req: Request, res: Response) => {
  const userId = getUserId(req)
  const jobId = String(req.params.jobId)
  const language = parseLanguage(req.body?.language)
  if (!language) {
    res.status(400).json({ error: 'language must be "en" or "de"' })
    return
  }

  const job = await readJobByIdForUser(userId, jobId)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }

  try {
    const content = await generateCoverLetterContent(job, userId, language)
    const filename = sanitizeCoverLetterFilename(job.company, job.title, language)
    const saved = await upsertCoverLetter(userId, jobId, language, content, filename)
    res.json({
      id: saved.id,
      jobId: saved.jobId,
      language: saved.language,
      filename: saved.filename,
      mode: getCoverLetterMode(),
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cover-letter] generate failed:', message)
    const status =
      message.includes('OPENAI_API_KEY') || message.includes('COVER_LETTER_MODE=openai') ? 503 : 500
    res.status(status).json({ error: message })
  }
})

router.get('/:id/download', async (req: Request, res: Response) => {
  const userId = getUserId(req)
  const record = await readCoverLetterById(userId, String(req.params.id))
  if (!record) {
    res.status(404).json({ error: 'Cover letter not found' })
    return
  }
  const pdf = await coverLetterTextToPdfBuffer(record.content, record.language)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${record.filename}"`)
  res.send(pdf)
})

export default router
