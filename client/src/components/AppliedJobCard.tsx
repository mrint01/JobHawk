import { MapPin, Building2, ExternalLink, RotateCcw, Clock, CalendarCheck, Trash2 } from 'lucide-react'
import type { Job } from '../types'
import PlatformBadge from './PlatformBadge'
import { useApp } from '../context/AppContext'
import { formatGermanDate, formatPostedTime } from '../time'

interface Props { job: Job }

export default function AppliedJobCard({ job }: Props) {
  const { markUnapplied, deleteJob } = useApp()

  const postedAgo = formatPostedTime(job.postedDate) || 'time unavailable'

  const appliedDate = (() => {
    try {
      return job.appliedAt ? formatGermanDate(job.appliedAt) ?? '' : ''
    } catch {
      return ''
    }
  })()

  return (
    <div className="card h-full flex flex-col p-4 sm:p-5 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 hover:border-emerald-300 dark:hover:border-emerald-500/40 transition-all duration-200 group animate-slide-up">
      {/* Applied badge + platform */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="badge bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 max-w-[70%] sm:max-w-none">
          <CalendarCheck className="w-3 h-3" />
          <span className="truncate">Applied {appliedDate}</span>
        </span>
        <PlatformBadge platform={job.platform} />
      </div>

      {/* Title & company */}
      <h3 className="min-h-[2.75rem] font-semibold text-gray-900 dark:text-white text-base leading-snug line-clamp-2 break-words mb-1">
        {job.title}
      </h3>
      <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 mb-3 min-w-0">
        <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="line-clamp-1 break-words">{job.company}</span>
      </div>

      {/* Meta */}
      <div className="flex flex-col gap-1.5 text-xs text-gray-400 dark:text-slate-500 mb-4">
        <span className="flex items-start gap-1.5 min-w-0">
          <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="break-words leading-relaxed">{job.location}</span>
        </span>

        <span className="flex items-start gap-1.5 min-w-0">
          <Building2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="break-words leading-relaxed capitalize text-gray-500 dark:text-slate-400">
            {job.jobType || 'not specified'}
          </span>
        </span>

        <span className="flex items-start gap-1.5 min-w-0">
          <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="break-words leading-relaxed">{postedAgo}</span>
        </span>
      </div>

      {/* Actions */}
      <div className="mt-auto flex flex-col items-stretch gap-2 pt-3 border-t border-gray-100 dark:border-slate-700/60">
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost w-full justify-center"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View Job
        </a>
        <button
          onClick={() => markUnapplied(job.id)}
          className="btn-secondary w-full justify-center hover:!text-amber-600 dark:hover:!text-amber-400"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Unapply
        </button>
        <button onClick={() => deleteJob(job.id)} className="btn-danger w-full justify-center border border-red-200 dark:border-red-500/30">
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </button>
      </div>
    </div>
  )
}
