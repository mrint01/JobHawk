import { useState } from 'react'
import {
  MapPin,
  Building2,
  ExternalLink,
  RotateCcw,
  Clock,
  CalendarCheck,
  Trash2,
  ArrowRightCircle,
  X,
  CalendarClock,
  FileText,
} from 'lucide-react'
import type { Job } from '../types'
import PlatformBadge from './PlatformBadge'
import { useApp } from '../context/AppContext'
import { formatGermanDate, formatPostedTime } from '../time'
import JobDescriptionModal from './JobDescriptionModal'
import CoverLetterButton from './CoverLetterButton'

interface Props { job: Job }

const STATUS_LABEL: Record<Job['status'], string> = {
  new: 'New',
  applied: 'Applied',
  hr_interview: 'HR Interview',
  technical_interview: 'Technical Interview',
  second_technical_interview: 'Second Technical Interview',
  refused: 'Refused',
  accepted: 'Accepted',
}

function toDatetimeLocalValue(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AppliedJobCard({ job }: Props) {
  const { markUnapplied, deleteJob, updateJobStatus, addToast } = useApp()
  const [hrModalOpen, setHrModalOpen] = useState(false)
  const [hrInterviewLocal, setHrInterviewLocal] = useState('')
  const [descOpen, setDescOpen] = useState(false)

  const postedAgo = formatPostedTime(job.postedDate) || 'time unavailable'

  const appliedDate = (() => {
    try {
      return job.appliedAt ? formatGermanDate(job.appliedAt) ?? '' : ''
    } catch {
      return ''
    }
  })()

  function openHrModal() {
    setHrInterviewLocal('')
    setHrModalOpen(true)
  }

  function closeHrModal() {
    setHrModalOpen(false)
  }

  function confirmMoveToHr() {
    const raw = hrInterviewLocal.trim()
    if (raw.length > 0) {
      const d = new Date(raw)
      if (Number.isNaN(d.getTime())) {
        addToast('Enter a valid date and time, or leave the field empty.', 'error')
        return
      }
      updateJobStatus(job.id, 'hr_interview', { interviewAt: d.toISOString() })
    } else {
      updateJobStatus(job.id, 'hr_interview')
    }
    closeHrModal()
  }

  return (
    <>
      <div className="card h-full flex flex-col p-4 sm:p-5 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 hover:border-emerald-300 dark:hover:border-emerald-500/40 transition-all duration-200 group animate-slide-up">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="badge bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 max-w-[70%] sm:max-w-none">
            <CalendarCheck className="w-3 h-3" />
            <span className="truncate">Applied {appliedDate}</span>
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <CoverLetterButton job={job} />
            {job.description && (
              <button
                type="button"
                onClick={() => setDescOpen(true)}
                title="View job description"
                className="p-1 rounded-lg text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
              >
                <FileText className="w-4 h-4" />
              </button>
            )}
            <PlatformBadge platform={job.platform} />
          </div>
        </div>
        <span className="badge mb-3 bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 w-fit">
          Status: {STATUS_LABEL[job.status]}
        </span>

        <h3 className="min-h-[2.75rem] font-semibold text-gray-900 dark:text-white text-base leading-snug line-clamp-2 break-words mb-1">
          {job.title}
        </h3>
        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400 mb-3 min-w-0">
          <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="line-clamp-1 break-words">{job.company}</span>
        </div>

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
          {job.status === 'applied' && (
            <button type="button" onClick={openHrModal} className="btn-primary w-full justify-center">
              <ArrowRightCircle className="w-3.5 h-3.5" />
              Move to HR Interview
            </button>
          )}
          <button
            type="button"
            onClick={() => markUnapplied(job.id)}
            className="btn-secondary w-full justify-center hover:!text-amber-600 dark:hover:!text-amber-400"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Unapply
          </button>
          <button type="button" onClick={() => deleteJob(job.id)} className="btn-danger w-full justify-center border border-red-200 dark:border-red-500/30">
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      </div>

      {descOpen && job.description && (
        <JobDescriptionModal
          title={job.title}
          company={job.company}
          description={job.description}
          onClose={() => setDescOpen(false)}
        />
      )}

      {hrModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hr-modal-title"
          onClick={(e) => e.target === e.currentTarget && closeHrModal()}
          onKeyDown={(e) => e.key === 'Escape' && closeHrModal()}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-2xl shadow-indigo-500/10 overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-violet-500 to-indigo-500" />
            <button
              type="button"
              onClick={closeHrModal}
              className="absolute right-3 top-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-6 pt-8 space-y-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 border border-blue-500/20 dark:border-violet-500/25">
                  <CalendarClock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 id="hr-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">
                    Schedule HR interview?
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    Optionally pick a date and time. You can skip and add it later in the pipeline.
                  </p>
                </div>
              </div>

              <label className="block">
                <span className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5">Interview date &amp; time (optional)</span>
                <input
                  type="datetime-local"
                  className="input w-full"
                  value={hrInterviewLocal}
                  onChange={(e) => setHrInterviewLocal(e.target.value)}
                  max={toDatetimeLocalValue(new Date(Date.now() + 366 * 86400000).toISOString())}
                />
              </label>

              <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
                <button type="button" className="btn-secondary flex-1 justify-center" onClick={closeHrModal}>
                  Cancel
                </button>
                <button type="button" className="btn-primary flex-1 justify-center" onClick={confirmMoveToHr}>
                  Move to HR Interview
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
