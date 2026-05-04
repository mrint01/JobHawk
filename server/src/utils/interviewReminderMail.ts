import type { Job } from '../scrapers/types'
import { JOBHAWK_EMAIL_ICON_PNG_BASE64 } from './jobhawkEmailIconBase64'

const PLATFORM_LABEL: Record<Job['platform'], string> = {
  linkedin: 'LinkedIn',
  stepstone: 'StepStone',
  xing: 'Xing',
  indeed: 'Indeed',
  jobriver: 'Jobriver',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function parseNotes(raw?: string | null): { meetUrl: string; details: string } {
  if (!raw?.trim()) return { meetUrl: '', details: '' }
  try {
    const j = JSON.parse(raw) as { meetUrl?: unknown; details?: unknown }
    if (j && typeof j === 'object') {
      return { meetUrl: String(j.meetUrl ?? ''), details: String(j.details ?? '') }
    }
  } catch {
    return { meetUrl: '', details: raw.trim() }
  }
  return { meetUrl: '', details: '' }
}

/** Uses the briefing meet URL exactly as stored (trimmed only). No scheme is prepended — avoids doubled URLs like https://https://…. */
function trimMeetLink(meet: string): string {
  return meet.trim()
}

export interface InterviewReminderInput {
  title: string
  company: string
  location: string
  url: string
  platform: Job['platform']
  stageLabel: string
  interviewAtIso: string | null
  notesRaw?: string | null
  isTest?: boolean
}

export function buildInterviewReminderMail(input: InterviewReminderInput): { subject: string; text: string; html: string } {
  const { meetUrl, details } = parseNotes(input.notesRaw)
  const meet = trimMeetLink(meetUrl)
  const platformName = PLATFORM_LABEL[input.platform] ?? input.platform
  const whenUtc = input.interviewAtIso
    ? new Date(input.interviewAtIso).toUTCString()
    : 'Not scheduled'
  const testPrefix = input.isTest ? '[TEST] ' : ''

  const subject = `${testPrefix}Interview reminder · ${input.title} · ${input.company}`

  const text = [
    input.isTest ? 'This is a manual test send from JobHawk.' : 'Your interview is coming up in about 24 hours.',
    '',
    `Stage: ${input.stageLabel}`,
    `Platform: ${platformName}`,
    `Role: ${input.title}`,
    `Company: ${input.company}`,
    ...(input.location ? [`Location: ${input.location}`] : []),
    `When (UTC): ${whenUtc}`,
    '',
    `Meeting link: ${meet || 'No meeting URL provided'}`,
    details.trim() ? `Meeting notes: ${details.trim()}` : 'Meeting notes: No meeting notes provided',
    '',
    `Job listing: ${input.url}`,
    '',
    '— JobHawk',
  ].join('\n')

  const safeTitle = escapeHtml(input.title)
  const safeCompany = escapeHtml(input.company)
  const safeLocation = input.location ? escapeHtml(input.location) : ''
  const safeStage = escapeHtml(input.stageLabel)
  const safePlatform = escapeHtml(platformName)
  const safeUrl = escapeHtml(input.url)
  const safeWhen = escapeHtml(whenUtc)
  const safeDetails = details.trim() ? escapeHtml(details.trim()).replace(/\r?\n/g, '<br/>') : ''
  const safeMeetForHref = meet ? escapeHtml(meet) : ''

  const headerBrandIcon = `<img src="data:image/png;base64,${JOBHAWK_EMAIL_ICON_PNG_BASE64}" width="48" height="48" alt="JobHawk" style="display:block;margin:0 auto 12px;border-radius:14px;background:rgba(255,255,255,0.95);padding:8px;box-shadow:0 6px 20px rgba(0,0,0,0.18);border:0;width:48px;height:48px;"/>`

  const meetSectionHtml = meet
    ? `<tr><td style="padding:16px 24px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(145deg,#ecfdf5 0%,#d1fae5 100%);border-radius:14px;border:1px solid #6ee7b7;overflow:hidden;">
<tr><td style="padding:14px 18px;">
<div style="font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#047857;margin-bottom:10px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">Meeting URL</div>
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="border-radius:12px;background:#059669;box-shadow:0 3px 12px rgba(5,150,105,0.35);">
<a href="${safeMeetForHref}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">Join meeting &#8594;</a>
</td></tr></table>
<p style="margin:12px 0 0;font-size:11px;color:#065f46;font-family:ui-monospace,Menlo,Monaco,monospace;word-break:break-all;line-height:1.45;">${safeMeetForHref}</p>
</td></tr></table>
</td></tr>`
    : `<tr><td style="padding:16px 24px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:14px;border:1px dashed #cbd5e1;">
<tr><td style="padding:16px 18px;text-align:center;">
<div style="font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">Meeting URL</div>
<p style="margin:0;font-size:13px;color:#94a3b8;font-style:italic;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">No meeting URL provided</p>
</td></tr></table>
</td></tr>`

  const notesSectionHtml = safeDetails
    ? `<tr><td style="padding:14px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,#fffbeb 0%,#fef3c7 100%);border-radius:14px;border:1px solid #fcd34d;"><tr><td style="padding:14px 16px;font-size:13px;color:#78350f;line-height:1.55;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;"><div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#b45309;margin-bottom:8px;">Meeting notes</div>${safeDetails}</td></tr></table></td></tr>`
    : `<tr><td style="padding:14px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:14px;border:1px dashed #cbd5e1;"><tr><td style="padding:16px 18px;text-align:center;"><div style="font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">Meeting notes</div><p style="margin:0;font-size:13px;color:#94a3b8;font-style:italic;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">No meeting notes provided</p></td></tr></table></td></tr>`

  const testBanner = input.isTest
    ? `<tr><td style="padding:10px 24px 12px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border-radius:12px;border:1px solid #fcd34d;"><tr><td style="padding:10px 14px;font-size:13px;color:#92400e;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;"><strong>Test email</strong> — sent manually from Interview Pipeline. Scheduled reminders are unchanged.</td></tr></table></td></tr>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#ececf1;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ececf1;padding:10px 8px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(67,56,202,0.15);">
<tr><td bgcolor="#4f46e5" style="background-color:#4f46e5;padding:18px 22px 16px;text-align:center;">
${headerBrandIcon}
<div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#e0e7ff;font-weight:800;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">JobHawk</div>
<h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:800;line-height:1.25;font-family:Georgia,'Times New Roman',serif;">Interview reminder</h1>
<p style="margin:8px 0 0;color:#ede9fe;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">${input.isTest ? 'Manual test send' : 'About 24 hours to go — stay sharp.'}</p>
</td></tr>
${testBanner}
<tr><td style="padding:16px 24px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="background:#eef2ff;color:#4338ca;font-size:12px;font-weight:700;padding:6px 14px;border-radius:999px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;text-transform:capitalize;">${safePlatform}</td>
<td width="12"></td>
<td style="background:#f1f5f9;color:#334155;font-size:12px;font-weight:700;padding:6px 14px;border-radius:999px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">${safeStage}</td>
</tr></table>
</td></tr>
<tr><td style="padding:12px 24px 0;font-size:20px;font-weight:800;color:#0f172a;line-height:1.3;font-family:Georgia,'Times New Roman',serif;">${safeTitle}</td></tr>
<tr><td style="padding:6px 24px 0;font-size:15px;font-weight:600;color:#475569;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">${safeCompany}</td></tr>
${safeLocation ? `<tr><td style="padding:4px 24px 0;font-size:13px;color:#64748b;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">📍 ${safeLocation}</td></tr>` : ''}
<tr><td style="padding:20px 24px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,#faf5ff 0%,#f5f3ff 100%);border-radius:14px;border:1px solid #ddd6fe;">
<tr><td style="padding:16px 18px;">
<div style="font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#7c3aed;margin-bottom:6px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">Interview time (UTC)</div>
<div style="font-size:17px;font-weight:700;color:#1e1b4b;font-family:ui-monospace,Menlo,Monaco,monospace;">${safeWhen}</div>
</td></tr></table>
</td></tr>
${meetSectionHtml}
${notesSectionHtml}
<tr><td style="padding:22px 24px 8px;text-align:center;">
<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>
<td style="border-radius:14px;background:#4f46e5;box-shadow:0 4px 14px rgba(79,70,229,0.45);">
<a href="${safeUrl}" style="display:inline-block;padding:15px 32px;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">Open job listing →</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:28px 24px 20px;text-align:center;border-top:1px solid #f1f5f9;">
<span style="font-size:12px;color:#94a3b8;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;">Sent by JobHawk · Interview pipeline</span>
</td></tr>
</table>
</td></tr></table>
</body></html>`

  return { subject, text, html }
}
