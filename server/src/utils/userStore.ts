import bcrypt from 'bcryptjs'
import { supabase } from './supabase'

export type UserRole = 'admin' | 'user'
export type UserStatus = 'active' | 'disabled'

export interface UserRecord {
  id: string
  username: string
  email: string
  password_hash: string
  role: UserRole
  status: UserStatus
  created_at: string
}

export async function seedAdminIfNeeded(): Promise<void> {
  const { data } = await supabase.from('users').select('id').eq('username', 'admin').maybeSingle()
  if (data) return
  const password_hash = await bcrypt.hash('admin', 10)
  const { error } = await supabase.from('users').insert({
    username: 'admin',
    email: 'admin@jobhawk.local',
    password_hash,
    role: 'admin',
    status: 'active',
  })
  if (error) console.error('[seed] Failed to create admin:', error.message)
  else console.log('[seed] admin user created')
}

export async function authenticateUser(login: string, password: string): Promise<UserRecord | null> {
  const normalized = login.trim().toLowerCase()
  const { data } = await supabase
    .from('users')
    .select('*')
    .or(`username.ilike.${normalized},email.eq.${normalized}`)
    .eq('status', 'active')
    .maybeSingle()
  if (!data) return null
  const match = await bcrypt.compare(password, data.password_hash)
  return match ? (data as UserRecord) : null
}

export async function createUser(
  username: string,
  email: string,
  password: string,
): Promise<{ ok: true; user: UserRecord } | { ok: false; error: string }> {
  const cleanUsername = username.trim()
  const cleanEmail = email.trim().toLowerCase()
  const cleanPassword = password.trim()
  if (!cleanUsername || !cleanEmail || !cleanPassword) return { ok: false, error: 'All fields are required.' }

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .or(`username.ilike.${cleanUsername},email.eq.${cleanEmail}`)
    .limit(1)
  if (existing && existing.length > 0) return { ok: false, error: 'Username or email already exists.' }

  const password_hash = await bcrypt.hash(cleanPassword, 10)
  const { data, error } = await supabase
    .from('users')
    .insert({ username: cleanUsername, email: cleanEmail, password_hash, role: 'user', status: 'active' })
    .select()
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'Failed to create user.' }
  return { ok: true, user: data as UserRecord }
}

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  nextPassword: string,
): Promise<boolean> {
  const { data } = await supabase.from('users').select('password_hash').eq('id', userId).single()
  if (!data) return false
  const match = await bcrypt.compare(currentPassword, data.password_hash)
  if (!match) return false
  const password_hash = await bcrypt.hash(nextPassword.trim(), 10)
  const { error } = await supabase.from('users').update({ password_hash }).eq('id', userId)
  return !error
}

export async function readUsers(): Promise<UserRecord[]> {
  const { data } = await supabase.from('users').select('id, username, email, role, status, created_at').order('created_at')
  return (data ?? []) as UserRecord[]
}

export async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await supabase.from('users').select('role').eq('id', userId).eq('status', 'active').maybeSingle()
  return data?.role === 'admin'
}

export async function deleteUser(id: string): Promise<void> {
  await supabase.from('users').delete().eq('id', id)
}

export async function setUserStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
  await supabase.from('users').update({ status }).eq('id', id)
}

// Resolved once on startup — maps legacy 'admin' string to the real UUID in Supabase
let _adminUUID = ''

export async function loadAdminUUID(): Promise<void> {
  const { data } = await supabase.from('users').select('id').eq('username', 'admin').maybeSingle()
  if (data?.id) _adminUUID = data.id
}

export function resolveUserId(raw: string): string {
  if (raw === 'admin') return _adminUUID || raw
  return raw
}
