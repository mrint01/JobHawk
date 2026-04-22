import { Router, type Request, type Response } from 'express'
import {
  authenticateUser,
  changeUserPassword,
  createUser,
  readUsers,
  isAdmin,
  deleteUser,
  setUserStatus,
  resolveUserId,
} from '../utils/userStore'

const router = Router()

function getRequesterId(req: Request): string {
  return resolveUserId(String(req.header('x-user-id') || ''))
}

router.post('/login', async (req: Request, res: Response) => {
  const usernameOrEmail = typeof req.body?.usernameOrEmail === 'string' ? req.body.usernameOrEmail : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const user = await authenticateUser(usernameOrEmail, password)
  if (!user) {
    res.status(401).json({ ok: false, error: 'Invalid credentials' })
    return
  }
  res.json({
    ok: true,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  })
})

router.post('/signup', async (req: Request, res: Response) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : ''
  const email = typeof req.body?.email === 'string' ? req.body.email : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const result = await createUser(username, email, password)
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

router.get('/', async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req)
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ error: 'Admin only' })
    return
  }
  const users = await readUsers()
  res.json(users.map((u) => ({ id: u.id, username: u.username, email: u.email, role: u.role, status: u.status })))
})

router.post('/password', async (req: Request, res: Response) => {
  const userId = resolveUserId(String(req.header('x-user-id') || ''))
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
  const nextPassword = typeof req.body?.nextPassword === 'string' ? req.body.nextPassword : ''
  if (!userId || !currentPassword.trim() || !nextPassword.trim()) {
    res.status(400).json({ ok: false, error: 'Missing required fields' })
    return
  }
  const ok = await changeUserPassword(userId, currentPassword, nextPassword)
  if (!ok) {
    res.status(400).json({ ok: false, error: 'Current password is incorrect' })
    return
  }
  res.json({ ok: true })
})

router.delete('/:id', async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req)
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ ok: false, error: 'Admin only' })
    return
  }
  const targetId = String(req.params.id)
  if (targetId === requesterId) {
    res.status(400).json({ ok: false, error: 'Cannot delete your own account' })
    return
  }
  await deleteUser(targetId)
  res.json({ ok: true })
})

router.patch('/:id/status', async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req)
  if (!(await isAdmin(requesterId))) {
    res.status(403).json({ ok: false, error: 'Admin only' })
    return
  }
  const targetId = String(req.params.id)
  if (targetId === requesterId) {
    res.status(400).json({ ok: false, error: 'Cannot change your own status' })
    return
  }
  const status = req.body?.status === 'active' ? 'active' : 'disabled'
  await setUserStatus(targetId, status)
  res.json({ ok: true })
})

export default router
