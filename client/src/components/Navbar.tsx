import { Menu, Briefcase } from 'lucide-react'
import { useApp } from '../context/AppContext'

export default function Navbar() {
  const { toggleSidebar, newJobs, appliedJobs, pipelineJobs } = useApp()

  return (
    <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/80 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/80">
      <div className="h-16 px-4 sm:px-6 flex items-center gap-4">

        {/* Hamburger — visible on mobile, hidden on md+ (sidebar is always visible) */}
        <button
          onClick={toggleSidebar}
          className="btn-ghost p-2 md:hidden"
          aria-label="Open sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Brand (shown on mobile only — desktop shows it in the sidebar) */}
        <div className="flex items-center gap-2 md:hidden">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
            <Briefcase className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-bold text-gray-900 dark:text-white text-sm">JobHawk</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-500 dark:text-slate-400">
            <span className="text-gray-900 dark:text-white font-semibold">{newJobs.length}</span>
            <span className="hidden sm:inline"> offers</span>
          </span>
          <span className="text-gray-300 dark:text-slate-600">·</span>
          <span className="text-gray-500 dark:text-slate-400">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{appliedJobs.length}</span>
            <span className="hidden sm:inline"> applied</span>
          </span>
          <span className="text-gray-300 dark:text-slate-600">·</span>
          <span className="text-gray-500 dark:text-slate-400">
            <span className="text-blue-600 dark:text-blue-400 font-semibold">{pipelineJobs.length}</span>
            <span className="hidden sm:inline"> tracking</span>
          </span>
        </div>
      </div>
    </header>
  )
}
