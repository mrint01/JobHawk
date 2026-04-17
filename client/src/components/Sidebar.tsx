import { Briefcase, LayoutDashboard, Settings, LogOut, X } from 'lucide-react'
import type { ActivePage } from '../context/AppContext'
import { useApp } from '../context/AppContext'

export default function Sidebar() {
  const { activePage, setActivePage, logout, sidebarOpen, setSidebarOpen } = useApp()

  function navigate(page: ActivePage) {
    setActivePage(page)
    setSidebarOpen(false)
  }

  return (
    <>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          fixed top-0 left-0 h-full z-40 w-64 flex flex-col
          bg-white border-r border-gray-200
          dark:bg-slate-900 dark:border-slate-700/60
          transition-transform duration-[250ms] ease-out
          md:translate-x-0 md:static md:z-auto
          ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
        `}
      >
        {/* ── Logo + close ── */}
        <div className="flex items-center justify-between px-4 h-16 border-b border-gray-100 dark:border-slate-700/60 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-sm">
              <Briefcase className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-gray-900 dark:text-white">JobRadar</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden btn-ghost p-1.5"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Account ── */}
        <div className="px-4 py-4 border-b border-gray-100 dark:border-slate-700/60 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow">
              AD
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">admin</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 truncate">Administrator</p>
            </div>
          </div>
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          <button
            onClick={() => navigate('dashboard')}
            className={`sidebar-item w-full ${activePage === 'dashboard' ? 'sidebar-item-active' : ''}`}
          >
            <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
            Dashboard
          </button>

          <button
            onClick={() => navigate('settings')}
            className={`sidebar-item w-full ${activePage === 'settings' ? 'sidebar-item-active' : ''}`}
          >
            <Settings className="w-4 h-4 flex-shrink-0" />
            Settings
          </button>
        </nav>

        {/* ── Logout ── */}
        <div className="px-3 pb-4 pt-2 border-t border-gray-100 dark:border-slate-700/60 flex-shrink-0">
          <button
            onClick={logout}
            className="sidebar-item w-full text-red-500 hover:text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-500/10"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
