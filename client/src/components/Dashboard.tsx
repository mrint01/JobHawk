import { useEffect, useMemo, useState } from 'react'
import { Briefcase, CheckSquare, ChevronLeft, ChevronRight, WifiOff, Trash2, ListX } from 'lucide-react'
import type { Platform } from '../types'
import { useApp } from '../context/AppContext'
import { formatGermanDateTime } from '../time'
import ScrapeForm from './ScrapeForm'
import ProgressTracker from './ProgressTracker'
import JobCard from './JobCard'
import AppliedJobCard from './AppliedJobCard'
import EmptyState from './EmptyState'

type Tab = 'offers' | 'applied'
type SortOrder = 'date_desc' | 'date_asc'
const PAGE_SIZE = 9

// ── Platform status pills ─────────────────────────────────────────────────────
const PLATFORM_META: Record<Platform, { label: string; color: string; bg: string }> = {
  linkedin:  { label: 'LinkedIn',  color: 'text-[#0077B5]', bg: 'bg-[#0077B5]/10 border-[#0077B5]/25' },
  stepstone: { label: 'StepStone', color: 'text-[#F58220]', bg: 'bg-[#F58220]/10 border-[#F58220]/25' },
  xing:      { label: 'Xing',      color: 'text-[#00B67A]', bg: 'bg-[#00B67A]/10 border-[#00B67A]/25' },
}

function ConnectionBar() {
  const { appState, setSidebarOpen } = useApp()

  const statuses: { platform: Platform; connected: boolean }[] = [
    { platform: 'linkedin',  connected: appState.linkedinConnected },
    { platform: 'stepstone', connected: appState.stepstonConnected },
    { platform: 'xing',      connected: appState.xingConnected },
  ]

  const anyConnected = statuses.some((s) => s.connected)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {statuses.map(({ platform, connected }) => {
        const m = PLATFORM_META[platform]
        return (
          <span
            key={platform}
            className={`badge border ${connected ? m.bg : 'bg-gray-100 border-gray-200 dark:bg-slate-700/50 dark:border-slate-600'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? m.color.replace('text-', 'bg-') : 'bg-gray-400 dark:bg-slate-500'}`} />
            <span className={connected ? m.color : 'text-gray-400 dark:text-slate-500'}>
              {PLATFORM_META[platform].label}
            </span>
          </span>
        )
      })}

      {!anyConnected && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 hover:underline"
        >
          <WifiOff className="w-3.5 h-3.5" />
          Connect a platform in Settings to start scraping
        </button>
      )}
    </div>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (p: number) => void
}) {
  if (totalPages <= 1) return null

  // Build page array with ellipsis for large counts
  const pages: (number | '…')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('…')
    pages.push(totalPages)
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-8">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        className="btn-ghost px-2 py-1.5 disabled:opacity-30"
        aria-label="Previous page"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`ellipsis-${i}`} className="px-2 py-1.5 text-sm text-gray-400 dark:text-slate-500">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={`min-w-[36px] h-9 rounded-xl text-sm font-medium transition-all duration-150
              ${p === page
                ? 'bg-gradient-to-r from-blue-500 to-violet-600 text-white shadow-sm'
                : 'text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700'
              }`}
          >
            {p}
          </button>
        ),
      )}

      <button
        onClick={() => onPage(page + 1)}
        disabled={page === totalPages}
        className="btn-ghost px-2 py-1.5 disabled:opacity-30"
        aria-label="Next page"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { newJobs, appliedJobs, scrapeProgress, isScraping, clearJobs, clearJobOffers, appState, isJobsLoading } = useApp()
  const [activeTab, setActiveTab] = useState<Tab>('offers')
  const [offersPage, setOffersPage] = useState(1)
  const [appliedPage, setAppliedPage] = useState(1)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmClearOffers, setConfirmClearOffers] = useState(false)

  const [offersPlatformFilter, setOffersPlatformFilter] = useState<'all' | Platform>('all')
  const [offersSortOrder, setOffersSortOrder] = useState<SortOrder>('date_desc')
  const [appliedPlatformFilter, setAppliedPlatformFilter] = useState<'all' | Platform>('all')
  const [appliedSortOrder, setAppliedSortOrder] = useState<SortOrder>('date_desc')
  const [appliedDateFrom, setAppliedDateFrom] = useState('')
  const [appliedDateTo, setAppliedDateTo] = useState('')

  const isAdmin = appState.role === 'admin'

  const getDateRef = (tab: Tab, job: (typeof newJobs)[number]): number => {
    const raw = tab === 'applied' ? (job.appliedAt ?? job.postedDate) : job.postedDate
    const t = new Date(raw).getTime()
    return Number.isNaN(t) ? 0 : t
  }

  const offersFilteredSorted = useMemo(() => {
    const filtered = newJobs.filter((job) =>
      offersPlatformFilter === 'all' ? true : job.platform === offersPlatformFilter,
    )
    const dir = offersSortOrder === 'date_desc' ? -1 : 1
    return [...filtered].sort((a, b) => (getDateRef('offers', a) - getDateRef('offers', b)) * dir)
  }, [newJobs, offersPlatformFilter, offersSortOrder])

  const offersDateRangeLabel = useMemo(() => {
    const fmtValid = (raw: string) => formatGermanDateTime(raw)
    const withValidPosted = offersFilteredSorted
      .map((job) => ({ job, label: fmtValid(job.postedDate) }))
      .filter((x): x is { job: (typeof offersFilteredSorted)[number]; label: string } => x.label !== null)

    if (withValidPosted.length === 0) {
      return 'Latest: unavailable | Oldest: unavailable'
    }

    const byTime = [...withValidPosted].sort(
      (a, b) => new Date(b.job.postedDate).getTime() - new Date(a.job.postedDate).getTime(),
    )
    const latestLabel = byTime[0].label
    const oldestLabel = byTime[byTime.length - 1].label

    return `Latest: ${latestLabel} | Oldest: ${oldestLabel}`
  }, [offersFilteredSorted])

  const appliedFilteredSorted = useMemo(() => {
    let filtered = appliedJobs.filter((job) =>
      appliedPlatformFilter === 'all' ? true : job.platform === appliedPlatformFilter,
    )

    if (appliedDateFrom || appliedDateTo) {
      const fromTs = appliedDateFrom ? new Date(`${appliedDateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
      const toTs = appliedDateTo ? new Date(`${appliedDateTo}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
      filtered = filtered.filter((job) => {
        const t = getDateRef('applied', job)
        return t >= fromTs && t <= toTs
      })
    }

    const dir = appliedSortOrder === 'date_desc' ? -1 : 1
    return [...filtered].sort((a, b) => (getDateRef('applied', a) - getDateRef('applied', b)) * dir)
  }, [appliedJobs, appliedPlatformFilter, appliedSortOrder, appliedDateFrom, appliedDateTo])

  const list = activeTab === 'offers' ? offersFilteredSorted : appliedFilteredSorted
  const page = activeTab === 'offers' ? offersPage : appliedPage
  const setPage = activeTab === 'offers' ? setOffersPage : setAppliedPage

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const displayedJobs = list.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function handleTabChange(tab: Tab) {
    setActiveTab(tab)
  }

  useEffect(() => { setOffersPage(1) }, [offersPlatformFilter, offersSortOrder])
  useEffect(() => { setAppliedPage(1) }, [appliedPlatformFilter, appliedSortOrder, appliedDateFrom, appliedDateTo])

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Job Dashboard</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <ConnectionBar />
          {/* Clear all data — admin only */}
          {isAdmin && (newJobs.length > 0 || appliedJobs.length > 0) && (
            confirmClear ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 dark:text-slate-400">Delete everything (offers + applied)?</span>
                <button
                  onClick={() => { clearJobs(); setConfirmClear(false) }}
                  className="text-xs px-2.5 py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
                >
                  Yes, clear all
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="text-xs px-2.5 py-1 rounded-lg btn-secondary"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border border-gray-200 dark:border-slate-700 transition-all duration-150"
                title="Clear all job data (offers and applied)"
                type="button"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear all data
              </button>
            )
          )}
        </div>
      </div>

      {/* Scrape form */}
      <ScrapeForm />

      {/* Progress tracker */}
      {(isScraping || (scrapeProgress && !scrapeProgress.isRunning && scrapeProgress.overall === 100)) && scrapeProgress && (
        <ProgressTracker progress={scrapeProgress} />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Total Scraped" value={newJobs.length + appliedJobs.length} color="blue" />
        <StatCard label="Open Offers"   value={newJobs.length}                       color="violet" />
        <StatCard label="Applied"       value={appliedJobs.length}                   color="emerald" className="col-span-2 sm:col-span-1" />
      </div>

      {/* Tabs */}
      <div>
        <div className="flex items-center gap-1 border-b border-gray-200 dark:border-slate-800 mb-6">
          <TabButton
            active={activeTab === 'offers'}
            onClick={() => handleTabChange('offers')}
            icon={<Briefcase className="w-4 h-4" />}
            label="Job Offers"
            count={newJobs.length}
          />
          <TabButton
            active={activeTab === 'applied'}
            onClick={() => handleTabChange('applied')}
            icon={<CheckSquare className="w-4 h-4" />}
            label="Applied"
            count={appliedJobs.length}
            countColor="emerald"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Platform</label>
            <select
              className="input text-sm h-9 py-1.5"
              value={activeTab === 'offers' ? offersPlatformFilter : appliedPlatformFilter}
              onChange={(e) => {
                const v = e.target.value as 'all' | Platform
                if (activeTab === 'offers') setOffersPlatformFilter(v)
                else setAppliedPlatformFilter(v)
              }}
            >
              <option value="all">All platforms</option>
              <option value="linkedin">LinkedIn</option>
              <option value="stepstone">StepStone</option>
              <option value="xing">Xing</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Date sort</label>
            <select
              className="input text-sm h-9 py-1.5"
              value={activeTab === 'offers' ? offersSortOrder : appliedSortOrder}
              onChange={(e) => {
                const v = e.target.value as SortOrder
                if (activeTab === 'offers') setOffersSortOrder(v)
                else setAppliedSortOrder(v)
              }}
            >
              <option value="date_desc">Newest first (desc)</option>
              <option value="date_asc">Oldest first (asc)</option>
            </select>
          </div>

          {activeTab === 'applied' && (
            <>
              <div>
                <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Applied date from</label>
                <input
                  type="date"
                  className="input text-sm h-9 py-1.5"
                  value={appliedDateFrom}
                  onChange={(e) => setAppliedDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Applied date to</label>
                <input
                  type="date"
                  className="input text-sm h-9 py-1.5"
                  value={appliedDateTo}
                  onChange={(e) => setAppliedDateTo(e.target.value)}
                />
              </div>
            </>
          )}

          {activeTab === 'offers' && (
            <div className="ml-auto flex items-center gap-3 flex-wrap">
              <p className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">
                {offersDateRangeLabel}
              </p>
              {newJobs.length > 0 && (
                confirmClearOffers ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-gray-500 dark:text-slate-400">Remove all open offers?</span>
                    <button
                      onClick={() => { clearJobOffers(); setConfirmClearOffers(false) }}
                      className="text-xs px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
                    >
                      Yes, clear offers
                    </button>
                    <button
                      onClick={() => setConfirmClearOffers(false)}
                      className="text-xs px-2.5 py-1 rounded-lg btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClearOffers(true)}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-amber-700 dark:text-amber-400/90 hover:bg-amber-50 dark:hover:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 transition-all duration-150"
                    title="Remove all jobs in Job Offers only; Applied tab is unchanged"
                    type="button"
                  >
                    <ListX className="w-3.5 h-3.5" />
                    Clear offers
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {/* Page info */}
        {list.length > 0 && (
          <p className="text-xs text-gray-400 dark:text-slate-500 mb-4">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, list.length)} of {list.length} jobs
          </p>
        )}

        {/* Grid */}
        {isJobsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card p-4 sm:p-5 flex flex-col gap-3 animate-pulse">
                <div className="h-5 bg-gray-100 dark:bg-slate-800 rounded-lg w-3/4" />
                <div className="h-4 bg-gray-100 dark:bg-slate-800 rounded-lg w-1/2" />
                <div className="h-3 bg-gray-100 dark:bg-slate-800 rounded-lg w-2/3 mt-1" />
                <div className="h-3 bg-gray-100 dark:bg-slate-800 rounded-lg w-1/3" />
                <div className="mt-auto pt-3 border-t border-gray-100 dark:border-slate-700 flex flex-col gap-2">
                  <div className="h-8 bg-gray-100 dark:bg-slate-800 rounded-xl" />
                  <div className="h-8 bg-gray-100 dark:bg-slate-800 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : displayedJobs.length === 0 ? (
          activeTab === 'offers' ? (
            <EmptyState
              icon={Briefcase}
              title="No job offers yet"
              description="Enter a job title and location above, then click Scrape Jobs to find opportunities."
            />
          ) : (
            <EmptyState
              icon={CheckSquare}
              title="No applied jobs"
              description="Jobs you mark as applied will appear here so you can track your progress."
            />
          )
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeTab === 'offers'
                ? displayedJobs.map((job) => <JobCard key={job.id} job={job} />)
                : displayedJobs.map((job) => <AppliedJobCard key={job.id} job={job} />)}
            </div>

            <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({
  label, value, color, className = '',
}: {
  label: string; value: number; color: 'blue' | 'violet' | 'emerald'; className?: string
}) {
  const colorMap = { blue: 'text-blue-500', violet: 'text-violet-500', emerald: 'text-emerald-500' }
  return (
    <div className={`card p-4 ${className}`}>
      <div className={`text-2xl font-bold tabular-nums ${colorMap[color]}`}>{value}</div>
      <div className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

function TabButton({
  active, onClick, icon, label, count, countColor = 'blue',
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number; countColor?: 'blue' | 'emerald'
}) {
  const countColors = {
    blue:    active ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'    : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400',
    emerald: active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400',
  }
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all duration-150
        ${active
          ? 'border-blue-500 text-blue-600 dark:text-white'
          : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 hover:border-gray-300 dark:hover:border-slate-600'
        }`}
    >
      {icon}
      {label}
      <span className={`text-xs px-2 py-0.5 rounded-full ${countColors[countColor]}`}>{count}</span>
    </button>
  )
}
