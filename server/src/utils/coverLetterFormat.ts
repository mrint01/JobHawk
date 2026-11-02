import { APPLICANT_PROFILE, headlineForJobPosting } from '../data/applicantProfile'
import type { Job } from '../scrapers/types'
import type { CoverLetterLanguage } from './coverLetterStore'
import { BODY_WORD_MAX, BODY_WORD_MIN } from './coverLetterWordBudget'

export { BODY_WORD_MIN, BODY_WORD_MAX }

const LEGAL_FORMS =
  /\s*(?:gmbh\s*&\s*co\.?\s*kgaa|gmbh\s*&\s*co\.?\s*kg|ag\s*&\s*co\.?\s*kg|gmbh|mbh|ag|se|kgaa|kg|ohg|gbr|e\.?\s*v\.?|e\.?\s*g\.?|ug|inc\.?|incorporated|ltd\.?|limited|llc|l\.?l\.?c\.?|b\.?v\.?|n\.?v\.?|s\.?a\.?(?:\s*r\.?l\.?)?|plc|corp\.?|co\.?)\s*$/i

/** German descriptor words that follow the real brand name ("KPMG AG Wirtschaftsprüfungsgesellschaft"). */
const DESCRIPTOR_WORD =
  /^(?:wirtschaftspr[üu]fungsgesellschaft|steuerberatungsgesellschaft|unternehmensgruppe|unternehmensberatung|aktiengesellschaft|beratungsgesellschaft|gesellschaft|holding|group|gruppe|technologies|technology|solutions|services|systems|software|consulting|partner|stiftung|deutschland|germany|international|international[ae]?)$/i

/**
 * Turn a scraped legal entity into what a person would actually type in a
 * salutation: "KPMG AG Wirtschaftsprüfungsgesellschaft" -> "KPMG".
 */
export function shortCompanyName(company: string): string {
  const original = (company ?? '').trim().replace(/\s+/g, ' ')
  if (!original) return 'Hiring'
  let name = original

  // 1. Cut trailing descriptor clauses and marketing suffixes first, so a legal
  //    form buried mid-string ("ABD Media GmbH - Franchise TOP 10") still strips.
  const cut = name.search(/\s+(?:f[üu]r|for|of|and|und)\s+|\s*[,|–—]\s*|\s+-\s+/i)
  if (cut > 0) name = name.slice(0, cut).trim()

  // 2. Alternate legal-form and descriptor stripping until nothing more comes
  //    off — a descriptor can hide a legal form behind it and vice versa.
  for (let pass = 0; pass < 4; pass++) {
    const before = name

    const stripped = name.replace(LEGAL_FORMS, '').replace(/[\s,&.-]+$/, '').trim()
    if (stripped) name = stripped

    const parts = name.split(/[\s-]+/).filter(Boolean)
    while (parts.length > 1 && DESCRIPTOR_WORD.test(parts[parts.length - 1])) parts.pop()
    if (parts.length) name = parts.join(' ')

    if (name === before) break
  }

  return name || original
}

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
    greeting: `Dear ${shortCompanyName(job.company)} Team,`,
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
/**
 * Models sometimes emit a false start, a horizontal rule, then the real letter.
 * Keep the longest chunk so that preamble never reaches the recruiter.
 */
function dropPreambleBeforeRule(text: string): string {
  const chunks = text
    .split(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m)
    .map((c) => c.trim())
    .filter(Boolean)
  if (chunks.length < 2) return text
  return chunks.reduce((a, b) => (b.length > a.length ? b : a))
}

/**
 * Lines that are the model labelling its own output rather than letter text:
 * "**Briefkörper (Deutsch, 4 Absätze):**", "*(ca. 250 Wörter)*", "## Paragraph 2".
 * These reach the recruiter verbatim if they survive, so drop them.
 */
const SCAFFOLDING_LINE = [
  /^\s*\*\*[^*]*\*\*\s*:?\s*$/,                                   // whole line bold
  /^\s*#{1,6}\s/,                                                    // markdown heading
  /^\s*[*_]*\(\s*(?:ca\.|approx\.|about|~)?\s*\d+\s*(?:w[oö]rter|words)\b[^)]*\)[*_]*\s*$/i,
  /^\s*[*_]*\s*(?:absatz|paragraph|briefk[oö]rper|body|letter body)\s*\d*\s*[:\-–][^\n]*$/i,
  /^\s*\[[^\]]*\]\s*$/,                                             // [placeholder]
] as const

function stripScaffolding(lines: string[]): string[] {
  return lines.filter((l) => !SCAFFOLDING_LINE.some((re) => re.test(l)))
}

export function extractBodyFromModelOutput(raw: string, language: CoverLetterLanguage): string {
  const text = dropPreambleBeforeRule(raw.trim())
  const lines = stripScaffolding(text.split('\n'))
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
