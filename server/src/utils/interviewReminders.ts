import { supabase } from './supabase'
import { sendMailViaSmtp } from './smtpSubmit'
import { buildInterviewReminderMail } from './interviewReminderMail'
import { getTomorrowInterviewReminderWindow } from './interviewReminderSchedule'
import type { Job } from '../scrapers/types'

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM)
}

const STATUS_LABEL: Record<Job['status'], string> = {
  new: 'New',
  applied: 'Applied',
  hr_interview: 'HR Interview',
  technical_interview: 'Technical Interview',
  second_technical_interview: 'Second Technical Interview',
  refused: 'Refused',
  ghosted: 'Ghosted',
  accepted: 'Accepted',
}

/** Interview stages only — accepted/refused are excluded (no further meetings; no reminders). */
const PIPELINE_INTERVIEW: Job['status'][] = ['hr_interview', 'technical_interview', 'second_technical_interview']

export async function sendInterviewReminderEmails(): Promise<void> {
  if (!smtpConfigured()) return

  const now = new Date()
  const { start: windowStart, end: windowEnd } = getTomorrowInterviewReminderWindow(now)

  const { data: rows, error } = await supabase
    .from('jobs')
    .select('id, user_id, title, company, location, url, platform, status, interview_at, interview_notes')
    .in('status', PIPELINE_INTERVIEW)
    .gte('interview_at', windowStart.toISOString())
    .lte('interview_at', windowEnd.toISOString())
    .is('interview_reminder_sent_at', null)

  if (error || !rows?.length) {
    if (error) console.error('[interview-reminders] query failed:', error.message)
    return
  }

  const userIds = [...new Set(rows.map((r) => r.user_id as string))]
  const { data: users } = await supabase
    .from('users')
    .select('id, email, email_interview_reminders')
    .in('id', userIds)
    .eq('status', 'active')

  const emailByUser = new Map(
    (users ?? [])
      .filter((u) => u.email_interview_reminders !== false)
      .map((u) => [u.id as string, u.email as string]),
  )

  const host = String(process.env.SMTP_HOST).trim()
  const port = Number(process.env.SMTP_PORT ?? '587')
  const from = String(process.env.SMTP_FROM).trim()
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS?.trim()

  for (const row of rows) {
    const userId = row.user_id as string
    const to = emailByUser.get(userId)
    if (!to) continue

    const status = row.status as Job['status']
    const stage = STATUS_LABEL[status] ?? status
    const platform = row.platform as Job['platform']
    const mail = buildInterviewReminderMail({
      title: row.title as string,
      company: row.company as string,
      location: (row.location as string) ?? '',
      url: row.url as string,
      platform,
      stageLabel: stage,
      interviewAtIso: (row.interview_at as string | null) ?? null,
      notesRaw: row.interview_notes as string | null,
      isTest: false,
    })

    try {
      await sendMailViaSmtp({
        host,
        port,
        user,
        pass,
        from,
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      })
      await supabase
        .from('jobs')
        .update({ interview_reminder_sent_at: new Date().toISOString() })
        .eq('id', row.id as string)
        .eq('user_id', userId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[interview-reminders] send failed:', msg)
    }
  }
}
