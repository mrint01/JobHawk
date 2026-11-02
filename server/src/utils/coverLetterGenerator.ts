import { query } from '@anthropic-ai/claude-agent-sdk'
import { checkCoverLetterBody, formatProblemsForRetry } from './coverLetterQualityCheck'
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
  shortCompanyName,
} from './coverLetterFormat'
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
  maxTokensForWordBudget,
} from './coverLetterWordBudget'

const LANGUAGE_LABEL: Record<CoverLetterLanguage, string> = {
  en: 'English',
  de: 'German',
}

export type CoverLetterMode = 'template' | 'openai' | 'claude'

export function getCoverLetterMode(): CoverLetterMode {
  const raw = (process.env.COVER_LETTER_MODE ?? 'claude').trim().toLowerCase()
  if (raw === 'template') return 'template'
  if (raw === 'openai') return 'openai'
  return 'claude'
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
- You MUST state the OKIT enterprise metric given in the user prompt (40% performance, 50,000+ daily users). Put it in your own words so it does not read as a pasted sentence, but keep both numbers exact.
- Personal projects (JobHawk, AI Ticket Assistant, Apartment automation): maximum 2–3 sentences in the entire letter, only as supplements—never the main story.
- Do NOT list multiple personal projects in one paragraph. For AI roles, only the AI Ticket Assistant may appear briefly in one short paragraph.
- Do NOT copy job-posting phrases verbatim (e.g. avoid echoing "define AI system strategies for ADAS")—paraphrase naturally in your own words.
`

const HUMAN_VOICE_RULES = `
VOICE — write like a person, not an assistant. These are hard rules, not preferences:
- NO three-item lists, including lists whose items are several words long ("state, audit trails and failure paths"). Two items, or four with different structure.
- NO contrast constructions, in any disguise: "rather than", "instead of", "not just X but Y", "more than just", and also the split form "The interesting part was not X. It was Y." or "X is not the hard part." State the positive thing and stop.
- NO semicolons. No em-dashes joining clauses.
- Vary sentence length hard. At least two sentences under 10 words. Never three medium-length sentences in a row.
- Vary paragraph length. Exactly ONE paragraph must be one or two sentences — noticeably shorter than the rest. No paragraph may exceed 90 words.
- Do NOT open a paragraph with a thesis statement you then support ("I use AI where it solves a concrete problem."). Open with the concrete thing itself.
- NEVER refer to the job ad as a document: no "your posting", "your profile section", "the requirements listed", "as mentioned in the role description". You are writing to a person, not annotating a PDF.
- Plain words: "about" not "approximately", "use" not "utilize", "help" not "facilitate", "build" not "architect".
- At most TWO numbers in the entire letter. Quantifying every claim reads like an optimizer.
- NO filler bookends: "I would welcome the opportunity", "I am excited to", "I would be glad to discuss", "I believe I would be a strong fit", "I look forward to hearing from you". Replace with something that carries content.
- State one preference or opinion plainly, and make it about HIS OWN work and the decisions he made. Never an opinion about other engineers, the industry, or how things "usually" go. No swipes at people who do it worse ("Plenty of engineers treat compliance as friction").

LANGUAGE PROFICIENCY — never mention it:
- Say NOTHING about how well he speaks German, English, French or Arabic. No level, no claim, no apology.
- Never write that he conducts meetings, coordination, specifications or client work "auf Deutsch" / "in German", and never imply German is part of his daily working language. He is at A2 and this would be exposed in the first phone call.
- If the posting demands German, do not address it. Show the work and let the CV and the interview speak. Writing the letter in German is itself the signal.

EVERY SENTENCE MUST CARRY CHECKABLE INFORMATION — this is the most important rule here:
- Before writing any sentence, ask: could a reader verify this, and would it be false of most other candidates and most other companies? If no to either, delete it.
- BANNED: aphorisms and manufactured insight. No "X is a domain where…", "X is the kind of system that…", "that combination is what drew me", "the regulatory side is not optional". These sound thoughtful and say nothing. A recruiter notices.
- A reason for wanting the job must point at something only true of THIS company or THIS product — what it actually does, who uses it, what constraint it operates under. "The domain is interesting" is not a reason.
- Do not insert a short sentence just to satisfy the rhythm rule. Every sentence, short or long, must connect to the one before it. A stranded fact dropped between two detailed sentences reads worse than a long paragraph.
- Do NOT raise a technology he has not used in production in order to excuse it. Never write "X is on my CV" or "X is familiar ground". If the posting wants something he lacks, either show the nearest real thing he has actually built and let the reader draw the line, or say nothing about it.

ONE REAL SPECIFIC (required):
Include exactly one concrete detail that could only come from Hatem's real work — a named system, a named feature, an actual technical problem and what he did about it. Draw it from the CV evidence in the user prompt.
Test it: the detail must name a THING. "Reworking how the microservices handled data access under load" names nothing and fails. "The live video interview flow inside the recruitment platform" names a thing and passes. "Improved performance by 40%" is a number, not a specific.
If the evidence will not support a real named detail, state the closest concrete fact plainly.

NEVER INVENT — this outranks every writing rule above:
- Every noun in your specific must trace back to the CV evidence or the job posting. If you cannot point at the line it came from, delete the sentence.
- Add NO situational colour whatsoever: no locations, devices, network conditions, times of day, team sizes, deadlines, customer names, or anecdotes about how something felt. "Keeping those sessions alive over a candidate's weak hotel wifi" is invented and would be a lie to a recruiter, even though it reads well.
- A duller true sentence always beats a vivid invented one. If the choice is between flat and false, write flat.
`

const GERMAN_PROSE_RULES = `
DEUTSCH — zusätzliche harte Regeln (die deutschen Entwürfe scheitern bisher genau hier):
- KEIN Lebenslauf-Abwurf. Absatz 2 hat höchstens 4 Sätze und nennt höchstens ZWEI Arbeitgeber. Wer sechs Fakten in einen Absatz presst, schreibt keinen Brief, sondern eine Aufzählung.
- Höchstens EIN Satz im ganzen Brief darf mit "Bei OKIT" beginnen. Variiere das Subjekt: beginne mit der Sache, der Entscheidung oder dem Ergebnis, nicht immer mit dem Arbeitgeber.
- Nenne "OKIT" insgesamt höchstens dreimal, "StartNow" höchstens zweimal.
- Keine angehängten Kurzsätze, die nichts mit dem Satz davor zu tun haben ("PostgreSQL nutze ich in den OKIT-Kundenprojekten."). Jeder Satz muss an den vorherigen anschließen.
- Schreibe wie ein erfahrener Entwickler an einen Menschen: Hauptsätze, aktive Verben, keine Nominalketten ("die Anforderungsabstimmung mit dem Fachbereich" → "ich stimme die Anforderungen mit dem Fachbereich ab").
- Keine Aufzählungen von Technologien ohne Kontext. Jede genannte Technologie braucht ein Verb, das sagt, was er damit gemacht hat.
`

function buildSystemPrompt(
  language: CoverLetterLanguage,
  greeting: string,
  signOff: string,
  profile: CoverLetterProfile,
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
${language === 'de' ? GERMAN_PROSE_RULES : ''}
${SENIORITY_RULES}

OUTPUT FORMAT — CRITICAL:
- Output the full letter body: every paragraph between the greeting and the sign-off.
- Do NOT write the contact block, the greeting, or the sign-off. Those are added automatically.
- Layout: Contact block → "${greeting}" → [your paragraphs] → "${signOff}" → signature
${HUMAN_VOICE_RULES}
BODY STRUCTURE (5 paragraphs):

Paragraph 1 — Opening, exactly 3 sentences:
  (a) REQUIRED first sentence. It MUST begin with the exact words "I am a software engineer with more than four years of experience in" and then complete naturally with the two areas most relevant to THIS posting, plus where he works now. Example shape: "I am a software engineer with more than four years of experience in backend and full-stack development, currently building Java Spring Boot services at OKIT." Complete it differently depending on the posting, but do not change those opening words and do not pad with a list of every technology he knows.
  (b) One sentence of real evidence for THIS role, naming a system or feature he actually built that resembles what this job asks for. Start this sentence with the thing itself or with where he built it — NEVER with a comparison phrase. Do not write "The closest thing I have built to…", "Das Ähnlichste, was ich gebaut habe…", or any variant: that is my instruction to you, not a sentence a person writes.
  (c) One sentence on why this company, pointing at something only true of this company or product — what it does, who uses it, what constraint it runs under. Name the company once, SHORT name only (never the full legal entity). If there is nothing specific to say, say what part of the work he wants more of instead — never fill this with a generality about the industry.
Do NOT end this paragraph with an offer, a thank-you, or "I would welcome the opportunity".

Paragraph 2 — Enterprise impact ONLY (OKIT + StartNow if relevant): production systems, lead responsibility, real outcomes. MUST state this fact, reworded in your own voice with the numbers unchanged: ${okitMetric} Add one more OKIT or StartNow fact. NO personal projects here. Max 90 words.

Paragraph 3 — AI experience (short): ONE personal project only—the AI-Powered Support Ticket Assistant (OpenAI API, NestJS/Spring Boot)—max 3 sentences. Optional: one line on OKIT AI-enhanced features at work. Do NOT mention JobHawk unless unavoidable.

Paragraph 4 — Why this company/role: genuine, specific motivation about the domain, in his own words. Max 3 sentences.

Paragraph 5 — Closing, 2 sentences maximum. ONLY these facts: notice period ${APPLICANT_PROFILE.noticePeriod}, start ${APPLICANT_PROFILE.preferredStart}, and the commute if the job is near Cologne. Do NOT introduce new projects, new skills, or new arguments here. Do not offer to review or advise on their systems. None of the banned filler closers.

WORD COUNT — CRITICAL:
- Whole body (everything between greeting and sign-off): ${BODY_WORD_MIN}–${BODY_WORD_MAX} words. Do not exceed ${BODY_WORD_MAX}.
- Do NOT make every paragraph the same length — see the voice rules.

BANNED WORDS: thrilled, passionate, delighted, seamless, leverage, cutting-edge, synergy, robust, dynamic, spearhead, deep dive, journey. Never copy job-ad slogans word-for-word.

Language: ${lang}.`
  }

  return `Write the BODY of a cover letter for ${APPLICANT_PROFILE.fullName}. Sound human and direct—not AI-polished.

${tone}
${language === 'de' ? GERMAN_PROSE_RULES : ''}
${SENIORITY_RULES}

OUTPUT FORMAT — CRITICAL:
- Output the full letter body: every paragraph between the greeting and the sign-off.
- Do NOT write the contact block, the greeting, or the sign-off. Those are added automatically.
- Layout: Contact block → "${greeting}" → [your paragraphs] → "${signOff}" → signature
${HUMAN_VOICE_RULES}
BODY STRUCTURE (4 paragraphs):

Paragraph 1 — Opening, exactly 3 sentences:
  (a) REQUIRED first sentence. It MUST begin with the exact words "I am a software engineer with more than four years of experience in" and then complete naturally with the two areas most relevant to THIS posting, plus where he works now. Example shape: "I am a software engineer with more than four years of experience in backend and full-stack development, currently building Java Spring Boot services at OKIT." Complete it differently depending on the posting, but do not change those opening words and do not pad with a list of every technology he knows.
  (b) One sentence of real evidence for THIS role, naming a system or feature he actually built that resembles what this job asks for. Start this sentence with the thing itself or with where he built it — NEVER with a comparison phrase. Do not write "The closest thing I have built to…", "Das Ähnlichste, was ich gebaut habe…", or any variant: that is my instruction to you, not a sentence a person writes.
  (c) One sentence on why this company, pointing at something only true of this company or product — what it does, who uses it, what constraint it runs under. Name the company once, SHORT name only (never the full legal entity). If there is nothing specific to say, say what part of the work he wants more of instead — never fill this with a generality about the industry.
Do NOT end this paragraph with an offer, a thank-you, or "I would welcome the opportunity".

Paragraph 2 — Professional achievements: MUST state this fact, reworded in your own voice with the numbers unchanged: ${okitMetric} Then map the job's technologies (from MANDATORY TECHNOLOGIES) to real OKIT/StartNow work. Personal projects: max 1 sentence, and only if it earns its place. Max 90 words — do not let this paragraph swallow the letter.

Paragraph 3 — Why this company/role: one genuine, specific reason in his own words. Max 3 sentences.

Paragraph 4 — Closing, 2 sentences maximum. ONLY these facts: notice period ${APPLICANT_PROFILE.noticePeriod}, start ${APPLICANT_PROFILE.preferredStart}, and the commute if the job is near Cologne. Do NOT introduce new projects, new skills, or new arguments here — anything worth saying belongs in paragraph 2. Do not offer to review or advise on their systems. None of the banned filler closers.

WORD COUNT — CRITICAL:
- Whole body (everything between greeting and sign-off): ${BODY_WORD_MIN}–${BODY_WORD_MAX} words. Do not exceed ${BODY_WORD_MAX}.
- Do NOT make every paragraph the same length — see the voice rules.

BANNED WORDS: thrilled, passionate, delighted, seamless, leverage, cutting-edge, synergy, robust, dynamic, spearhead, deep dive, journey. Never copy job-ad slogans word-for-word.

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
  const requirements = extractPostingRequirements(description, language)
  const requirementsBlock = formatRequirementsForPrompt(requirements)

  const paraCount = profile === 'ai_heavy' ? '5' : '4'
  const okitMetric = getOkitMetricSentence(language)

  return `Write the full letter body (${paraCount} paragraphs) in ${LANGUAGE_LABEL[language]}.

WORD LIMIT: ${BODY_WORD_MIN}–${BODY_WORD_MAX} words total, everything between "Dear…" and the sign-off. Do NOT exceed ${BODY_WORD_MAX}.

No contact block, no greeting, no sign-off — those are added for you.

COMPANY NAME: use "${shortCompanyName(job.company)}" in the prose. Never write the full legal name "${job.company}".

ENTERPRISE METRIC (paragraph 2 — reword it, keep 40% and 50,000 exact): ${okitMetric}

${profile === 'ai_heavy' ? 'AI-HEAVY ROLE: Paragraph 2 = enterprise only. Paragraph 3 = short personal AI project only. Do not let JobHawk dominate.' : 'STANDARD ROLE: Lead with OKIT/StartNow; personal projects max 2 sentences.'}

TARGET ROLE:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location || 'not specified'}

JOB DESCRIPTION (full text from the job page—read all Tasks and Profile sections):
${descBlock}

MANDATORY TECHNOLOGIES FROM POSTING (weave into paragraph 2 after OKIT metric—or paragraph 3 only if AI-specific):
${requirementsBlock}

${highlight ? `KEY THEME (work it in naturally, in your own words — never quote it): "${highlight}"` : ''}

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
): string {
  const { greeting, signOff } = buildLetterEnvelope(job, description, language)
  const profile = detectCoverLetterProfile(job.title, description)
  return buildSystemPrompt(language, greeting, signOff, profile)
}

/**
 * Generate via the Claude Agent SDK, which runs through the locally logged-in
 * `claude` CLI — so this bills against the Claude Code subscription, not a
 * separate API key. Single turn, no tools: we only want text back.
 */
/** One Claude call. Returns the raw letter text, or throws with a usable reason. */
async function runClaudeOnce(
  systemPrompt: string,
  userPrompt: string,
  model: string,
): Promise<string> {
  let resultText = ''
  let assistantText = ''
  let failure = ''

  for await (const message of query({
    prompt: userPrompt,
    options: {
      model,
      systemPrompt,
      // 2, not 1: with no tools the model answers in one turn, but a turn that
      // ends without emitting its final text costs a turn and would otherwise
      // fail the whole request with error_max_turns.
      maxTurns: 2,
      allowedTools: [],
      settingSources: [],
    },
  })) {
    // Keep assistant prose as a fallback for a result we cannot read.
    if (message.type === 'assistant') {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'text') assistantText += block.text
      }
    }
    if (message.type === 'result') {
      if (message.subtype === 'success' && !message.is_error) {
        resultText = message.result.trim()
      } else {
        failure = message.subtype
      }
    }
  }

  const text = resultText || assistantText.trim()
  if (text.length >= 80) return text
  if (failure) throw new Error(`Claude returned no usable letter (${failure})`)
  throw new Error('Claude returned empty or too short content')
}

async function generateWithClaude(
  job: Job,
  description: string,
  language: CoverLetterLanguage,
): Promise<string> {
  const model = process.env.CLAUDE_MODEL?.trim() || 'claude-opus-5'
  const profile = detectCoverLetterProfile(job.title, description)
  const systemPrompt = buildSystemPromptForJob(job, description, language)
  const userPrompt = buildUserPrompt(job, description, language, profile)

  let body = ''
  let lastError: Error | null = null
  let prompt = userPrompt

  // Up to 3 attempts. A failed call is transient; a letter that breaks a
  // deterministic rule (missing opener, leaked scaffolding, a claim about his
  // German) is worth one more call rather than sending it to a recruiter.
  for (let attempt = 1; attempt <= 3; attempt++) {
    let candidate: string
    try {
      const raw = await runClaudeOnce(systemPrompt, prompt, model)
      candidate = enforceBodyWordLimit(extractBodyFromModelOutput(raw, language), BODY_WORD_MAX)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(`[cover-letter] attempt ${attempt}/3 failed: ${lastError.message}`)
      continue
    }

    const problems = checkCoverLetterBody(candidate, language)
    if (problems.length === 0) {
      body = candidate
      break
    }

    console.warn(
      `[cover-letter] attempt ${attempt}/3 rejected: ${problems.map((p) => p.code).join(', ')}`,
    )
    // Keep the best-so-far, so a persistent nitpick never loses us the letter.
    if (!body) body = candidate
    prompt = `${userPrompt}\n\n${formatProblemsForRetry(problems)}`
  }

  if (!body) {
    const detail = lastError?.message ?? 'unknown error'
    const looksLikeAuth = /not logged in|unauthor|credential|authentication|ENOENT|not found/i.test(detail)
    throw new Error(
      looksLikeAuth
        ? `Claude request failed: ${detail}. Run \`claude login\` on this machine, or set COVER_LETTER_MODE=template.`
        : `Claude request failed: ${detail}. Retry, or set COVER_LETTER_MODE=template for a rule-based letter.`,
    )
  }

  const totalWords = countWords(body)
  console.log(`[cover-letter] body word count: ${totalWords} (target ${BODY_WORD_MIN}–${BODY_WORD_MAX})`)
  return assembleCoverLetter(job, description, language, body)
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
  const maxTokens = maxTokensForWordBudget(BODY_WORD_MAX)

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
        { role: 'system', content: buildSystemPromptForJob(job, description, language) },
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
  let body = extractBodyFromModelOutput(raw, language)
  body = enforceBodyWordLimit(body, BODY_WORD_MAX)
  const totalWords = countWords(body)
  console.log(`[cover-letter] body word count: ${totalWords} (target ${BODY_WORD_MIN}–${BODY_WORD_MAX})`)
  return assembleCoverLetter(job, description, language, body)
}

/** Build cover letter text (Claude or OpenAI when configured; otherwise evidence-matched template). */
export async function generateCoverLetterContent(
  job: Job,
  userId: string,
  language: CoverLetterLanguage,
): Promise<string> {
  const description = await resolveJobDescriptionForCoverLetter(job, userId)
  const mode = getCoverLetterMode()

  if (mode === 'claude') {
    return generateWithClaude(job, description, language)
  }

  if (mode === 'openai') {
    return generateWithOpenAI(job, description, language)
  }

  return generateCoverLetterFromTemplate(job, description, language)
}
