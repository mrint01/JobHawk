import fs from 'fs'
import path from 'path'
import { nanoid } from './nanoid'

export type UserRole = 'admin' | 'user'

export interface UserRecord {
  id: string
  username: string
  email: string
  password: string
  role: UserRole
  createdAt: string
}

const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const USERS_FILE = path.join(DATA_DIR, 'users.json')

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function seedUsers(): UserRecord[] {
  const now = new Date().toISOString()
  return [{
    id: 'admin',
    username: 'admin',
    email: 'admin@jobhawk.local',
    password: 'admin',
    role: 'admin',
    createdAt: now,
  }]
}

function writeUsers(users: UserRecord[]): void {
  ensureDir()
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8')
}

export function readUsers(): UserRecord[] {
  try {
    ensureDir()
    if (!fs.existsSync(USERS_FILE)) {
      const seeded = seedUsers()
      writeUsers(seeded)
      return seeded
    }
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) as UserRecord[]
    if (parsed.length === 0) {
      const seeded = seedUsers()
      writeUsers(seeded)
      return seeded
    }
    return parsed
  } catch {
    return seedUsers()
  }
}

export function authenticateUser(login: string, password: string): UserRecord | null {
  const normalized = login.trim().toLowerCase()
  return readUsers().find((u) => (
    (u.username.toLowerCase() === normalized || u.email.toLowerCase() === normalized) &&
    u.password === password
  )) ?? null
}

export function createUser(username: string, email: string, password: string): { ok: true; user: UserRecord } | { ok: false; error: string } {
  const cleanUsername = username.trim()
  const cleanEmail = email.trim().toLowerCase()
  const cleanPassword = password.trim()
  if (!cleanUsername || !cleanEmail || !cleanPassword) return { ok: false, error: 'All fields are required.' }

  const users = readUsers()
  const exists = users.some((u) => u.username.toLowerCase() === cleanUsername.toLowerCase() || u.email.toLowerCase() === cleanEmail)
  if (exists) return { ok: false, error: 'Username or email already exists.' }

  const user: UserRecord = {
    id: nanoid(),
    username: cleanUsername,
    email: cleanEmail,
    password: cleanPassword,
    role: 'user',
    createdAt: new Date().toISOString(),
  }
  users.push(user)
  writeUsers(users)
  return { ok: true, user }
}

export function changeUserPassword(userId: string, currentPassword: string, nextPassword: string): boolean {
  const users = readUsers()
  const idx = users.findIndex((u) => u.id === userId)
  if (idx === -1) return false
  if (users[idx].password !== currentPassword) return false
  users[idx] = { ...users[idx], password: nextPassword.trim() }
  writeUsers(users)
  return true
}
