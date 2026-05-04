import { useEffect, useMemo, useState } from 'react'
import {
  Search,
  CalendarRange,
  Clock3,
  Video,
  StickyNote,
  Sparkles,
  ExternalLink,
  Pencil,
  X,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import type { Job, JobStatus, Platform } from '../types'
import { formatGermanDateTime } from '../time'

const STATUS_OPTIONS: Array<{ value: JobStatus; label: string }> = [
  { value: 'applied', label: 'Applied' },
  { value: 'hr_interview', label: 'HR Interview' },
  { value: 'technical_interview', label: 'Technical Interview' },
  { value: 'second_technical_interview', label: 'Second Technical Interview' },
  { value: 'refused', label: 'Refused' },
  { value: 'accepted', label: 'Accepted' },
]

const STATUS_META: Record<JobStatus, { label: string; tone: string }> = {
  new: { label: 'New', tone: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300' },
  applied: { label: 'Applied', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  hr_interview: { label: 'HR Interview', tone: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
  technical_interview: { label: 'Technical Interview', tone: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' },
  second_technical_interview: { label: 'Second Technical Interview', tone: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  refused: { label: 'Refused', tone: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  accepted: { label: 'Accepted', tone: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' },
}

function dateOf(job: Job): number {
  const raw = job.appliedAt ?? job.postedDate
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? 0 : t
}

function toDatetimeLocalValue(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function parseInterviewNotes(raw?: string): { meetUrl: string; details: string } {
  if (!raw?.trim()) return { meetUrl: '', details: '' }
  try {
    const j = JSON.parse(raw) as { meetUrl?: unknown; details?: unknown }
    if (j && typeof j === 'object') {
      return { meetUrl: String(j.meetUrl ?? ''), details: String(j.details ?? '') }
    }
  } catch {
    return { meetUrl: '', details: raw.trim() }
  }
  return { meetUrl: '', details: '' }
}

function serializeInterviewNotes(meetUrl: string, details: string): string | null {
  const m = meetUrl.trim()
  const d = details.trim()
  if (!m && !d) return null
  return JSON.stringify({ meetUrl: m, details: d })
}

function canonicalNotesPayload(raw?: string): string {
  const p = parseInterviewNotes(raw)
  return serializeInterviewNotes(p.meetUrl, p.details) ?? ''
}

/** Accepted / refused: no further interviews; reminders are not sent for these (server uses same rule). */
function isTerminalPipelineStatus(status: JobStatus): boolean {
  return status === 'accepted' || status === 'refused'
}

function interviewTimelineCopy(interviewAt: string | undefined, stageLabel: string): { when: string | null; line: string } {
  if (!interviewAt) {
    return {
      when: null,
      line: `No interview date yet — add one for your ${stageLabel}.`,
    }
  }
  const t = new Date(interviewAt).getTime()
  if (Number.isNaN(t)) return { when: null, line: 'Invalid interview date.' }
  const when = formatGermanDateTime(interviewAt)
  const ms = t - Date.now()
  if (ms <= 0) {
    return { when, line: `Your ${stageLabel} time has passed.` }
  }
  const hours = ms / 3_600_000
  const days = Math.floor(ms / 86_400_000)
  let remaining: string
  if (hours < 24) {
    if (hours <= 1) remaining = 'Less than 1 hour remaining'
    else remaining = `${Math.ceil(hours)} hours remaining`
  } else {
    remaining = `${days} day${days === 1 ? '' : 's'} remaining`
  }
  return {
    when,
    line: `${remaining} until your ${stageLabel}.`,
  }
}

function InterviewTimelineCell({ job }: { job: Job }) {
  const { updateJobInterview } = useApp()
  const stageLabel = STATUS_META[job.status].label
  const [localDt, setLocalDt] = useState(() => toDatetimeLocalValue(job.interviewAt))
  const [editingTime, setEditingTime] = useState(false)

  useEffect(() => {
    setLocalDt(toDatetimeLocalValue(job.interviewAt))
  }, [job.interviewAt])

  function commitFromValue(v: string) {
    const trimmed = v.trim()
    if (!trimmed) {
      updateJobInterview(job.id, { interviewAt: null })
      return
    }
    const d = new Date(trimmed)
    if (Number.isNaN(d.getTime())) return
    updateJobInterview(job.id, { interviewAt: d.toISOString() })
  }

  function applyAndClose() {
    commitFromValue(localDt)
    setEditingTime(false)
  }

  if (isTerminalPipelineStatus(job.status)) {
    const hint = job.status === 'accepted' ? 'Offer accepted.' : 'Declined.'
    return (
      <div className="min-w-[180px] max-w-[340px]">
        <p className="text-xs text-gray-500 dark:text-slate-500 leading-relaxed">{hint}</p>
      </div>
    )
  }

  const { when, line } = interviewTimelineCopy(job.interviewAt, stageLabel)

  return (
    <div className="space-y-2 min-w-[180px] max-w-[340px]">
      <div className="flex items-start gap-2">
        <Clock3 className="w-4 h-4 text-violet-500 dark:text-violet-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          {when && (
            <p className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">{when}</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <p className={`text-xs leading-relaxed flex-1 min-w-[140px] ${when ? 'text-gray-600 dark:text-slate-400' : 'text-gray-500 dark:text-slate-500'}`}>
              {line}
            </p>
            <button
              type="button"
              onClick={() => setEditingTime((v) => !v)}
              className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:border-violet-400 hover:text-violet-600 dark:hover:border-violet-500 dark:hover:text-violet-400 transition-colors shrink-0"
              title={editingTime ? 'Hide editor' : 'Update interview date & time'}
              aria-expanded={editingTime}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
      {editingTime && (
        <div className="rounded-lg border border-gray-200 dark:border-slate-600 bg-gray-50/80 dark:bg-slate-900/50 p-2 space-y-2">
          <input
            type="datetime-local"
            className="input text-xs h-8 py-1 w-full min-w-0"
            value={localDt}
            onChange={(e) => setLocalDt(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary text-xs h-8 px-3" onClick={applyAndClose}>
              Apply
            </button>
            <button
              type="button"
              className="btn-secondary text-xs h-8 px-3"
              onClick={() => {
                setLocalDt('')
                updateJobInterview(job.id, { interviewAt: null })
              }}
            >
              Clear date
            </button>
            <button
              type="button"
              className="btn-ghost text-xs h-8 px-2"
              onClick={() => {
                setLocalDt(toDatetimeLocalValue(job.interviewAt))
                setEditingTime(false)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function InterviewBriefPanel({ job }: { job: Job }) {
  const { updateJobInterview, addToast } = useApp()
  const [open, setOpen] = useState(false)
  const [meetUrl, setMeetUrl] = useState('')
  const [details, setDetails] = useState('')

  const hasBriefingContent = Boolean(canonicalNotesPayload(job.interviewNotes))

  function openModal() {
    const p = parseInterviewNotes(job.interviewNotes)
    setMeetUrl(p.meetUrl)
    setDetails(p.details)
    setOpen(true)
  }

  const dirty =
    canonicalNotesPayload(job.interviewNotes) !== (serializeInterviewNotes(meetUrl, details) ?? '')

  function save() {
    const payload = serializeInterviewNotes(meetUrl, details)
    updateJobInterview(job.id, { interviewNotes: payload })
    addToast('Briefing saved', 'success')
    setOpen(false)
  }

  function closeModal() {
    setOpen(false)
  }

  const meet = meetUrl.trim()

  return (
    <>
      <div className="flex justify-center py-1">
        <button
          type="button"
          onClick={openModal}
          className="relative inline-flex items-center justify-center h-9 w-9 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-violet-600 dark:text-violet-400 shadow-sm hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors"
          title="Interview briefing — meet link & notes"
          aria-label="Open interview briefing"
        >
          <StickyNote className="w-4 h-4" />
          {hasBriefingContent ? (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-800" aria-hidden />
          ) : null}
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`briefing-title-${job.id}`}
          onClick={(e) => e.target === e.currentTarget && closeModal()}
          onKeyDown={(e) => e.key === 'Escape' && closeModal()}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-500 via-blue-500 to-indigo-500" />
            <button
              type="button"
              onClick={closeModal}
              className="absolute right-3 top-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 z-10"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-6 pt-8 space-y-4 max-h-[85vh] overflow-y-auto">
              <div className="flex items-start gap-3 pr-8">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/15 to-indigo-500/15 border border-violet-500/25">
                  <Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </span>
                <div className="min-w-0">
                  <h2 id={`briefing-title-${job.id}`} className="text-base font-semibold text-gray-900 dark:text-white">
                    Interview briefing
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">{job.title}</p>
                </div>
              </div>

              <label className="block">
                <span className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5">
                  <Video className="w-3.5 h-3.5" /> Meet link
                </span>
                <input
                  type="text"
                  className="input text-sm font-mono placeholder:text-gray-400"
                  placeholder="https://meet.google.com/…"
                  value={meetUrl}
                  onChange={(e) => setMeetUrl(e.target.value)}
                />
              </label>

              {meet ? (
                <a
                  href={meet}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open meeting
                </a>
              ) : null}

              <label className="block">
                <span className="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-slate-400 mb-1.5">
                  <StickyNote className="w-3.5 h-3.5" /> Notes
                </span>
                <textarea
                  className="input text-sm min-h-[100px] py-2 resize-y placeholder:text-gray-400 dark:placeholder:text-slate-500"
                  placeholder="Agenda, interviewer names, prep checklist…"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  rows={4}
                />
              </label>

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary text-sm" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!dirty}
                  onClick={() => save()}
                  className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  title={!dirty ? 'No changes to save' : undefined}
                >
                  Save briefing
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function InterviewPipelinePage() {
  const { pipelineJobs, updateJobStatus, isJobsLoading } = useApp()
  const [query, setQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState<'all' | Platform>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortOrder, setSortOrder] = useState<'date_desc' | 'date_asc'>('date_desc')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = pipelineJobs.filter((job) => {
      const platformOk = platformFilter === 'all' ? true : job.platform === platformFilter
      const statusOk = statusFilter === 'all' ? true : job.status === statusFilter
      const searchOk = q.length === 0
        ? true
        : [job.title, job.company, job.location, job.platform].join(' ').toLowerCase().includes(q)
      return platformOk && statusOk && searchOk
    })

    if (dateFrom || dateTo) {
      const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
      const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY
      rows = rows.filter((job) => {
        const t = dateOf(job)
        return t >= fromTs && t <= toTs
      })
    }

    const dir = sortOrder === 'date_desc' ? -1 : 1
    return [...rows].sort((a, b) => (dateOf(a) - dateOf(b)) * dir)
  }, [pipelineJobs, query, platformFilter, statusFilter, dateFrom, dateTo, sortOrder])

  const acceptedCount = filtered.filter((j) => j.status === 'accepted').length
  const refusedCount = filtered.filter((j) => j.status === 'refused').length
  const hrCount = filtered.filter((j) => j.status === 'hr_interview').length

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Interview Pipeline</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Track every application after the Applied stage.</p>
        </div>
        <span className="badge bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30">
          <CalendarRange className="w-3 h-3" />
          {filtered.length} tracked jobs
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <p className="text-xs text-gray-500 dark:text-slate-400">HR Interview</p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-300 mt-1">{hrCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 dark:text-slate-400">Accepted</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-300 mt-1">{acceptedCount}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 dark:text-slate-400">Refused</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-300 mt-1">{refusedCount}</p>
        </div>
      </div>

      <div className="card p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <label className="xl:col-span-2">
            <span className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Search</span>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="input text-sm h-9 py-1.5 pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by role, company, location..."
              />
            </div>
          </label>

          <label>
            <span className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Platform</span>
            <select className="input text-sm h-9 py-1.5" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value as 'all' | Platform)}>
              <option value="all">All platforms</option>
              <option value="linkedin">LinkedIn</option>
              <option value="stepstone">StepStone</option>
              <option value="xing">Xing</option>
              <option value="indeed">Indeed</option>
              <option value="jobriver">Jobriver</option>
            </select>
          </label>

          <label>
            <span className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Status</span>
            <select className="input text-sm h-9 py-1.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | JobStatus)}>
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
            </select>
          </label>

          <label>
            <span className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Date sort</span>
            <select className="input text-sm h-9 py-1.5" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'date_desc' | 'date_asc')}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label>
            <span className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Applied date from</span>
            <input type="date" className="input text-sm h-9 py-1.5" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            <span className="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Applied date to</span>
            <input type="date" className="input text-sm h-9 py-1.5" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="btn-secondary h-9"
              onClick={() => {
                setQuery('')
                setPlatformFilter('all')
                setStatusFilter('all')
                setDateFrom('')
                setDateTo('')
                setSortOrder('date_desc')
              }}
            >
              Reset filters
            </button>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800/70 border-b border-gray-200 dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-slate-300 align-bottom">Role</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-slate-300 align-bottom">Platform</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-slate-300 whitespace-nowrap align-bottom">Applied</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-slate-300 align-bottom">Interview timeline</th>
                <th className="text-center px-2 py-3 font-semibold text-gray-600 dark:text-slate-300 align-bottom">Briefing</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-slate-300 align-bottom">Status</th>
              </tr>
            </thead>
            <tbody>
              {isJobsLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400 dark:text-slate-500">Loading tracking data...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
                    No tracked jobs yet. Move a job from Applied using &quot;Move to HR Interview&quot;.
                  </td>
                </tr>
              ) : (
                filtered.map((job) => (
                  <tr key={job.id} className="border-b border-gray-100 dark:border-slate-800 last:border-0 align-top">
                    <td className="px-4 py-3 align-top min-w-[320px] md:min-w-[400px] lg:min-w-[440px] max-w-xl lg:max-w-2xl">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-900 dark:text-white hover:underline block leading-snug break-words"
                      >
                        {job.title}
                      </a>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5 break-words">{job.company} — {job.location || 'Unknown'}</p>
                    </td>
                    <td className="px-4 py-3 capitalize text-gray-600 dark:text-slate-300">{job.platform}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300 whitespace-nowrap">
                      {job.appliedAt ? (formatGermanDateTime(job.appliedAt) ?? 'Unknown') : 'Unknown'}
                    </td>
                    <td className="px-4 py-3">
                      <InterviewTimelineCell job={job} />
                    </td>
                    <td className="px-2 py-3 align-top text-center w-[72px]">
                      <InterviewBriefPanel job={job} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge border border-transparent min-w-[140px] justify-center text-center ${STATUS_META[job.status].tone}`}>
                          {STATUS_META[job.status].label}
                        </span>
                        <select
                          className="input text-xs h-8 py-1 px-2 flex-1 min-w-[160px] max-w-[200px]"
                          value={job.status}
                          onChange={(e) => updateJobStatus(job.id, e.target.value as JobStatus)}
                        >
                          {STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                        </select>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
