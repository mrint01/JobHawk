import { useEffect, useState } from 'react'
import {
  Sun, Moon, AlertCircle, Check, KeyRound,
  Unlink, Wifi, Loader2, Eye, EyeOff, WifiOff,
  Download, MonitorCheck,
} from 'lucide-react'
import type { Platform } from '../types'
import { useApp } from '../context/AppContext'
import { getLinkedInAgentDownloadUrl } from '../services/api'

// ── Server offline banner ─────────────────────────────────────────────────────
function ServerBanner() {
  const { serverOnline } = useApp()
  if (serverOnline) return null

  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10">
      <WifiOff className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Backend server is offline</p>
        <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
          Platform connections and scraping require the backend. Start it with:
        </p>
        <code className="block mt-1.5 text-xs bg-amber-100 dark:bg-amber-500/20 text-amber-900 dark:text-amber-200 rounded-lg px-3 py-1.5 font-mono">
          npm run dev
        </code>
      </div>
    </div>
  )
}

// ── Shared section card ───────────────────────────────────────────────────────
function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="card p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  )
}

// ── Appearance ────────────────────────────────────────────────────────────────
function AppearanceSection() {
  const { theme, setTheme } = useApp()

  return (
    <Section title="Appearance" description="Choose how JobHawk looks for you.">
      <div className="grid sm:grid-cols-2 gap-3">
        {/* Light */}
        <button
          onClick={() => setTheme('light')}
          className={`relative flex flex-col items-start gap-3 p-4 rounded-xl border-2 transition-all duration-150 text-left
            ${theme === 'light'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
              : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/50'
            }`}
        >
          <div className="w-full h-16 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden flex flex-col gap-1.5 p-2">
            <div className="h-2 w-3/4 bg-gray-300 rounded-full" />
            <div className="h-2 w-1/2 bg-gray-200 rounded-full" />
            <div className="flex gap-1 mt-0.5">
              <div className="h-4 w-8 bg-blue-400 rounded-md" />
              <div className="h-4 w-8 bg-gray-200 rounded-md" />
            </div>
          </div>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <Sun className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">Light</span>
            </div>
            {theme === 'light' && (
              <span className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-white" />
              </span>
            )}
          </div>
        </button>

        {/* Dark */}
        <button
          onClick={() => setTheme('dark')}
          className={`relative flex flex-col items-start gap-3 p-4 rounded-xl border-2 transition-all duration-150 text-left
            ${theme === 'dark'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
              : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/50'
            }`}
        >
          <div className="w-full h-16 rounded-lg bg-slate-800 border border-slate-700 overflow-hidden flex flex-col gap-1.5 p-2">
            <div className="h-2 w-3/4 bg-slate-500 rounded-full" />
            <div className="h-2 w-1/2 bg-slate-600 rounded-full" />
            <div className="flex gap-1 mt-0.5">
              <div className="h-4 w-8 bg-blue-500 rounded-md" />
              <div className="h-4 w-8 bg-slate-600 rounded-md" />
            </div>
          </div>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <Moon className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">Dark</span>
            </div>
            {theme === 'dark' && (
              <span className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-white" />
              </span>
            )}
          </div>
        </button>
      </div>
    </Section>
  )
}

function SecuritySection() {
  const { changePassword, addToast } = useApp()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    if (next.length < 4) { setError('New password must be at least 4 characters'); return }
    if (next !== confirm) { setError('Passwords do not match'); return }
    const ok = await changePassword(current, next)
    if (!ok) { setError('Current password is incorrect'); return }
    addToast('Password changed successfully!', 'success')
    setSuccess(true)
    setCurrent(''); setNext(''); setConfirm('')
    setTimeout(() => setSuccess(false), 3000)
  }

  return (
    <Section title="Security" description="Update your account password.">
      <form onSubmit={handleSubmit} className="max-w-sm space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5">Current password</label>
          <div className="relative">
            <input type={showCurrent ? 'text' : 'password'} className="input pr-10" placeholder="Enter current password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            <button type="button" onClick={() => setShowCurrent((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5">New password</label>
          <div className="relative">
            <input type={showNext ? 'text' : 'password'} className="input pr-10" placeholder="At least 4 characters" value={next} onChange={(e) => setNext(e.target.value)} required />
            <button type="button" onClick={() => setShowNext((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">
              {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5">Confirm new password</label>
          <input type="password" className="input" placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error && <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-3 py-2.5"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}
        {success && <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl px-3 py-2.5">Password changed successfully!</div>}
        <button type="submit" className="btn-primary"><KeyRound className="w-4 h-4" />Update password</button>
      </form>
    </Section>
  )
}

// ── Platform connections ──────────────────────────────────────────────────────
const PLATFORM_META: Record<
  Platform,
  { label: string; description: string; icon: string; color: string; needsAuth: boolean }
> = {
  linkedin: {
    label: 'LinkedIn',
    description: 'Sign in with your LinkedIn account to scrape job listings',
    icon: 'in',
    color: '#0077B5',
    needsAuth: true,
  },
  stepstone: {
    label: 'StepStone',
    description: 'Sign in with your StepStone account to scrape job listings',
    icon: 'SS',
    color: '#F58220',
    needsAuth: true,
  },
  xing: {
    label: 'Xing',
    description: 'Sign in with your Xing account to scrape job listings',
    icon: 'X',
    color: '#00B67A',
    needsAuth: true,
  },
  indeed: {
    label: 'Indeed',
    description: 'German Indeed — public listings only; no login.',
    icon: 'Id',
    color: '#2164f3',
    needsAuth: false,
  },
  jobriver: {
    label: 'Jobriver',
    description: 'German Jobriver — public listings only; no login.',
    icon: 'JR',
    color: '#6d28d9',
    needsAuth: false,
  },
}

// ── Indeed (opt-in toggle only — no credentials) ─────────────────────────────
function IndeedCard() {
  const {
    appState,
    connectPlatform,
    disconnectPlatform,
    platformConnecting,
    serverOnline,
  } = useApp()
  const meta = PLATFORM_META.indeed
  const connected = appState.indeedConnected
  const isConnecting = platformConnecting === 'indeed'

  return (
    <div className={`p-4 rounded-xl border-2 transition-all duration-150
      ${connected
        ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5'
        : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/40'
      }`}
    >
      <div className="flex items-center gap-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow-sm"
          style={{ backgroundColor: meta.color }}
        >
          {meta.icon}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{meta.label}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">{meta.description}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {connected ? (
            <>
              <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Connected
              </span>
              <button
                type="button"
                onClick={() => disconnectPlatform('indeed')}
                className="btn-secondary text-xs px-3 py-1.5 hover:!text-red-500 dark:hover:!text-red-400 hover:!border-red-300 dark:hover:!border-red-500/30"
              >
                <Unlink className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </>
          ) : isConnecting ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Connecting…
            </span>
          ) : (
            <>
              <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-slate-600" />
                Not connected
              </span>
              <button
                type="button"
                onClick={() => connectPlatform('indeed')}
                disabled={!serverOnline}
                title={!serverOnline ? 'Start the backend server first' : undefined}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white active:scale-95 transition-all duration-150 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: meta.color }}
              >
                <Wifi className="w-3.5 h-3.5" />
                Connect
              </button>
            </>
          )}
        </div>
      </div>
      {!connected && !isConnecting && (
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
          Connect enables Indeed Germany (de.indeed.com) in your scrapes — no password or browser window.
        </p>
      )}
    </div>
  )
}

function JobriverCard() {
  const {
    appState,
    connectPlatform,
    disconnectPlatform,
    platformConnecting,
    serverOnline,
  } = useApp()
  const meta = PLATFORM_META.jobriver
  const connected = appState.jobriverConnected
  const isConnecting = platformConnecting === 'jobriver'

  return (
    <div className={`p-4 rounded-xl border-2 transition-all duration-150
      ${connected
        ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5'
        : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/40'
      }`}
    >
      <div className="flex items-center gap-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-xs flex-shrink-0 shadow-sm"
          style={{ backgroundColor: meta.color }}
        >
          {meta.icon}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{meta.label}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">{meta.description}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {connected ? (
            <>
              <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Connected
              </span>
              <button
                type="button"
                onClick={() => disconnectPlatform('jobriver')}
                className="btn-secondary text-xs px-3 py-1.5 hover:!text-red-500 dark:hover:!text-red-400 hover:!border-red-300 dark:hover:!border-red-500/30"
              >
                <Unlink className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </>
          ) : isConnecting ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Connecting…
            </span>
          ) : (
            <>
              <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-slate-600" />
                Not connected
              </span>
              <button
                type="button"
                onClick={() => connectPlatform('jobriver')}
                disabled={!serverOnline}
                title={!serverOnline ? 'Start the backend server first' : undefined}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white active:scale-95 transition-all duration-150 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: meta.color }}
              >
                <Wifi className="w-3.5 h-3.5" />
                Connect
              </button>
            </>
          )}
        </div>
      </div>
      {!connected && !isConnecting && (
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
          Connect enables Jobriver in your scrapes — no password or browser window.
        </p>
      )}
    </div>
  )
}

// ── LinkedIn Agent Card (local agent required) ────────────────────────────────
function LinkedInAgentCard() {
  const { linkedinAgent, refreshLinkedInAgent, serverOnline, appState, setLinkedInEnabled } = useApp()
  const [checking, setChecking] = useState(false)
  const [connectIssue, setConnectIssue] = useState<'offline' | 'expired' | null>(null)
  const connected = linkedinAgent.connected && linkedinAgent.hasSession
  const selected = appState.linkedinConnected

  async function handleConnectCheck() {
    setChecking(true)
    try {
      const status = await refreshLinkedInAgent(true)
      if (status.connected && status.hasSession) {
        setConnectIssue(null)
        setLinkedInEnabled(true)
      } else if (!status.connected) {
        setConnectIssue('offline')
      } else {
        setConnectIssue('expired')
      }
    } finally {
      setChecking(false)
    }
  }

  function handleDisconnect() {
    setLinkedInEnabled(false)
  }

  return (
    <div className={`p-4 rounded-xl border-2 transition-all duration-150
      ${connected
        ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5'
        : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/40'
      }`}
    >
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm" style={{ backgroundColor: '#0077B5' }}>
          in
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">LinkedIn</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            Runs via a local agent on your machine
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {connected ? (
            <>
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <MonitorCheck className="w-3.5 h-3.5" />
                {linkedinAgent.username ? `@${linkedinAgent.username}` : 'Agent live'}
              </span>
              {selected ? (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="btn-secondary text-xs px-3 py-1.5 hover:!text-red-500 dark:hover:!text-red-400 hover:!border-red-300 dark:hover:!border-red-500/30"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setLinkedInEnabled(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white active:scale-95 transition-all duration-150 shadow-sm"
                  style={{ backgroundColor: '#0077B5' }}
                >
                  <Wifi className="w-3.5 h-3.5" />
                  Connect
                </button>
              )}
            </>
          ) : checking ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Checking…
            </span>
          ) : (
            <button
              type="button"
              onClick={handleConnectCheck}
              disabled={!serverOnline || checking}
              title={!serverOnline ? 'Start the backend server first' : undefined}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white active:scale-95 transition-all duration-150 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#0077B5' }}
            >
              {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
              Connect
            </button>
          )}
        </div>
      </div>

      {connected ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg px-3 py-2">
          <MonitorCheck className="w-3.5 h-3.5 flex-shrink-0" />
          {selected
            ? 'Agent is running locally and LinkedIn is selected for scraping.'
            : 'Agent is running locally. Click Connect to select LinkedIn for scraping.'}
        </div>
      ) : connectIssue ? (
        <div className="mt-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-gradient-to-br from-gray-50 to-white dark:from-slate-900/60 dark:to-slate-800/70 p-3.5">
          <div className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5
            ${connectIssue === 'offline'
              ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
              : connectIssue === 'expired'
                ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'
                : 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
            }`}
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide">Agent Status</p>
              <p className="text-xs mt-0.5 leading-relaxed">
                {connectIssue === 'offline'
                  ? 'LinkedIn agent script is not running. Start it locally, then click Connect again.'
                  : 'Script is running, but the LinkedIn session is expired. Restart the script and complete login.'}
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <p className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Quick Setup</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold text-white" style={{ backgroundColor: '#0077B5' }}>1</span>
                <span>Download the LinkedIn agent script.</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold text-white" style={{ backgroundColor: '#0077B5' }}>2</span>
                <span>Run <code className="bg-gray-200 dark:bg-slate-700 rounded px-1">python3 linkedin_agent.py</code>.</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold text-white" style={{ backgroundColor: '#0077B5' }}>3</span>
                <span>If prompted, log in to LinkedIn in the opened browser window.</span>
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-2">
            <a
              href={getLinkedInAgentDownloadUrl()}
              download="linkedin_agent.py"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white shadow-sm transition-all duration-150 active:scale-95 flex-shrink-0"
              style={{ backgroundColor: '#0077B5' }}
            >
              <Download className="w-3.5 h-3.5" />
              Download Agent
            </a>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── Standard platform card (StepStone, Xing) ─────────────────────────────────
function PlatformCard({ platform }: { platform: Platform }) {
  const {
    appState,
    connectPlatform,
    disconnectPlatform,
    platformConnecting,
    serverOnline,
    authMode,
  } = useApp()
  const meta = PLATFORM_META[platform]

  const connected =
    platform === 'stepstone' ? appState.stepstonConnected : appState.xingConnected

  const isConnecting = platformConnecting === platform

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [inlineError, setInlineError] = useState('')
  const [formOpen, setFormOpen] = useState(false)

  useEffect(() => {
    setInlineError('')
    setPassword('')
    setFormOpen(false)
  }, [platform, authMode, connected])

  async function handleConnectClick() {
    if (authMode === 'manual') {
      await connectPlatform(platform)
      return
    }
    setFormOpen((v) => !v)
  }

  async function handleLoginSubmit() {
    setInlineError('')
    if (authMode !== 'headless') return
    if (!email.trim() || !password.trim()) {
      setInlineError('Email and password are required.')
      return
    }
    const result = await connectPlatform(platform, { email: email.trim(), password })
    if (!result.ok) {
      setInlineError(result.error ?? 'Connection failed.')
      return
    }
    setFormOpen(false)
  }

  return (
    <div className={`p-4 rounded-xl border-2 transition-all duration-150
      ${connected
        ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5'
        : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/40'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm"
          style={{ backgroundColor: meta.color }}
        >
          {meta.icon}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{meta.label}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">{meta.description}</p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {connected ? (
            <>
              <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Connected
              </span>
              <button
                onClick={() => disconnectPlatform(platform)}
                className="btn-secondary text-xs px-3 py-1.5 hover:!text-red-500 dark:hover:!text-red-400 hover:!border-red-300 dark:hover:!border-red-500/30"
              >
                <Unlink className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </>
          ) : isConnecting ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Connecting…
            </span>
          ) : (
            <>
              <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-gray-400 dark:text-slate-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-slate-600" />
                Not connected
              </span>
              <button
                onClick={handleConnectClick}
                disabled={!serverOnline}
                title={!serverOnline ? 'Start the backend server first' : undefined}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white active:scale-95 transition-all duration-150 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: meta.color }}
              >
                <Wifi className="w-3.5 h-3.5" />
                {authMode === 'manual' ? 'Connect' : formOpen ? 'Hide Form' : 'Connect'}
              </button>
            </>
          )}
        </div>
      </div>

      {!connected && !isConnecting && authMode === 'manual' && (
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">
          Clicking connect opens a browser window for manual sign-in.
        </p>
      )}

      {!connected && authMode === 'headless' && formOpen && (
        <div className="mt-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-900/40 p-3.5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className="input pr-10"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {inlineError && (
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {inlineError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setFormOpen(false); setInlineError('') }}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLoginSubmit}
              disabled={!serverOnline || isConnecting}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white active:scale-95 transition-all duration-150 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: meta.color }}
            >
              {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              {isConnecting ? 'Connecting…' : 'Login'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function PlatformSection() {
  const { connectedPlatforms, authMode } = useApp()

  return (
    <Section
      title="Platform Connections"
      description={
        authMode === 'manual'
          ? `Manual browser login for StepStone/Xing; LinkedIn uses the agent; Indeed and Jobriver are one-click. ${connectedPlatforms.length} enabled.`
          : `Headless login for StepStone/Xing; Indeed and Jobriver stay one-click. ${connectedPlatforms.length} enabled.`
      }
    >
      <div className="space-y-3">
        <LinkedInAgentCard />
        <IndeedCard />
        <JobriverCard />
        <PlatformCard platform="stepstone" />
        <PlatformCard platform="xing" />
      </div>
    </Section>
  )
}

// ── Settings Page ─────────────────────────────────────────────────────────────
export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
          Manage your preferences and platform connections
        </p>
      </div>

      <ServerBanner />
      <AppearanceSection />
      <SecuritySection />
      <PlatformSection />
    </div>
  )
}
