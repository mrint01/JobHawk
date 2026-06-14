import { useState } from 'react'
import { MapPin, Building2, ExternalLink, CheckCheck, Clock, Trash2, Loader2, FileText, MessageSquarePlus, Copy, Check, X } from 'lucide-react'
import type { Job } from '../types'
import PlatformBadge from './PlatformBadge'
import { useApp } from '../context/AppContext'
import { formatPostedTime } from '../time'
import JobDescriptionModal from './JobDescriptionModal'
import CoverLetterButton from './CoverLetterButton'

interface Props { job: Job }

function inferField(title: string): string {
  const t = title.toLowerCase()
  if (/data\s*(engineer|scientist|analyst|science)/.test(t)) return 'data engineering and analytics'
  if (/machine learning|ml |ai |artificial intelligence|deep learning/.test(t)) return 'AI and machine learning'
  if (/devops|site reliability|platform engineer|cloud|infrastructure|sre/.test(t)) return 'cloud and infrastructure'
  if (/frontend|front.?end|ui |ux |react|angular|vue/.test(t)) return 'frontend development'
  if (/mobile|ios|android|react native/.test(t)) return 'mobile development'
  if (/backend|back.?end|java|spring|python|node/.test(t)) return 'backend engineering'
  if (/full.?stack/.test(t)) return 'full-stack development'
  return 'software engineering'
}

function generateLinkedInMessage(job: Job): { subject: string; body: string } {
  const field = inferField(job.title)
  const subject = `${job.title} Application — ${job.company}`
  const body = `Hi [First Name],

I just applied to the ${job.title} role at ${job.company} and wanted to reach out directly to express my sincerest enthusiasm.

I'm genuinely excited about the work you're doing in ${field}, and I'm confident this role is an incredible fit for my background in Java, Spring Boot, React, and AWS — 4+ years building scalable backend and full-stack systems across multiple industries.

I'd love the chance to connect briefly and learn more about the team and what you're building.

Thank you in advance for your consideration!

Best,
Hatem Sfar
LinkedIn: https://www.linkedin.com/in/sfar-hatem`
  return { subject, body }
}

function LinkedInMessageModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const { subject, body } = generateLinkedInMessage(job)
  const [copiedSubject, setCopiedSubject] = useState(false)
  const [copiedBody, setCopiedBody] = useState(false)

  function copyText(text: string, which: 'subject' | 'body') {
    navigator.clipboard.writeText(text).then(() => {
      if (which === 'subject') {
        setCopiedSubject(true)
        setTimeout(() => setCopiedSubject(false), 2000)
      } else {
        setCopiedBody(true)
        setTimeout(() => setCopiedBody(false), 2000)
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-sky-400 to-indigo-500" />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6 pt-8 space-y-4 max-h-[85vh] overflow-y-auto">
          <div className="flex items-start gap-3 pr-8">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20">
              <MessageSquarePlus className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">LinkedIn Outreach</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-1">{job.title} — {job.company}</p>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">Subject</span>
              <button
                type="button"
                onClick={() => copyText(subject, 'subject')}
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                {copiedSubject ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedSubject ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 px-3 py-2 text-sm text-gray-800 dark:text-slate-200 font-medium">
              {subject}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">Message</span>
              <button
                type="button"
                onClick={() => copyText(body, 'body')}
                className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                {copiedBody ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedBody ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 px-3 py-2.5 text-sm text-gray-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
              {body}
            </div>
          </div>

          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2">
            Replace <strong>[First Name]</strong> with the recruiter's name before sending.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary text-sm" onClick={onClose}>Close</button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => copyText(`Subject: ${subject}\n\n${body}`, 'body')}
            >
              {copiedBody ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              Copy all
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function JobCard({ job }: Props) {
  const { markApplied, deleteJob } = useApp()
  const [isDeleting, setIsDeleting] = useState(false)
  const [descOpen, setDescOpen] = useState(false)
  const [msgOpen, setMsgOpen] = useState(false)

  const timeAgo = formatPostedTime(job.postedDate) || 'time unavailable'

  async function handleDelete() {
    setIsDeleting(true)
    try { await deleteJob(job.id) } finally { setIsDeleting(false) }
  }

  return (
    <>
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
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <CoverLetterButton job={job} />
          {job.platform === 'linkedin' && (
            <button
              type="button"
              onClick={() => setMsgOpen(true)}
              title="Generate LinkedIn outreach message"
              className="p-1 rounded-lg text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
            >
              <MessageSquarePlus className="w-4 h-4" />
            </button>
          )}
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

      {/* Meta */}
      <div className="flex flex-col gap-1.5 text-xs text-gray-400 dark:text-slate-500 mb-4">
        <span className="flex items-start gap-1.5 min-w-0">
          <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="min-w-0 leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>
            {job.location?.replace(/,(?!\s)/g, ', ')}
          </span>
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
      <div className="mt-auto flex flex-col items-stretch gap-2 pt-3 border-t border-gray-100 dark:border-slate-700">
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary w-full justify-center"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View Job
        </a>
        <button onClick={() => markApplied(job.id)} className="btn-primary w-full justify-center">
          <CheckCheck className="w-3.5 h-3.5" />
          Mark Applied
        </button>
        <button onClick={handleDelete} disabled={isDeleting} className="btn-danger w-full justify-center border border-red-200 dark:border-red-500/30 disabled:opacity-60 disabled:cursor-not-allowed">
          {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          {isDeleting ? 'Deleting…' : 'Delete'}
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
    {msgOpen && <LinkedInMessageModal job={job} onClose={() => setMsgOpen(false)} />}
    </>
  )
}
