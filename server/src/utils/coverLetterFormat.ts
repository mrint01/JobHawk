import { APPLICANT_PROFILE, headlineForJobPosting } from '../data/applicantProfile'
import type { Job } from '../scrapers/types'
import type { CoverLetterLanguage } from './coverLetterStore'
import { BODY_WORD_MAX, BODY_WORD_MIN } from './coverLetterWordBudget'

export { BODY_WORD_MIN, BODY_WORD_MAX }

/** Fixed header + greeting + sign-off (not counted toward 250–350 word body limit). */
export function buildLetterEnvelope(
  job: Job,
  description: string,
  language: CoverLetterLanguage,
): { contactBlock: string; greeting: string; signOff: string; signature: string } {
  const p = APPLICANT_PROFILE
  const headline = headlineForJobPosting(job.title, description)
  const contactBlock = [p.fullName, headline, p.location, p.email, p.phone].join('\n')

  if (language === 'de') {
    return {
      contactBlock,
      greeting: 'Sehr geehrte Damen und Herren,',
      signOff: 'Mit freundlichen Grüßen',
      signature: p.fullName,
    }
  }

  return {
    contactBlock,
    greeting: `Dear ${job.company} Hiring Team,`,
    signOff: 'Warm regards,',
    signature: p.fullName,
  }
}

export function assembleCoverLetter(
  job: Job,
  description: string,
  language: CoverLetterLanguage,
  body: string,
): string {
  const { contactBlock, greeting, signOff, signature } = buildLetterEnvelope(job, description, language)
  const trimmedBody = body.trim()
  return `${contactBlock}\n\n${greeting}\n\n${trimmedBody}\n\n${signOff}\n\n${signature}`
}

/** If the model returned a full letter, keep only the 4 body paragraphs. */
export function extractBodyFromModelOutput(raw: string, language: CoverLetterLanguage): string {
  let text = raw.trim()
  const lines = text.split('\n')
  const greetingMarkers =
    language === 'de'
      ? [/sehr geehrte/i, /guten tag/i]
      : [/dear\s+/i, /hiring team/i]

  let startIdx = 0
  for (let i = 0; i < lines.length; i++) {
    if (greetingMarkers.some((re) => re.test(lines[i]))) {
      startIdx = i + 1
      break
    }
  }

  const signOffMarkers =
    language === 'de'
      ? [/mit freundlichen grüßen/i, /freundliche grüße/i]
      : [/warm regards/i, /best regards/i, /kind regards/i, /sincerely/i]

  let endIdx = lines.length
  for (let i = lines.length - 1; i >= startIdx; i--) {
    if (signOffMarkers.some((re) => re.test(lines[i]))) {
      endIdx = i
      break
    }
  }

  const bodyLines = lines.slice(startIdx, endIdx)
  // Drop leading contact-like lines (email, phone, headline patterns)
  while (bodyLines.length > 0 && looksLikeContactLine(bodyLines[0])) {
    bodyLines.shift()
  }

  const body = bodyLines.join('\n').trim()
  return body || text
}

function looksLikeContactLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (/@/.test(t) || /^\+?\d[\d\s-]{8,}$/.test(t)) return true
  if (/cologne|köln|germany|deutschland/i.test(t)) return true
  if (/^hatem sfar$/i.test(t)) return true
  if (/software engineer/i.test(t) && /\|/.test(t)) return true
  return false
}

export function countBodyWords(body: string): number {
  return body.split(/\s+/).filter(Boolean).length
}
