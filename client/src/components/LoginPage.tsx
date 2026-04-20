import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Briefcase, AlertCircle } from 'lucide-react'
import { useApp } from '../context/AppContext'

type Mode = 'login' | 'signup'

export default function LoginPage() {
  const { login, signup } = useApp()
  const [mode, setMode] = useState<Mode>('login')
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        const result = await login(usernameOrEmail, password)
        if (!result.ok) setError(result.error ?? 'Invalid credentials')
      } else {
        if (password !== confirmPassword) {
          setError('Passwords do not match')
          return
        }
        const result = await signup(username, email, password)
        if (!result.ok) setError(result.error ?? 'Signup failed')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-400/10 dark:bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-violet-400/10 dark:bg-violet-600/10 rounded-full blur-3xl" />
      </div>
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg shadow-blue-500/30 mb-4">
            <Briefcase className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">JobHawk</h1>
          <p className="text-gray-500 dark:text-slate-400 mt-1 text-sm">Smart job scraper across platforms</p>
        </div>
        <div className="card p-8">
          <h2 className="text-xl font-semibold mb-6 text-gray-900 dark:text-white">{mode === 'login' ? 'Sign in' : 'Sign up'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'login' ? (
              <input className="input" placeholder="Username or email" value={usernameOrEmail} onChange={(e) => setUsernameOrEmail(e.target.value)} required />
            ) : (
              <>
                <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
                <input type="email" className="input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </>
            )}
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} className="input pr-12" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" onClick={() => setShowPass((s) => !s)} tabIndex={-1}>
                {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {mode === 'signup' && (
              <input type="password" className="input" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            )}
            {error && <div className="flex items-center gap-2 text-red-500 text-sm"><AlertCircle className="w-4 h-4" />{error}</div>}
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <button
            type="button"
            onClick={() => { setMode((m) => m === 'login' ? 'signup' : 'login'); setError('') }}
            className="mt-5 w-full rounded-xl border border-blue-200/80 dark:border-blue-500/30 bg-gradient-to-r from-blue-50 to-violet-50 dark:from-blue-500/10 dark:to-violet-500/10 px-4 py-2.5 text-sm font-semibold text-blue-700 dark:text-blue-300 hover:from-blue-100 hover:to-violet-100 dark:hover:from-blue-500/20 dark:hover:to-violet-500/20 hover:shadow-md hover:shadow-blue-500/10 transition-all duration-200"
          >
            {mode === 'login' ? 'No account? Sign up' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
