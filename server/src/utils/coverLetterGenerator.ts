import { APPLICANT_PROFILE, formatProfileForPrompt, headlineForJobPosting } from '../data/applicantProfile'
import type { Job } from '../scrapers/types'
import { fetchJobDescriptionFromUrl } from './descriptionEnricher'
import { setJobDescriptionById } from './jobStore'
import type { CoverLetterLanguage } from './coverLetterStore'
import { generateCoverLetterFromTemplate } from './coverLetterTemplate'
import {
  assembleCoverLetter,
  buildLetterEnvelope,
  extractBodyFromModelOutput,
} from './coverLetterFormat'
import { buildIntroParagraph, combineIntroWithBody } from './coverLetterIntro'
import {
  extractPostingHighlights,
  formatMatchedEvidenceForPrompt,
  matchEvidenceToPosting,
} from './coverLetterMatcher'
import {
  descriptionLooksIncomplete,
  extractPostingRequirements,
  formatRequirementsForPrompt,
} from './jobPostingRequirements'
import {
  detectCoverLetterProfile,
  getOkitMetricSentence,
  type CoverLetterProfile,
} from './coverLetterProfile'
import {
  BODY_WORD_MAX,
  BODY_WORD_MIN,
  countWords,
  enforceBodyWordLimit,
  getAiParagraphWordBudget,
  maxTokensForWordBudget,
} from './coverLetterWordBudget'

const LANGUAGE_LABEL: Record<CoverLetterLanguage, string> = {
  en: 'English',
  de: 'German',
}

export type CoverLetterMode = 'template' | 'openai'

export function getCoverLetterMode(): CoverLetterMode {
  const raw = (process.env.COVER_LETTER_MODE ?? 'openai').trim().toLowerCase()
  if (raw === 'template') return 'template'
  return 'openai'
}

function slugify(s: string, max = 56): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, max) || 'position'
  )
}

/** cover_letter_hatem_sfar_senior_java_developer.pdf */
export function sanitizeCoverLetterFilename(
  _company: string,
  title: string,
  _language: CoverLetterLanguage,
): string {
  const name = slugify(APPLICANT_PROFILE.fullName.replace(/\s+/g, '_'), 40)
  const role = slugify(title, 56)
  return `cover_letter_${name}_${role}.pdf`
}

export async function resolveJobDescriptionForCoverLetter(job: Job, userId: string): Promise<string> {
  let description = (job.description ?? '').trim()
  const needsFetch = description.length < 120 || descriptionLooksIncomplete(description)

  if (needsFetch) {
    console.log(
      `[cover-letter] fetching job page for ${job.id} (stored ${description.length} chars, incomplete=${descriptionLooksIncomplete(description)})`,
    )
    const fetched = await fetchJobDescriptionFromUrl({
      id: job.id,
      url: job.url,
      platform: job.platform,
      userId,
    })
    if (fetched.length > description.length) {
      await setJobDescriptionById(userId, job.id, fetched)
      description = fetched
      console.log(`[cover-letter] description updated to ${description.length} chars`)
    }
  }

  return description.slice(0, 12000)
}

const SENIORITY_RULES = `
SENIORITY & PRIORITY (critical):
- Lead with OKIT GmbH and StartNow professional experience—this is senior-level hiring.
- You MUST include the OKIT enterprise metric sentence exactly as given in the user prompt (40% performance, 50,000+ daily users).
- Personal projects (JobHawk, AI Ticket Assistant, Apartment automation): maximum 2–3 sentences in the entire letter, only as supplements—never the main story.
- Do NOT list multiple personal projects in one paragraph. For AI roles, only the AI Ticket Assistant may appear briefly in one short paragraph.
- Do NOT copy job-posting phrases verbatim (e.g. avoid echoing "define AI system strategies for ADAS")—paraphrase naturally in your own words.
`

function buildSystemPrompt(
  language: CoverLetterLanguage,
  greeting: string,
  signOff: string,
  profile: CoverLetterProfile,
  aiWordMin: number,
  aiWordMax: number,
  introWordCount: number,
): string {
  const lang = LANGUAGE_LABEL[language]
  const okitMetric = getOkitMetricSentence(language)
  const tone =
    language === 'de'
      ? 'Deutsch, formell mit „Sie“. Ton: selbstbewusst, knapp, professionell—wie ein erfahrener Engineer in der deutschen Tech-Branche. Kein Marketing-Sprech.'
      : 'Professional English. Tone: confident, concise, senior—like an experienced engineer in German tech hiring. No marketing speak.'

  if (profile === 'ai_heavy') {
    return `Write the BODY of a cover letter for ${APPLICANT_PROFILE.fullName}. Sound human and direct—not AI-polished.

${tone}
${SENIORITY_RULES}

OUTPUT FORMAT — CRITICAL:
- Output ONLY paragraphs 2–5 below. Nothing else.
- Do NOT write the intro paragraph (added automatically).
- Layout: Contact block → "${greeting}" → [fixed intro] → [your 4 paragraphs] → "${signOff}" → signature

BODY STRUCTURE (exactly 4 paragraphs):

Paragraph 2 — Enterprise impact ONLY (OKIT + StartNow if relevant): production systems, lead responsibility, measurable outcomes. MUST include verbatim: ${okitMetric} Add one more OKIT or StartNow fact (microservices, Agile teams, tests). NO personal projects in this paragraph.

Paragraph 3 — AI experience (short): ONE personal project only—the AI-Powered Support Ticket Assistant (OpenAI API, NestJS/Spring Boot)—max 3 sentences. Optional: one line on OKIT AI-enhanced features at work. Do NOT mention JobHawk unless unavoidable.

Paragraph 4 — Why this company/role: genuine motivation; reference the domain (e.g. driver assistance, in-vehicle software) in natural language—do NOT mirror the posting's marketing phrases. Max 3 sentences.

Paragraph 5 — Brief closing: conversation offer, notice period ${APPLICANT_PROFILE.noticePeriod}, start ${APPLICANT_PROFILE.preferredStart}.

WORD COUNT — CRITICAL:
- Fixed intro is already ${introWordCount} words (not counted in your limit).
- Your 4 paragraphs: ${aiWordMin}–${aiWordMax} words only.
- Intro + your text combined MUST stay ${BODY_WORD_MIN}–${BODY_WORD_MAX} words (everything between greeting and sign-off).
- Keep each paragraph short (roughly 45–75 words each).

BANNED: thrilled, passionate, delighted, seamless, leverage, cutting-edge, synergy, copying job ad slogans word-for-word.

Language: ${lang}.`
  }

  return `Write the BODY of a cover letter for ${APPLICANT_PROFILE.fullName}. Sound human and direct—not AI-polished.

${tone}
${SENIORITY_RULES}

OUTPUT FORMAT — CRITICAL:
- Output ONLY paragraphs 2–4. No intro, header, or signature.
- Layout: Contact block → "${greeting}" → [fixed intro] → [your 3 paragraphs] → "${signOff}" → signature

Paragraph 2 — Professional achievements FIRST: MUST include ${okitMetric} Then map job technologies (from MANDATORY TECHNOLOGIES list) to OKIT/StartNow work. Personal projects: max 2 sentences total, end of paragraph only if needed.

Paragraph 3 — Why this company/role: natural paraphrase of one posting theme—do not quote the ad. Max 3 sentences.

Paragraph 4 — Brief closing (2 sentences max).

WORD COUNT — CRITICAL:
- Fixed intro is already ${introWordCount} words.
- Your 3 paragraphs: ${aiWordMin}–${aiWordMax} words only.
- Intro + your text combined MUST be ${BODY_WORD_MIN}–${BODY_WORD_MAX} words total between greeting and sign-off.

BANNED: thrilled, passionate, delighted, seamless, leverage, synergy, job-ad copy-paste.

Language: ${lang}.`
}

function buildUserPrompt(
  job: Job,
  description: string,
  language: CoverLetterLanguage,
  profile: CoverLetterProfile,
): string {
  const descBlock =
    description.length > 0
      ? description
      : '(No full job description — infer priorities from title and company only; still use matched evidence below.)'

  const matches = matchEvidenceToPosting(
    job.title,
    job.company,
    job.location ?? '',
    description,
    language,
    4,
  )
  const highlight = extractPostingHighlights(description)
  const evidenceBlock = formatMatchedEvidenceForPrompt(matches)
  const adaptiveHeadline = headlineForJobPosting(job.title, description)
  const introPreview = buildIntroParagraph(job, description, language)
  const requirements = extractPostingRequirements(description, language)
  const requirementsBlock = formatRequirementsForPrompt(requirements)

  const introWords = countWords(introPreview)
  const budget = getAiParagraphWordBudget(introWords)
  const paraRange = profile === 'ai_heavy' ? '2–5' : '2–4'
  const okitMetric = getOkitMetricSentence(language)

  return `Write ONLY paragraphs ${paraRange} in ${LANGUAGE_LABEL[language]}.

WORD LIMIT: ${budget.min}–${budget.max} words for your paragraphs alone.
FULL BODY LIMIT: intro (${introWords} words, fixed below) + your paragraphs = ${BODY_WORD_MIN}–${BODY_WORD_MAX} words total between "Dear…" and "Warm regards".
Do NOT exceed ${budget.max} words in your section.

No header, no greeting, no sign-off.

Fixed intro (do not repeat):
"${introPreview}"

ENTERPRISE METRIC (must appear in paragraph 2): ${okitMetric}

${profile === 'ai_heavy' ? 'AI-HEAVY ROLE: Paragraph 2 = enterprise only. Paragraph 3 = short personal AI project only. Do not let JobHawk dominate.' : 'STANDARD ROLE: Lead with OKIT/StartNow; personal projects max 2 sentences.'}

TARGET ROLE:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location || 'not specified'}

JOB DESCRIPTION (full text from the job page—read all Tasks and Profile sections):
${descBlock}

MANDATORY TECHNOLOGIES FROM POSTING (weave into paragraph 2 after OKIT metric—or paragraph 3 only if AI-specific):
${requirementsBlock}

${highlight ? `KEY LINE TO REFERENCE (paraphrase naturally in paragraph 3): "${highlight}"` : ''}

The header subtitle line will be (do not write this in output): ${adaptiveHeadline}

PRE-MATCHED CV EVIDENCE (pick max 2 for paragraph 2—short sentences only):
${evidenceBlock}

FULL CANDIDATE PROFILE:
${formatProfileForPrompt()}`
}

function buildSystemPromptForJob(
  job: Job,
  description: string,
  language: CoverLetterLanguage,
  introWordCount: number,
): string {
  const { greeting, signOff } = buildLetterEnvelope(job, description, language)
  const profile = detectCoverLetterProfile(job.title, description)
  const budget = getAiParagraphWordBudget(introWordCount)
  return buildSystemPrompt(language, greeting, signOff, profile, budget.min, budget.max, introWordCount)
}

async function generateWithOpenAI(
  job: Job,
  description: string,
  language: CoverLetterLanguage,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(
      'OpenAI is required for best tailoring. Set OPENAI_API_KEY in server/.env, or use COVER_LETTER_MODE=template for rule-based letters.',
    )
  }

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  const profile = detectCoverLetterProfile(job.title, description)
  const intro = buildIntroParagraph(job, description, language)
  const introWords = countWords(intro)
  const budget = getAiParagraphWordBudget(introWords)
  const maxTokens = maxTokensForWordBudget(budget.max)

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.42,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: buildSystemPromptForJob(job, description, language, introWords) },
        { role: 'user', content: buildUserPrompt(job, description, language, profile) },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`OpenAI request failed (${res.status}): ${errBody.slice(0, 300)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = data.choices?.[0]?.message?.content?.trim()
  if (!raw || raw.length < 80) {
    throw new Error('Cover letter generation returned empty or too short content')
  }
  const rest = extractBodyFromModelOutput(raw, language)
  let body = combineIntroWithBody(intro, rest, language)
  body = enforceBodyWordLimit(body, BODY_WORD_MAX)
  const totalWords = countWords(body)
  console.log(`[cover-letter] body word count: ${totalWords} (target ${BODY_WORD_MIN}–${BODY_WORD_MAX})`)
  return assembleCoverLetter(job, description, language, body)
}

/** Build cover letter text (OpenAI when configured; otherwise evidence-matched template). */
export async function generateCoverLetterContent(
  job: Job,
  userId: string,
  language: CoverLetterLanguage,
): Promise<string> {
  const description = await resolveJobDescriptionForCoverLetter(job, userId)
  const mode = getCoverLetterMode()

  if (mode === 'openai') {
    return generateWithOpenAI(job, description, language)
  }

  return generateCoverLetterFromTemplate(job, description, language)
}
