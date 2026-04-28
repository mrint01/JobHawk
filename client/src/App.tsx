import { AppProvider, useApp } from './context/AppContext'
import LoginPage from './components/LoginPage'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import SettingsPage from './components/SettingsPage'
import AnalyticsPage from './components/AnalyticsPage'
import AdminPage from './components/AdminPage'
import InterviewPipelinePage from './components/InterviewPipelinePage'
import ToastContainer from './components/ToastContainer'

function AppShell() {
  const { appState, activePage } = useApp()

  if (!appState.isLoggedIn) {
    return <LoginPage />
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />
        <main className="flex-1 overflow-y-auto pb-24">
          {activePage === 'settings'
            ? <SettingsPage />
            : activePage === 'analytics'
              ? <AnalyticsPage />
              : activePage === 'admin'
                ? <AdminPage />
                : activePage === 'pipeline'
                  ? <InterviewPipelinePage />
                  : <Dashboard />}
        </main>
        <footer className="border-t border-gray-200 dark:border-slate-800 py-3 px-4 text-xs text-center text-gray-500 dark:text-slate-400">
          Copyright © {new Date().getFullYear()} JobHawk
        </footer>
      </div>

      <ToastContainer />
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  )
}
