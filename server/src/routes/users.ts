import { Router, type Request, type Response } from 'express'
import { authenticateUser, changeUserPassword, createUser, readUsers } from '../utils/userStore'

const router = Router()

router.post('/login', (req: Request, res: Response) => {
  const usernameOrEmail = typeof req.body?.usernameOrEmail === 'string' ? req.body.usernameOrEmail : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const user = authenticateUser(usernameOrEmail, password)
  if (!user) {
    res.status(401).json({ ok: false, error: 'Invalid credentials' })
    return
  }
  res.json({
    ok: true,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  })
})

router.post('/signup', (req: Request, res: Response) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : ''
  const email = typeof req.body?.email === 'string' ? req.body.email : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const result = createUser(username, email, password)
  if (!result.ok) {
    res.status(400).json(result)
    return
  }
  res.json({
    ok: true,
    user: {
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      role: result.user.role,
    },
  })
})

router.get('/', (_req: Request, res: Response) => {
  const users = readUsers().map((u) => ({ id: u.id, username: u.username, email: u.email, role: u.role }))
  res.json(users)
})

router.post('/password', (req: Request, res: Response) => {
  const userId = String(req.header('x-user-id') || '')
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
  const nextPassword = typeof req.body?.nextPassword === 'string' ? req.body.nextPassword : ''
  if (!userId || !currentPassword.trim() || !nextPassword.trim()) {
    res.status(400).json({ ok: false, error: 'Missing required fields' })
    return
  }
  const ok = changeUserPassword(userId, currentPassword, nextPassword)
  if (!ok) {
    res.status(400).json({ ok: false, error: 'Current password is incorrect' })
    return
  }
  res.json({ ok: true })
})

export default router
