import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { Job, ScrapeParams, ScrapeProgress, AppState, Platform, Theme } from '../types'
import { getAppState, saveAppState } from '../services/storage'
import { scrapeAll } from '../services/scrapers'
import {
  fetchHealth,
  connectPlatformApi,
  disconnectPlatformApi,
  fetchJobsApi,
  markJobAppliedApi,
  markJobUnappliedApi,
  clearJobsApi,
  clearJobOffersApi,
  deleteJobApi,
  loginApi,
  signupApi,
  changePasswordApi,
  type PlatformId,
  type ConnectPayload,
  type ConnectResult,
} from '../services/api'

export type ActivePage = 'dashboard' | 'settings' | 'analytics' | 'admin'
export interface Toast { id: string; message: string; type: 'success' | 'error' | 'info' }

interface AppContextValue {
  appState: AppState
  login: (usernameOrEmail: string, password: string) => Promise<{ ok: boolean; error?: string }>
  signup: (username: string, email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => void
  changePassword: (current: string, next: string) => Promise<boolean>
  serverOnline: boolean
  authMode: 'manual' | 'headless'
  theme: Theme
  setTheme: (t: Theme) => void
  activePage: ActivePage
  setActivePage: (p: ActivePage) => void
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
  toggleSidebar: () => void
  connectPlatform: (p: Platform, payload?: ConnectPayload) => Promise<ConnectResult>
  disconnectPlatform: (p: Platform) => Promise<void>
  connectedPlatforms: Platform[]
  platformConnecting: Platform | null
  jobs: Job[]
  newJobs: Job[]
  appliedJobs: Job[]
  markApplied: (id: string) => void
  markUnapplied: (id: string) => void
  deleteJob: (id: string) => Promise<void>
  clearJobs: () => void
  clearJobOffers: () => void
  scrapeProgress: ScrapeProgress | null
  isScraping: boolean
  startScrape: (params: ScrapeParams) => void
  toasts: Toast[]
  addToast: (message: string, type?: Toast['type']) => void
  removeToast: (id: string) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [appState, setAppState] = useState<AppState>(getAppState)
  const [jobs, setJobs] = useState<Job[]>([])
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activePage, setActivePage] = useState<ActivePage>('dashboard')
  const [serverOnline, setServerOnline] = useState(false)
  const [authMode, setAuthMode] = useState<'manual' | 'headless'>('manual')
  const [platformConnecting, setPlatformConnecting] = useState<Platform | null>(null)
  const jobsLoadedRef = useRef(false)

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])

  useEffect(() => { appState.theme === 'dark' ? document.documentElement.classList.add('dark') : document.documentElement.classList.remove('dark') }, [appState.theme])
  useEffect(() => { saveAppState(appState) }, [appState])

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = String(Date.now() + Math.random())
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }, [])
  const removeToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  useEffect(() => {
    let cancelled = false
    async function check() {
      const result = await fetchHealth(appState.isLoggedIn ? appState.userId : undefined)
      if (cancelled) return
      setServerOnline(result.online)
      setAuthMode(result.authMode)
      if (result.online && appState.isLoggedIn) {
        setAppState((s) => ({ ...s, linkedinConnected: result.connectedPlatforms.includes('linkedin'), stepstonConnected: result.connectedPlatforms.includes('stepstone'), xingConnected: result.connectedPlatforms.includes('xing') }))
        if (!jobsLoadedRef.current && appState.userId) {
          jobsLoadedRef.current = true
          const serverJobs = await fetchJobsApi(appState.userId)
          if (!cancelled && serverJobs !== null) setJobs(serverJobs)
        }
      }
    }
    check()
    const id = setInterval(check, 10_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [appState.isLoggedIn, appState.userId])

  const connectedPlatforms: Platform[] = [
    ...(appState.linkedinConnected ? ['linkedin'] as Platform[] : []),
    ...(appState.stepstonConnected ? ['stepstone'] as Platform[] : []),
    ...(appState.xingConnected ? ['xing'] as Platform[] : []),
  ]
  const newJobs = jobs.filter((j) => j.status === 'new')
  const appliedJobs = jobs.filter((j) => j.status === 'applied')
  const isScraping = scrapeProgress?.isRunning ?? false

  const login = useCallback(async (usernameOrEmail: string, password: string) => {
    const result = await loginApi(usernameOrEmail, password)
    if (!result.ok || !result.user) return { ok: false, error: result.error ?? 'Login failed' }
    jobsLoadedRef.current = false
    setAppState((s) => ({ ...s, isLoggedIn: true, userId: result.user!.id, username: result.user!.username, email: result.user!.email, role: result.user!.role }))
    const serverJobs = await fetchJobsApi(result.user.id)
    if (serverJobs !== null) setJobs(serverJobs)
    return { ok: true }
  }, [])

  const signup = useCallback(async (username: string, email: string, password: string) => {
    const result = await signupApi(username, email, password)
    if (!result.ok || !result.user) return { ok: false, error: result.error ?? 'Signup failed' }
    jobsLoadedRef.current = false
    setAppState((s) => ({ ...s, isLoggedIn: true, userId: result.user!.id, username: result.user!.username, email: result.user!.email, role: result.user!.role }))
    setJobs([])
    return { ok: true }
  }, [])

  const logout = useCallback(() => {
    setAppState((s) => ({ ...s, isLoggedIn: false, userId: '', username: '', email: '', role: 'user' }))
    setJobs([])
    setSidebarOpen(false)
    setActivePage('dashboard')
    jobsLoadedRef.current = false
  }, [])

  const changePassword = useCallback(async (current: string, next: string): Promise<boolean> => {
    if (!appState.userId) return false
    return changePasswordApi(appState.userId, current, next)
  }, [appState.userId])

  const connectPlatform = useCallback(async (p: Platform, payload?: ConnectPayload): Promise<ConnectResult> => {
    setPlatformConnecting(p)
    try {
      const result = await connectPlatformApi(p as PlatformId, payload, appState.userId || undefined)
      if (result.ok) {
        setAppState((s) => ({ ...s, linkedinConnected: p === 'linkedin' ? true : s.linkedinConnected, stepstonConnected: p === 'stepstone' ? true : s.stepstonConnected, xingConnected: p === 'xing' ? true : s.xingConnected }))
        addToast(`${p === 'linkedin' ? 'LinkedIn' : p === 'stepstone' ? 'StepStone' : 'Xing'} connected!`, 'success')
      } else addToast(result.error ?? 'Connection failed', 'error')
      return result
    } finally { setPlatformConnecting(null) }
  }, [addToast])

  const disconnectPlatform = useCallback(async (p: Platform) => {
    await disconnectPlatformApi(p as PlatformId, appState.userId || undefined)
    setAppState((s) => ({ ...s, linkedinConnected: p === 'linkedin' ? false : s.linkedinConnected, stepstonConnected: p === 'stepstone' ? false : s.stepstonConnected, xingConnected: p === 'xing' ? false : s.xingConnected }))
  }, [])

  const markApplied = useCallback((id: string) => {
    if (!appState.userId) return
    markJobAppliedApi(id, appState.userId).then((updated) => { if (updated.length > 0) setJobs(updated) }).catch(() => undefined)
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, status: 'applied' as const, appliedAt: new Date().toISOString() } : j))
  }, [appState.userId])

  const markUnapplied = useCallback((id: string) => {
    if (!appState.userId) return
    markJobUnappliedApi(id, appState.userId).then((updated) => { if (updated.length > 0) setJobs(updated) }).catch(() => undefined)
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, status: 'new' as const, appliedAt: undefined } : j))
  }, [appState.userId])

  const deleteJob = useCallback(async (id: string): Promise<void> => {
    if (!appState.userId) return
    const updated = await deleteJobApi(id, appState.userId)
    if (updated !== null) setJobs(updated)
  }, [appState.userId])

  const clearJobs = useCallback(() => {
    if (!appState.userId) return
    clearJobsApi(appState.userId).catch(() => undefined)
    setJobs([])
  }, [appState.userId])

  const clearJobOffers = useCallback(() => {
    if (!appState.userId) return
    clearJobOffersApi(appState.userId).then((updated) => { if (updated !== null) setJobs(updated) }).catch(() => undefined)
  }, [appState.userId])

  const startScrape = useCallback(async (params: ScrapeParams) => {
    if (isScraping || !appState.userId) return
    if (!serverOnline) { addToast('Backend server is offline. Start it with: npm run dev', 'error'); return }
    if (connectedPlatforms.length === 0) { addToast('Connect at least one platform in Settings before scraping', 'error'); return }
    setScrapeProgress({ isRunning: true, overall: 0, estimatedSecondsLeft: 15, platforms: [], startedAt: Date.now() })
    try {
      await scrapeAll(params, connectedPlatforms, appState.userId, (p) => setScrapeProgress(p))
      const updated = await fetchJobsApi(appState.userId)
      if (updated !== null) setJobs(updated)
    } catch {
      addToast('Scraping failed. Please try again.', 'error')
    } finally {
      setScrapeProgress((prev) => prev ? { ...prev, isRunning: false, overall: 100 } : null)
    }
  }, [isScraping, appState.userId, serverOnline, connectedPlatforms, addToast])

  return (
    <AppContext.Provider value={{
      appState, login, signup, logout, changePassword,
      serverOnline, authMode, theme: appState.theme, setTheme: (t) => setAppState((s) => ({ ...s, theme: t })),
      activePage, setActivePage, sidebarOpen, setSidebarOpen, toggleSidebar,
      connectPlatform, disconnectPlatform, connectedPlatforms, platformConnecting,
      jobs, newJobs, appliedJobs, markApplied, markUnapplied, deleteJob, clearJobs, clearJobOffers,
      scrapeProgress, isScraping, startScrape, toasts, addToast, removeToast,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
