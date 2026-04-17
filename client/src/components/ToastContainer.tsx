import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'
import { useApp } from '../context/AppContext'

export default function ToastContainer() {
  const { toasts, removeToast } = useApp()
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      {toasts.map((toast) => {
        const Icon = toast.type === 'success' ? CheckCircle : toast.type === 'error' ? AlertCircle : Info
        const styles = {
          success: 'bg-white dark:bg-slate-800 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
          error:   'bg-white dark:bg-slate-800 border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-300',
          info:    'bg-white dark:bg-slate-800 border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-300',
        }

        return (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg pointer-events-auto animate-slide-up ${styles[toast.type]}`}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm flex-1 text-gray-700 dark:text-slate-200">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
