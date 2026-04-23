import { useState, useEffect, useMemo } from 'react'
import {
  Search, Trash2, UserX, UserCheck, ChevronLeft, ChevronRight,
  Users, BarChart2, Calendar, ShieldCheck, Filter,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import {
  fetchUsersApi, deleteUserApi, setUserStatusApi,
  fetchAnalyticsUsersApi, type AuthUser,
} from '../services/api'

type Period = '7d' | '30d' | 'custom'
type AnalyticsUser = { userId: string; username: string; appliedCount: number }

const PAGE_SIZE = 10

function fromDateForPeriod(period: Period, customFrom: string): string {
  if (period === '7d') { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString() }
  if (period === '30d') { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString() }
  return customFrom ? new Date(customFrom).toISOString() : new Date(0).toISOString()
}

function toDateForPeriod(period: Period, customTo: string): string | undefined {
  if (period === 'custom' && customTo) {
    const d = new Date(customTo)
    d.setHours(23, 59, 59, 999)
    return d.toISOString()
  }
  return undefined
}

function Pagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void
}) {
  const pages = Math.ceil(total / pageSize)
  if (pages <= 1) return null
  const range: number[] = []
  const delta = 2
  for (let i = Math.max(1, page - delta); i <= Math.min(pages, page + delta); i++) range.push(i)

  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <button disabled={page === 1} onClick={() => onChange(page - 1)}
        className="btn-ghost p-1.5 disabled:opacity-30 disabled:cursor-not-allowed">
        <ChevronLeft className="w-4 h-4" />
      </button>
      {range[0] > 1 && <><button onClick={() => onChange(1)} className="w-8 h-8 rounded-lg text-sm btn-ghost">1</button>{range[0] > 2 && <span className="text-gray-400 px-1">…</span>}</>}
      {range.map(p => (
        <button key={p} onClick={() => onChange(p)}
          className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${p === page ? 'bg-blue-500 text-white' : 'btn-ghost'}`}>
          {p}
        </button>
      ))}
      {range[range.length - 1] < pages && <><span className="text-gray-400 px-1">…</span><button onClick={() => onChange(pages)} className="w-8 h-8 rounded-lg text-sm btn-ghost">{pages}</button></>}
      <button disabled={page === pages} onClick={() => onChange(page + 1)}
        className="btn-ghost p-1.5 disabled:opacity-30 disabled:cursor-not-allowed">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

export default function AdminPage() {
  const { appState, addToast } = useApp()
  const adminId = appState.userId

  // ── Section 1: Users ─────────────────────────────────────────────────────────
  const [users, setUsers] = useState<AuthUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [userSearch, setUserSearch] = useState('')
  const [userPage, setUserPage] = useState(1)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  async function loadUsers() {
    setUsersLoading(true)
    const data = await fetchUsersApi(adminId)
    setUsers(data)
    setUsersLoading(false)
  }

  useEffect(() => { void loadUsers() }, [])

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    if (!q) return users
    return users.filter(u => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, userSearch])

  const pagedUsers = filteredUsers.slice((userPage - 1) * PAGE_SIZE, userPage * PAGE_SIZE)

  async function handleDeleteUser(id: string, username: string) {
    if (!confirm(`Delete user "${username}"? This will also delete all their jobs.`)) return
    setDeletingId(id)
    const ok = await deleteUserApi(id, adminId)
    setDeletingId(null)
    if (ok) { setUsers(u => u.filter(x => x.id !== id)); addToast(`User "${username}" deleted`, 'success') }
    else addToast('Failed to delete user', 'error')
  }

  async function handleToggleStatus(user: AuthUser) {
    const next = user.status === 'active' ? 'disabled' : 'active'
    setTogglingId(user.id)
    const ok = await setUserStatusApi(user.id, next, adminId)
    setTogglingId(null)
    if (ok) {
      setUsers(u => u.map(x => x.id === user.id ? { ...x, status: next } : x))
      addToast(`User "${user.username}" ${next === 'active' ? 'enabled' : 'disabled'}`, 'success')
    } else addToast('Failed to update user status', 'error')
  }

  // ── Section 2: Applied Analytics ─────────────────────────────────────────────
  const [analytics, setAnalytics] = useState<AnalyticsUser[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('all')
  const [analyticsSearch, setAnalyticsSearch] = useState('')
  const [analyticsPage, setAnalyticsPage] = useState(1)

  async function loadAnalytics() {
    setAnalyticsLoading(true)
    const from = fromDateForPeriod(period, customFrom)
    const to = toDateForPeriod(period, customTo)
    const data = await fetchAnalyticsUsersApi(adminId, from, to)
    setAnalytics(data)
    setAnalyticsLoading(false)
  }

  useEffect(() => {
    if (period === 'custom' && !customFrom) return
    void loadAnalytics()
  }, [period, customFrom, customTo])

  const filteredAnalytics = useMemo(() => {
    let list = selectedUserId === 'all' ? analytics : analytics.filter(a => a.userId === selectedUserId)
    const q = analyticsSearch.trim().toLowerCase()
    if (q) list = list.filter(a => a.username.toLowerCase().includes(q))
    return [...list].sort((a, b) => b.appliedCount - a.appliedCount)
  }, [analytics, selectedUserId, analyticsSearch])

  const pagedAnalytics = filteredAnalytics.slice((analyticsPage - 1) * PAGE_SIZE, analyticsPage * PAGE_SIZE)

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-sm">
          <ShieldCheck className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Admin Panel</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Manage users and view application stats</p>
        </div>
      </div>

      {/* ── Section 1: Users ── */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Users</h2>
            <span className="badge bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
              {users.length}
            </span>
          </div>
          <div className="flex flex-col gap-1 w-full sm:w-64">
            <label className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1">
              <Search className="w-3 h-3" /> Search
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className="input pl-9 text-sm w-full"
                placeholder="Username or email…"
                value={userSearch}
                onChange={e => { setUserSearch(e.target.value); setUserPage(1) }}
              />
            </div>
          </div>
        </div>

        {usersLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <p className="text-sm text-center text-gray-400 py-6">No users found</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-700">
                    <th className="text-left pb-2 pl-1 font-medium text-gray-500 dark:text-slate-400">User</th>
                    <th className="text-left pb-2 font-medium text-gray-500 dark:text-slate-400 hidden sm:table-cell">Email</th>
                    <th className="text-left pb-2 font-medium text-gray-500 dark:text-slate-400">Role</th>
                    <th className="text-left pb-2 font-medium text-gray-500 dark:text-slate-400">Status</th>
                    <th className="text-right pb-2 pr-1 font-medium text-gray-500 dark:text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {pagedUsers.map(user => (
                    <tr key={user.id} className="group hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-2.5 pl-1">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-violet-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                            {user.username.slice(0, 2).toUpperCase()}
                          </div>
                          <span className="font-medium text-gray-900 dark:text-white">{user.username}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-gray-500 dark:text-slate-400 hidden sm:table-cell">{user.email}</td>
                      <td className="py-2.5">
                        <span className={`badge text-xs ${user.role === 'admin' ? 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <span className={`badge text-xs ${user.status === 'active' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400'}`}>
                          {user.status}
                        </span>
                      </td>
                      <td className="py-2.5 pr-1">
                        <div className="flex items-center justify-end gap-1">
                          {user.id !== adminId && (
                            <>
                              <button
                                title={user.status === 'active' ? 'Disable account' : 'Enable account'}
                                disabled={togglingId === user.id}
                                onClick={() => handleToggleStatus(user)}
                                className={`btn-ghost p-1.5 disabled:opacity-50 ${user.status === 'active' ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10' : 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'}`}
                              >
                                {user.status === 'active' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                              </button>
                              <button
                                title="Delete user"
                                disabled={deletingId === user.id}
                                onClick={() => handleDeleteUser(user.id, user.username)}
                                className="btn-ghost p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={userPage} total={filteredUsers.length} pageSize={PAGE_SIZE} onChange={setUserPage} />
          </>
        )}
      </div>

      {/* ── Section 2: Applied Analytics ── */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-violet-500" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Applied Applications</h2>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-end">
          {/* Period dropdown */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Period
            </label>
            <select
              className="input text-sm w-auto"
              value={period}
              onChange={e => { setPeriod(e.target.value as Period); setAnalyticsPage(1) }}
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Custom date inputs */}
          {period === 'custom' && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> From
                </label>
                <input
                  type="date"
                  className="input text-sm w-auto"
                  value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); setAnalyticsPage(1) }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> To
                </label>
                <input
                  type="date"
                  className="input text-sm w-auto"
                  value={customTo}
                  min={customFrom}
                  onChange={e => { setCustomTo(e.target.value); setAnalyticsPage(1) }}
                />
              </div>
            </>
          )}

          {/* User selector */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1">
              <Users className="w-3 h-3" /> User
            </label>
            <select
              className="input text-sm w-auto"
              value={selectedUserId}
              onChange={e => { setSelectedUserId(e.target.value); setAnalyticsPage(1) }}
            >
              <option value="all">All users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
          </div>

          {/* Search */}
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-xs font-medium text-gray-500 dark:text-slate-400 flex items-center gap-1">
              <Search className="w-3 h-3" /> Search username
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className="input pl-9 text-sm w-full"
                placeholder="Filter by username…"
                value={analyticsSearch}
                onChange={e => { setAnalyticsSearch(e.target.value); setAnalyticsPage(1) }}
              />
            </div>
          </div>
        </div>

        {analyticsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : filteredAnalytics.length === 0 ? (
          <p className="text-sm text-center text-gray-400 py-6">No applications in this period</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-700">
                    <th className="text-left pb-2 pl-1 font-medium text-gray-500 dark:text-slate-400 w-10">#</th>
                    <th className="text-left pb-2 font-medium text-gray-500 dark:text-slate-400">Username</th>
                    <th className="text-right pb-2 pr-1 font-medium text-gray-500 dark:text-slate-400">Applied</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {pagedAnalytics.map((row, idx) => {
                    const rank = (analyticsPage - 1) * PAGE_SIZE + idx + 1
                    return (
                      <tr key={row.userId} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="py-2.5 pl-1 text-gray-400 dark:text-slate-500 font-mono text-xs">{rank}</td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 to-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {row.username.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="font-medium text-gray-900 dark:text-white">{row.username}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-1 text-right">
                          <span className="font-semibold text-violet-600 dark:text-violet-400">{row.appliedCount}</span>
                          <span className="text-gray-400 dark:text-slate-500 ml-1 text-xs">jobs</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={analyticsPage} total={filteredAnalytics.length} pageSize={PAGE_SIZE} onChange={setAnalyticsPage} />
          </>
        )}
      </div>
    </div>
  )
}
