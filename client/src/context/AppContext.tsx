import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { Job, JobStatus, ScrapeParams, ScrapeProgress, AppState, Platform, Theme } from '../types'
import { PIPELINE_STATUSES } from '../types'
import { getAppState, saveAppState } from '../services/storage'
import { scrapeAll } from '../services/scrapers'
import {
  fetchHealth,
  connectPlatformApi,
  disconnectPlatformApi,
  fetchJobsApi,
  markJobAppliedApi,
  markJobUnappliedApi,
  updateJobStatusApi,
  clearJobsApi,
  clearJobOffersApi,
  deleteJobApi,
  loginApi,
  signupApi,
  changePasswordApi,
  fetchLinkedInAgentStatus,
  wakeAndCheckLinkedInAgent,
  type PlatformId,
  type ConnectPayload,
  type ConnectResult,
  type LinkedInAgentStatus,
} from '../services/api'

export type ActivePage = 'dashboard' | 'pipeline' | 'settings' | 'analytics' | 'admin'
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
  linkedinAgent: LinkedInAgentStatus
  refreshLinkedInAgent: (forceSessionCheck?: boolean) => Promise<LinkedInAgentStatus>
  setLinkedInEnabled: (enabled: boolean) => void
  jobs: Job[]
  newJobs: Job[]
  appliedJobs: Job[]
  pipelineJobs: Job[]
  markApplied: (id: string) => void
  markUnapplied: (id: string) => void
  updateJobStatus: (id: string, status: JobStatus) => void
  deleteJob: (id: string) => Promise<void>
  clearJobs: () => void
  clearJobOffers: () => void
  isJobsLoading: boolean
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
  const [isJobsLoading, setIsJobsLoading] = useState(true)
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activePage, setActivePage] = useState<ActivePage>('dashboard')
  const [serverOnline, setServerOnline] = useState(false)
  const [authMode, setAuthMode] = useState<'manual' | 'headless'>('manual')
  const [platformConnecting, setPlatformConnecting] = useState<Platform | null>(null)
  const [linkedinAgent, setLinkedinAgent] = useState<LinkedInAgentStatus>({ connected: false, hasSession: false, username: '' })
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
        setAppState((s) => ({
          ...s,
          stepstonConnected: result.connectedPlatforms.includes('stepstone'),
          xingConnected: result.connectedPlatforms.includes('xing'),
          indeedConnected: result.connectedPlatforms.includes('indeed'),
          jobriverConnected: result.connectedPlatforms.includes('jobriver'),
        }))
        if (appState.userId) {
          const agentStatus = await fetchLinkedInAgentStatus(appState.userId)
          if (!cancelled) {
            setLinkedinAgent(agentStatus)
            if (!(agentStatus.connected && agentStatus.hasSession)) {
              setAppState((s) => ({ ...s, linkedinConnected: false }))
            }
          }
        }
        if (!jobsLoadedRef.current && appState.userId) {
          jobsLoadedRef.current = true
          setIsJobsLoading(true)
          const serverJobs = await fetchJobsApi(appState.userId)
          if (!cancelled) {
            if (serverJobs !== null) setJobs(serverJobs)
            setIsJobsLoading(false)
          }
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
    ...(appState.indeedConnected ? ['indeed'] as Platform[] : []),
    ...(appState.jobriverConnected ? ['jobriver'] as Platform[] : []),
  ]
  const newJobs = jobs.filter((j) => j.status === 'new')
  const appliedJobs = jobs.filter((j) => j.status !== 'new')
  const pipelineJobs = jobs.filter((j) => PIPELINE_STATUSES.includes(j.status))
  const isScraping = scrapeProgress?.isRunning ?? false

  const refreshLinkedInAgent = useCallback(async (forceSessionCheck = false): Promise<LinkedInAgentStatus> => {
    if (!appState.userId) {
      const offline = { connected: false, hasSession: false, username: '' }
      setLinkedinAgent(offline)
      return offline
    }
    const status = forceSessionCheck
      ? await wakeAndCheckLinkedInAgent(appState.userId)
      : await fetchLinkedInAgentStatus(appState.userId)
    setLinkedinAgent(status)
    if (!(status.connected && status.hasSession)) {
      setAppState((s) => ({ ...s, linkedinConnected: false }))
    }
    return status
  }, [appState.userId])

  const setLinkedInEnabled = useCallback((enabled: boolean) => {
    setAppState((s) => ({ ...s, linkedinConnected: enabled }))
  }, [])

  const login = useCallback(async (usernameOrEmail: string, password: string) => {
    const result = await loginApi(usernameOrEmail, password)
    if (!result.ok || !result.user) return { ok: false, error: result.error ?? 'Login failed' }
    jobsLoadedRef.current = true
    setIsJobsLoading(true)
    setAppState((s) => ({ ...s, isLoggedIn: true, userId: result.user!.id, username: result.user!.username, email: result.user!.email, role: result.user!.role }))
    const serverJobs = await fetchJobsApi(result.user.id)
    if (serverJobs !== null) setJobs(serverJobs)
    setIsJobsLoading(false)
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
    setIsJobsLoading(true)
    setSidebarOpen(false)
    setActivePage('dashboard')
    jobsLoadedRef.current = false
  }, [])

  const changePassword = useCallback(async (current: string, next: string): Promise<boolean> => {
    if (!appState.userId) return false
    return changePasswordApi(appState.userId, current, next)
  }, [appState.userId])

  const platformLabel = useCallback((p: Platform) => {
    if (p === 'linkedin') return 'LinkedIn'
    if (p === 'stepstone') return 'StepStone'
    if (p === 'indeed') return 'Indeed'
    if (p === 'jobriver') return 'Jobriver'
    return 'Xing'
  }, [])

  const connectPlatform = useCallback(async (p: Platform, payload?: ConnectPayload): Promise<ConnectResult> => {
    setPlatformConnecting(p)
    try {
      const result = await connectPlatformApi(p as PlatformId, payload, appState.userId || undefined)
      if (result.ok) {
        setAppState((s) => ({
          ...s,
          linkedinConnected: p === 'linkedin' ? true : s.linkedinConnected,
          stepstonConnected: p === 'stepstone' ? true : s.stepstonConnected,
          xingConnected: p === 'xing' ? true : s.xingConnected,
          indeedConnected: p === 'indeed' ? true : s.indeedConnected,
          jobriverConnected: p === 'jobriver' ? true : s.jobriverConnected,
        }))
        addToast(`${platformLabel(p)} connected!`, 'success')
      } else addToast(result.error ?? 'Connection failed', 'error')
      return result
    } finally { setPlatformConnecting(null) }
  }, [addToast, platformLabel])

  const disconnectPlatform = useCallback(async (p: Platform) => {
    await disconnectPlatformApi(p as PlatformId, appState.userId || undefined)
    setAppState((s) => ({
      ...s,
      linkedinConnected: p === 'linkedin' ? false : s.linkedinConnected,
      stepstonConnected: p === 'stepstone' ? false : s.stepstonConnected,
      xingConnected: p === 'xing' ? false : s.xingConnected,
      indeedConnected: p === 'indeed' ? false : s.indeedConnected,
      jobriverConnected: p === 'jobriver' ? false : s.jobriverConnected,
    }))
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

  const updateJobStatus = useCallback((id: string, status: JobStatus) => {
    if (!appState.userId) return
    updateJobStatusApi(id, status, appState.userId).then((updated) => {
      if (updated.length > 0) setJobs(updated)
    }).catch(() => undefined)
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== id) return j
        const nextAppliedAt =
          status === 'new' ? undefined : (j.appliedAt ?? new Date().toISOString())
        return { ...j, status, appliedAt: nextAppliedAt }
      }),
    )
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
      linkedinAgent, refreshLinkedInAgent, setLinkedInEnabled,
      jobs, newJobs, appliedJobs, pipelineJobs, isJobsLoading, markApplied, markUnapplied, updateJobStatus, deleteJob, clearJobs, clearJobOffers,
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
