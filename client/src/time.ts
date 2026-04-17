import { format } from 'date-fns'

/** German-style numeric date/time: 16.04.2026, 19:55 */
export function formatGermanDateTime(isoDate: string): string | null {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return null
  return format(date, 'dd.MM.yyyy, HH:mm')
}

/** Date only: 16.04.2026 */
export function formatGermanDate(isoDate: string): string | null {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return null
  return format(date, 'dd.MM.yyyy')
}

export function formatPostedTime(isoDate: string): string {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return ''

  const diffMs = Date.now() - date.getTime()
  if (diffMs <= 0) return 'less than 1 minute ago'

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'less than 1 minute ago'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`

  const years = Math.floor(days / 365)
  return `${years} year${years === 1 ? '' : 's'} ago`
}
