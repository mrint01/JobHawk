import { useEffect, useRef } from 'react'
import { X, ScrollText, Loader2, Languages } from 'lucide-react'
import type { CoverLetterLanguage } from '../services/api'

interface Props {
  title: string
  company: string
  generating: boolean
  generatingLang: CoverLetterLanguage | null
  onSelect: (language: CoverLetterLanguage) => void
  onClose: () => void
}

const LANG_OPTIONS: Array<{
  id: CoverLetterLanguage
  label: string
  sublabel: string
  flag: string
}> = [
  { id: 'en', label: 'English', sublabel: 'Professional cover letter in English', flag: 'EN' },
  { id: 'de', label: 'Deutsch', sublabel: 'Formelles Anschreiben auf Deutsch', flag: 'DE' },
]

export default function CoverLetterLanguageModal({
  title,
  company,
  generating,
  generatingLang,
  onSelect,
  onClose,
}: Props) {
  const firstBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstBtnRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/55 backdrop-blur-[3px] animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cover-letter-modal-title"
      onClick={(e) => e.target === e.currentTarget && !generating && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && !generating && onClose()}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-2xl shadow-violet-500/15 overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
        <button
          type="button"
          onClick={onClose}
          disabled={generating}
          className="absolute right-3 top-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6 pt-8 space-y-5">
          <div className="flex items-start gap-3 pr-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 border border-emerald-500/25 flex-shrink-0">
              <ScrollText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="cover-letter-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">
                Generate cover letter
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 line-clamp-2">
                {title} · {company}
              </p>
            </div>
          </div>

          {generating ? (
            <div className="flex flex-col items-center gap-3 py-6 rounded-xl bg-gray-50 dark:bg-slate-800/60 border border-gray-100 dark:border-slate-700">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" aria-hidden />
              <p className="text-sm font-medium text-gray-700 dark:text-slate-200 text-center px-4">
                {generatingLang === 'de'
                  ? 'Lese Stellenanzeige und erstelle dein Anschreiben…'
                  : 'Reading the job posting and crafting your cover letter…'}
              </p>
              <p className="text-xs text-gray-400 dark:text-slate-500 text-center px-6">
                This may take up to a minute while we fetch the job description.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                <Languages className="w-3.5 h-3.5" />
                Choose language
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {LANG_OPTIONS.map((opt, idx) => (
                  <button
                    key={opt.id}
                    ref={idx === 0 ? firstBtnRef : undefined}
                    type="button"
                    onClick={() => onSelect(opt.id)}
                    className="group relative flex flex-col items-start gap-1 p-4 rounded-xl border-2 border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800/80 hover:border-emerald-400 dark:hover:border-emerald-500/60 hover:shadow-md hover:shadow-emerald-500/10 transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                  >
                    <span className="text-[10px] font-bold tracking-widest text-emerald-600 dark:text-emerald-400">
                      {opt.flag}
                    </span>
                    <span className="text-base font-semibold text-gray-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors">
                      {opt.label}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-slate-400 leading-snug">
                      {opt.sublabel}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 leading-relaxed">
                Tailored to this role using your CV and the job posting. Saved to your account and downloaded as a PDF.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
