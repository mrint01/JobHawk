import { CV_EVIDENCE } from '../data/applicantProfile'
import type { CoverLetterLanguage } from './coverLetterStore'

export interface MatchedEvidence {
  id: string
  score: number
  hook: string
  proof: string
}

const DEFAULT_IDS = ['typescript', 'react', 'java'] as const

function normalizePostingText(title: string, company: string, location: string, description: string): string {
  return `${title}\n${company}\n${location}\n${description}`.toLowerCase()
}

function scoreEvidence(topics: readonly string[], text: string): number {
  let score = 0
  for (const topic of topics) {
    const t = topic.trim().toLowerCase()
    if (!t) continue
    if (text.includes(t)) score += t.length >= 8 ? 3 : t.length >= 4 ? 2 : 1
  }
  return score
}

/** Pick the CV proof blocks that best match the job posting. */
export function matchEvidenceToPosting(
  title: string,
  company: string,
  location: string,
  description: string,
  language: CoverLetterLanguage,
  maxItems = 3,
): MatchedEvidence[] {
  const text = normalizePostingText(title, company, location, description)

  const ranked = CV_EVIDENCE.map((block) => ({
    id: block.id,
    score: scoreEvidence(block.topics, text),
    hook: language === 'de' ? block.de.hook : block.en.hook,
    proof: language === 'de' ? block.de.proof : block.en.proof,
  }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)

  if (ranked.length >= 2) return ranked.slice(0, maxItems)

  const fallback = DEFAULT_IDS.map((id) => CV_EVIDENCE.find((e) => e.id === id)).filter(Boolean)
  const merged = [
    ...ranked,
    ...fallback
      .filter((b) => b && !ranked.some((r) => r.id === b.id))
      .map((b) => ({
        id: b!.id,
        score: 0,
        hook: language === 'de' ? b!.de.hook : b!.en.hook,
        proof: language === 'de' ? b!.de.proof : b!.en.proof,
      })),
  ]
  return merged.slice(0, maxItems)
}

/** Short phrases from the posting to reference in the "why this role" paragraph. */
export function extractPostingHighlights(description: string, maxLen = 220): string {
  if (!description || description.length < 80) return ''

  const lines = description
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 40 && l.length <= 200)

  const priority = lines.find((l) =>
    /responsibilit|requirement|qualification|aufgaben|anforderung|profil|you will|wir suchen|your role/i.test(l),
  )
  if (priority) return priority.slice(0, maxLen)

  const first = lines[0] ?? description.slice(0, maxLen)
  return first.slice(0, maxLen)
}

export function formatMatchedEvidenceForPrompt(matches: MatchedEvidence[]): string {
  return matches.map((m, i) => `${i + 1}. [${m.id}] ${m.proof}`).join('\n')
}
