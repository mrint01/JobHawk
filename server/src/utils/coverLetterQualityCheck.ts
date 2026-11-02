import type { CoverLetterLanguage } from './coverLetterStore'
import { BODY_WORD_MAX, BODY_WORD_MIN, countWords } from './coverLetterWordBudget'

/**
 * Deterministic checks on a generated letter body.
 *
 * Prompt rules alone plateau around 80% compliance, and the failures are the
 * expensive kind — a missing opener or a claim about German that collapses in
 * the first phone call. Anything listed here is cheap to detect and worth a
 * second generation, so the caller regenerates once with these as corrections.
 */

const OPENER: Record<CoverLetterLanguage, RegExp> = {
  en: /^I am a software engineer with more than four years of experience in/i,
  de: /^Ich bin Softwareentwickler(?:\/in)? mit mehr als vier Jahren Erfahrung/i,
}

/** Phrases that are the prompt's own wording showing through the prose. */
const SCAFFOLDING: { re: RegExp; why: string }[] = [
  { re: /\bthe closest thing I (?:have |'ve )?(?:ever )?built\b/i, why: 'the phrase "the closest thing I have built" is prompt wording, not letter prose' },
  { re: /\bdas [äa]hnlichste,? was ich\b/i, why: 'die Formulierung "Das Ähnlichste, was ich gebaut habe" stammt aus der Anweisung, nicht aus einem Brief' },
  { re: /^\s*\*\*/m, why: 'a bold markdown label leaked into the letter' },
  { re: /^\s*#{1,6}\s/m, why: 'a markdown heading leaked into the letter' },
  { re: /^\s*(?:-{3,}|\*{3,})\s*$/m, why: 'a horizontal rule leaked into the letter' },
  { re: /\(\s*(?:ca\.|approx\.|about|~)?\s*\d+\s*(?:w[oö]rter|words)\b/i, why: 'a word-count note leaked into the letter' },
]

/** Claims about language ability. He is A2 in German; these fail at first contact. */
const PROFICIENCY: { re: RegExp; why: string }[] = [
  { re: /\bauf Deutsch\b/i, why: 'claims work is conducted in German' },
  { re: /\bin German\b/i, why: 'claims work is conducted in German' },
  { re: /\bDeutschkenntnisse\b/i, why: 'states a German proficiency' },
  { re: /\b(?:fluent|verhandlungssicher|flie(?:ss|ß)end)\b/i, why: 'states a language proficiency level' },
  { re: /\b[ABC][12]\b/, why: 'states a CEFR language level' },
  { re: /\bmuttersprach|\bnative speaker\b/i, why: 'states a language proficiency level' },
]

export interface LetterProblem {
  code: string
  detail: string
}

export function checkCoverLetterBody(
  body: string,
  language: CoverLetterLanguage,
): LetterProblem[] {
  const problems: LetterProblem[] = []
  const text = body.trim()

  if (!OPENER[language].test(text)) {
    problems.push({
      code: 'opener',
      detail:
        language === 'de'
          ? 'Der Brief muss mit "Ich bin Softwareentwickler mit mehr als vier Jahren Erfahrung in …" beginnen.'
          : 'The letter must begin with the exact words "I am a software engineer with more than four years of experience in …".',
    })
  }

  for (const { re, why } of SCAFFOLDING) {
    if (re.test(text)) problems.push({ code: 'scaffolding', detail: `Remove it — ${why}.` })
  }

  for (const { re, why } of PROFICIENCY) {
    const hit = text.match(re)
    if (hit) {
      problems.push({
        code: 'proficiency',
        detail: `Delete "${hit[0]}" and say nothing about language ability at all — ${why}.`,
      })
    }
  }

  // The prompt asks for BODY_WORD_MIN–BODY_WORD_MAX; the gate only rejects a
  // letter that is meaningfully outside it. A 240-word letter is not worse than
  // a 251-word one, and German says the same thing in fewer, longer words —
  // rejecting a 10-word miss just burns a regeneration.
  const words = countWords(text)
  const floor = Math.round(BODY_WORD_MIN * 0.9)
  const ceiling = Math.round(BODY_WORD_MAX * 1.03)
  if (words < floor || words > ceiling) {
    problems.push({
      code: 'length',
      detail: `The body is ${words} words; aim for ${BODY_WORD_MIN}–${BODY_WORD_MAX}.`,
    })
  }

  return problems
}

/** Corrections appended to the prompt on the retry. */
export function formatProblemsForRetry(problems: LetterProblem[]): string {
  return [
    'Your previous attempt broke these rules. Fix every one of them and keep everything else about the letter:',
    ...problems.map((p) => `- ${p.detail}`),
  ].join('\n')
}
