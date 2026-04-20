export type Platform = 'linkedin' | 'stepstone' | 'xing'

export type JobStatus = 'new' | 'applied'

export interface Job {
  id: string
  userId: string
  title: string
  company: string
  location: string
  platform: Platform
  url: string
  postedDate: string
  description?: string
  salary?: string
  jobType?: string
  scrapedAt: string
  status: JobStatus
  appliedAt?: string
}

export interface ScrapedJob {
  id: string
  title: string
  company: string
  location: string
  platform: Platform
  url: string
  postedDate: string // ISO-8601
  description?: string
  jobType?: string
  salary?: string
}

export interface ScrapeRequest {
  jobTitle: string
  location: string
  platforms: Platform[]
}

/** Emitted by a scraper as it progresses — used for SSE streaming */
export interface ScrapeEvent {
  type: 'progress' | 'jobs' | 'error' | 'done'
  platform?: Platform
  progress?: number   // 0-100
  jobs?: ScrapedJob[]
  error?: string
  totalJobs?: number
}

export type ProgressCallback = (event: ScrapeEvent) => void
