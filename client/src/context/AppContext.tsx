import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { Job, ScrapeParams, ScrapeProgress, AppState, Platform, Theme } from '../types'

export type ActivePage = 'dashboard' | 'settings'

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
  type PlatformId,
  type ConnectPayload,
  type ConnectResult,
} from '../services/api'

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

interface AppContextValue {
  // App/auth
  appState: AppState
  login: (username: string, password: string) => boolean
  logout: () => void
  changePassword: (current: string, next: string) => boolean

  // Backend health
  serverOnline: boolean
  authMode: 'manual' | 'headless'

  // Theme
  theme: Theme
  setTheme: (t: Theme) => void

  // Navigation
  activePage: ActivePage
  setActivePage: (p: ActivePage) => void

  // Sidebar
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
  toggleSidebar: () => void

  // Platform connections (delegate to backend)
  connectPlatform: (p: Platform, payload?: ConnectPayload) => Promise<ConnectResult>
  disconnectPlatform: (p: Platform) => Promise<void>
  connectedPlatforms: Platform[]
  platformConnecting: Platform | null

  // Jobs
  jobs: Job[]
  newJobs: Job[]
  appliedJobs: Job[]
  markApplied: (id: string) => void
  markUnapplied: (id: string) => void
  clearJobs: () => void
  clearJobOffers: () => void

  // Scraping
  scrapeProgress: ScrapeProgress | null
  isScraping: boolean
  startScrape: (params: ScrapeParams) => void

  // Toasts
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

  // ---------- Theme ----------
  useEffect(() => {
    const root = document.documentElement
    appState.theme === 'dark'
      ? root.classList.add('dark')
      : root.classList.remove('dark')
  }, [appState.theme])

  useEffect(() => {
    if (getAppState().theme === 'dark') document.documentElement.classList.add('dark')
  }, [])

  useEffect(() => { saveAppState(appState) }, [appState])

  const theme = appState.theme
  const setTheme = useCallback((t: Theme) => setAppState((s) => ({ ...s, theme: t })), [])

  // ---------- Backend health check + job sync ----------
  useEffect(() => {
    let cancelled = false

    async function check() {
      const result = await fetchHealth()
      if (cancelled) return
      setServerOnline(result.online)
      setAuthMode(result.authMode)

      if (result.online) {
        // Sync platform connection state from server sessions
        setAppState((s) => ({
          ...s,
          linkedinConnected: result.connectedPlatforms.includes('linkedin'),
          stepstonConnected: result.connectedPlatforms.includes('stepstone'),
          xingConnected: result.connectedPlatforms.includes('xing'),
        }))

        // Load jobs once — when the server is first reachable
        if (!jobsLoadedRef.current) {
          jobsLoadedRef.current = true
          const serverJobs = await fetchJobsApi()
          if (!cancelled && serverJobs !== null) setJobs(serverJobs)
        }
      }
    }

    check()
    const id = setInterval(check, 10_000)
    return () => { cancelled = true; clearInterval(id) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- Connected platforms ----------
  const connectedPlatforms: Platform[] = [
    ...(appState.linkedinConnected  ? ['linkedin']  as Platform[] : []),
    ...(appState.stepstonConnected  ? ['stepstone'] as Platform[] : []),
    ...(appState.xingConnected      ? ['xing']      as Platform[] : []),
  ]

  const connectPlatform = useCallback(async (p: Platform, payload?: ConnectPayload): Promise<ConnectResult> => {
    setPlatformConnecting(p)
    try {
      const result = await connectPlatformApi(p as PlatformId, payload)
      if (result.ok) {
        setAppState((s) => ({
          ...s,
          linkedinConnected: p === 'linkedin' ? true : s.linkedinConnected,
          stepstonConnected: p === 'stepstone' ? true : s.stepstonConnected,
          xingConnected:     p === 'xing'      ? true : s.xingConnected,
        }))
        const label = p === 'linkedin' ? 'LinkedIn' : p === 'stepstone' ? 'StepStone' : 'Xing'
        addToast(`${label} connected!`, 'success')
        return result
      } else {
        addToast(result.error ?? 'Connection failed', 'error')
        return result
      }
    } finally {
      setPlatformConnecting(null)
    }
  }, [])

  const disconnectPlatform = useCallback(async (p: Platform): Promise<void> => {
    await disconnectPlatformApi(p as PlatformId)
    setAppState((s) => ({
      ...s,
      linkedinConnected: p === 'linkedin' ? false : s.linkedinConnected,
      stepstonConnected: p === 'stepstone' ? false : s.stepstonConnected,
      xingConnected:     p === 'xing'      ? false : s.xingConnected,
    }))
    const label = p === 'linkedin' ? 'LinkedIn' : p === 'stepstone' ? 'StepStone' : 'Xing'
    addToast(`${label} disconnected`, 'info')
  }, [])

  // ---------- Auth ----------
  const newJobs = jobs.filter((j) => j.status === 'new')
  const appliedJobs = jobs.filter((j) => j.status === 'applied')

  const login = useCallback((username: string, password: string): boolean => {
    if (username === 'admin' && password === appState.password) {
      setAppState((s) => ({ ...s, isLoggedIn: true }))
      return true
    }
    return false
  }, [appState.password])

  const logout = useCallback(() => {
    setAppState((s) => ({ ...s, isLoggedIn: false }))
    setSidebarOpen(false)
    setActivePage('dashboard')
  }, [])

  const changePassword = useCallback((current: string, next: string): boolean => {
    if (current !== appState.password) return false
    setAppState((s) => ({ ...s, password: next }))
    return true
  }, [appState.password])

  // ---------- Jobs ----------
  const markApplied = useCallback((id: string) => {
    markJobAppliedApi(id).then((updated) => {
      if (updated.length > 0) setJobs(updated)
    }).catch(() => undefined)
    // Optimistic update
    setJobs((prev) => prev.map((j) =>
      j.id === id ? { ...j, status: 'applied' as const, appliedAt: new Date().toISOString() } : j,
    ))
    addToast('Marked as applied!', 'success')
  }, [])

  const markUnapplied = useCallback((id: string) => {
    markJobUnappliedApi(id).then((updated) => {
      if (updated.length > 0) setJobs(updated)
    }).catch(() => undefined)
    // Optimistic update
    setJobs((prev) => prev.map((j) =>
      j.id === id ? { ...j, status: 'new' as const, appliedAt: undefined } : j,
    ))
    addToast('Moved back to job offers', 'info')
  }, [])

  const clearJobs = useCallback(() => {
    clearJobsApi().catch(() => undefined)
    setJobs([])
    addToast('All job data cleared', 'info')
  }, [])

  const clearJobOffers = useCallback(() => {
    clearJobOffersApi()
      .then((updated) => {
        if (updated !== null) {
          setJobs(updated)
          addToast('Job offers cleared. Applied jobs were kept.', 'success')
        } else {
          addToast('Could not clear offers. Check your connection.', 'error')
        }
      })
      .catch(() => addToast('Could not clear offers.', 'error'))
  }, [])

  // ---------- Scraping ----------
  const isScraping = scrapeProgress?.isRunning ?? false

  const startScrape = useCallback(async (params: ScrapeParams) => {
    if (isScraping) return

    if (!serverOnline) {
      addToast('Backend server is offline. Start it with: npm run dev', 'error')
      return
    }

    const platforms: Platform[] = [
      ...(appState.linkedinConnected  ? ['linkedin']  as Platform[] : []),
      ...(appState.stepstonConnected  ? ['stepstone'] as Platform[] : []),
      ...(appState.xingConnected      ? ['xing']      as Platform[] : []),
    ]

    if (platforms.length === 0) {
      addToast('Connect at least one platform in Settings before scraping', 'error')
      return
    }

    setScrapeProgress({ isRunning: true, overall: 0, estimatedSecondsLeft: 15, platforms: [], startedAt: Date.now() })

    try {
      await scrapeAll(params, platforms, (p) => setScrapeProgress(p))
      // Re-sync sessions (e.g. server clears LinkedIn after invalid cookie / redirect loop)
      const health = await fetchHealth()
      if (health.online) {
        setAppState((s) => ({
          ...s,
          linkedinConnected: health.connectedPlatforms.includes('linkedin'),
          stepstonConnected: health.connectedPlatforms.includes('stepstone'),
          xingConnected: health.connectedPlatforms.includes('xing'),
        }))
      }
      // Server saved jobs during scraping — fetch the updated list
      const updated = await fetchJobsApi()
      if (updated !== null) {
        setJobs(updated)
        const freshCount = updated.filter((j) => j.status === 'new').length
        addToast(`Done! ${freshCount} open offer${freshCount !== 1 ? 's' : ''} found`, 'success')
      } else {
        addToast('Scrape finished but job list could not be refreshed. Check your connection.', 'error')
      }
    } catch {
      addToast('Scraping failed. Please try again.', 'error')
    } finally {
      setScrapeProgress((prev) => prev ? { ...prev, isRunning: false, overall: 100 } : null)
    }
  }, [isScraping, serverOnline, appState.linkedinConnected, appState.stepstonConnected, appState.xingConnected])

  // ---------- Toasts ----------
  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = String(Date.now() + Math.random())
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }, [])

  const removeToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  return (
    <AppContext.Provider value={{
      appState, login, logout, changePassword,
      serverOnline, authMode,
      theme, setTheme,
      activePage, setActivePage,
      sidebarOpen, setSidebarOpen, toggleSidebar,
      connectPlatform, disconnectPlatform, connectedPlatforms, platformConnecting,
      jobs, newJobs, appliedJobs, markApplied, markUnapplied, clearJobs, clearJobOffers,
      scrapeProgress, isScraping, startScrape,
      toasts, addToast, removeToast,
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
