/** Local-time window for interviews happening tomorrow (day-before reminders). */
export function getTomorrowInterviewReminderWindow(now: Date): { start: Date; end: Date } {
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const start = new Date(tomorrow)
  start.setHours(7, 0, 0, 0)
  const end = new Date(tomorrow)
  end.setHours(18, 0, 0, 0)
  return { start, end }
}

/** Next run at 10:00 local time (daily interview reminder check). */
export function getNextDailyReminderRunAt(now: Date): Date {
  const next = new Date(now)
  next.setHours(10, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next
}
