import { X, FileText } from 'lucide-react'

interface Props {
  title: string
  company: string
  description: string
  onClose: () => void
}

export default function JobDescriptionModal({ title, company, description, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desc-modal-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-2xl shadow-indigo-500/10 overflow-hidden animate-slide-up flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-violet-500 to-indigo-500" />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6 pt-8 border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 border border-blue-500/20 dark:border-violet-500/25 flex-shrink-0">
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </span>
            <div className="min-w-0 flex-1 pr-8">
              <h2 id="desc-modal-title" className="text-base font-semibold text-gray-900 dark:text-white leading-snug">
                {title}
              </h2>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{company}</p>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6">
          <pre className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
            {description}
          </pre>
        </div>
      </div>
    </div>
  )
}
