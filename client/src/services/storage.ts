import type { AppState } from '../types'

const STATE_KEY = 'jobhawk_state'

const DEFAULT_STATE: AppState = {
  isLoggedIn: false,
  theme: 'dark',
  password: 'admin',
  linkedinConnected: false,
  stepstonConnected: false,
  xingConnected: false,
}

export function getAppState(): AppState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>
      return { ...DEFAULT_STATE, ...parsed }
    }
  } catch {}
  return { ...DEFAULT_STATE }
}

export function saveAppState(state: AppState): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(state))
}
