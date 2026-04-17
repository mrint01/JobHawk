import { AppProvider, useApp } from './context/AppContext'
import LoginPage from './components/LoginPage'
import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import SettingsPage from './components/SettingsPage'
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
        <main className="flex-1 overflow-y-auto">
          {activePage === 'settings' ? <SettingsPage /> : <Dashboard />}
        </main>
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
