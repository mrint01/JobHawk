import { MapPin, Building2, ExternalLink, CheckCheck, Clock } from 'lucide-react'
import type { Job } from '../types'
import PlatformBadge from './PlatformBadge'
import { useApp } from '../context/AppContext'
import { formatPostedTime } from '../time'

interface Props { job: Job }

export default function JobCard({ job }: Props) {
  const { markApplied } = useApp()

  const timeAgo = formatPostedTime(job.postedDate) || 'time unavailable'

  return (
    <div className="card h-full flex flex-col p-4 sm:p-5 hover:border-gray-300 dark:hover:border-slate-600 transition-all duration-200 group animate-slide-up">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="min-h-[2.75rem] font-semibold text-gray-900 dark:text-white text-base leading-snug line-clamp-2 break-words group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {job.title}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-500 dark:text-slate-400 min-w-0">
            <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="line-clamp-1 break-words">{job.company}</span>
          </div>
        </div>
        <PlatformBadge platform={job.platform} />
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
          <span className="break-words leading-relaxed">{timeAgo}</span>
        </span>
      </div>

      {/* Actions */}
      <div className="mt-auto flex flex-col sm:flex-row items-stretch gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary w-full sm:flex-1 justify-center"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View Job
        </a>
        <button onClick={() => markApplied(job.id)} className="btn-primary w-full sm:flex-1 justify-center">
          <CheckCheck className="w-3.5 h-3.5" />
          Mark Applied
        </button>
      </div>
    </div>
  )
}
