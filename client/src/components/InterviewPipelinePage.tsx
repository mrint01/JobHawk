import { useMemo, useState } from 'react'
import { Search, CalendarRange, Clock3 } from 'lucide-react'
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

function daysSinceApplied(appliedAt?: string): number | null {
  if (!appliedAt) return null
  const ts = new Date(appliedAt).getTime()
  if (Number.isNaN(ts)) return null
  return Math.max(0, Math.floor((Date.now() - ts) / 86_400_000))
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
          <table className="min-w-full text-sm table-fixed">
            <colgroup>
              <col />
              <col className="w-[120px]" />
              <col className="w-[220px]" />
              <col className="w-[190px]" />
              <col className="w-[340px]" />
            </colgroup>
            <thead className="bg-gray-50 dark:bg-slate-800/70 border-b border-gray-200 dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-slate-300">Role</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-slate-300">Platform</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-slate-300">Applied Date</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-slate-300">Follow-up Cue</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-slate-300">Status</th>
              </tr>
            </thead>
            <tbody>
              {isJobsLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-400 dark:text-slate-500">Loading tracking data...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
                    No tracked jobs yet. Move a job from Applied using "Move to HR Interview".
                  </td>
                </tr>
              ) : (
                filtered.map((job) => {
                  const days = daysSinceApplied(job.appliedAt)
                  return (
                    <tr key={job.id} className="border-b border-gray-100 dark:border-slate-800 last:border-0">
                      <td className="px-4 py-3 align-top">
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-gray-900 dark:text-white hover:underline"
                        >
                          {job.title}
                        </a>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{job.company} - {job.location || 'Unknown'}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="capitalize text-gray-600 dark:text-slate-300">{job.platform}</span>
                      </td>
                      <td className="px-4 py-3 align-top text-gray-600 dark:text-slate-300">
                        <span className="inline-block whitespace-nowrap">
                          {job.appliedAt ? (formatGermanDateTime(job.appliedAt) ?? 'Unknown') : 'Unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-slate-400">
                          <Clock3 className="w-3.5 h-3.5" />
                          {days === null
                            ? 'No date'
                            : days >= 10
                              ? 'Follow-up recommended'
                              : `${days} day${days === 1 ? '' : 's'} since applying`}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-2">
                          <span className={`badge border border-transparent w-[150px] justify-center text-center ${STATUS_META[job.status].tone}`}>
                            {STATUS_META[job.status].label}
                          </span>
                          <select
                            className="input text-xs h-8 py-1 px-2 w-[170px]"
                            value={job.status}
                            onChange={(e) => updateJobStatus(job.id, e.target.value as JobStatus)}
                          >
                            {STATUS_OPTIONS.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                          </select>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
