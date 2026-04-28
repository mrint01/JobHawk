import { CheckCircle, XCircle, Loader2, Clock } from 'lucide-react'
import type { ScrapeProgress, PlatformProgress, Platform } from '../types'

const PLATFORM_META: Record<Platform, { label: string; bg: string }> = {
  linkedin:  { label: 'LinkedIn',  bg: 'bg-[#0077B5]' },
  stepstone: { label: 'StepStone', bg: 'bg-[#F58220]' },
  xing:      { label: 'Xing',      bg: 'bg-[#00B67A]' },
  indeed:    { label: 'Indeed',    bg: 'bg-[#2164f3]' },
  jobriver:  { label: 'Jobriver',  bg: 'bg-[#6d28d9]' },
}

function PlatformRow({ p }: { p: PlatformProgress }) {
  const meta = PLATFORM_META[p.platform]

  const icon =
    p.status === 'done'    ? <CheckCircle className="w-4 h-4 text-emerald-500 dark:text-emerald-400" /> :
    p.status === 'error'   ? <XCircle     className="w-4 h-4 text-red-500 dark:text-red-400" /> :
    p.status === 'running' ? <Loader2     className="w-4 h-4 text-gray-400 dark:text-slate-400 animate-spin" /> :
    <span className="w-4 h-4 rounded-full bg-gray-200 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 inline-block" />

  return (
    <div className="flex items-center gap-3">
      {icon}
      <span className="text-sm text-gray-700 dark:text-slate-300 w-24 flex-shrink-0">{meta.label}</span>
      <div className="flex-1 h-2 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 relative overflow-hidden ${meta.bg}`}
          style={{ width: `${p.progress}%` }}
        >
          {p.status === 'running' && <div className="absolute inset-0 progress-shimmer" />}
        </div>
      </div>
      <span className="text-xs text-gray-400 dark:text-slate-500 w-8 text-right">{p.progress}%</span>
      {p.status === 'done' && p.jobsFound > 0 && (
        <span className="text-xs text-emerald-600 dark:text-emerald-400 w-16 text-right">
          {p.jobsFound} found
        </span>
      )}
    </div>
  )
}

export default function ProgressTracker({ progress }: { progress: ScrapeProgress }) {
  const activePlatforms = progress.platforms.filter((p) => p.status !== 'idle')

  return (
    <div className="card p-6 animate-slide-up">
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {progress.isRunning ? 'Scraping in progress…' : 'Scraping complete!'}
          </span>
          <div className="flex items-center gap-3 text-sm">
            {progress.isRunning && progress.estimatedSecondsLeft > 0 && (
              <span className="flex items-center gap-1.5 text-gray-400 dark:text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                ~{progress.estimatedSecondsLeft}s left
              </span>
            )}
            <span className="font-bold text-gray-900 dark:text-white tabular-nums">{progress.overall}%</span>
          </div>
        </div>

        <div className="h-3 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-600 transition-all duration-300 relative overflow-hidden"
            style={{ width: `${progress.overall}%` }}
          >
            {progress.isRunning && <div className="absolute inset-0 progress-shimmer" />}
          </div>
        </div>
      </div>

      {activePlatforms.length > 0 && (
        <div className="space-y-3">
          {activePlatforms.map((p) => <PlatformRow key={p.platform} p={p} />)}
        </div>
      )}
    </div>
  )
}
