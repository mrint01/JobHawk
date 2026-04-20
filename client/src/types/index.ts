export type Platform = 'linkedin' | 'stepstone' | 'xing'

export type JobStatus = 'new' | 'applied'

export type Theme = 'dark' | 'light'

export interface Job {
  id: string
  userId?: string
  title: string
  company: string
  location: string
  platform: Platform
  url: string
  postedDate: string // ISO string
  description?: string
  salary?: string
  jobType?: string
  scrapedAt: string // ISO string
  status: JobStatus
  appliedAt?: string // ISO string
}

export interface ScrapeParams {
  jobTitle: string
  location: string
}

export type PlatformStatus = 'idle' | 'pending' | 'running' | 'done' | 'error'

export interface PlatformProgress {
  platform: Platform
  status: PlatformStatus
  progress: number // 0-100
  jobsFound: number
  error?: string
}

export interface ScrapeProgress {
  isRunning: boolean
  overall: number // 0-100
  estimatedSecondsLeft: number
  platforms: PlatformProgress[]
  startedAt?: number // Date.now()
}

export interface AppState {
  isLoggedIn: boolean
  theme: Theme
  userId: string
  username: string
  email: string
  role: 'admin' | 'user'
  linkedinConnected: boolean
  stepstonConnected: boolean
  xingConnected: boolean
}
