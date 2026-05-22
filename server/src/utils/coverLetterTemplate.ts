import { APPLICANT_PROFILE } from '../data/applicantProfile'
import type { Job } from '../scrapers/types'
import type { CoverLetterLanguage } from './coverLetterStore'
import { assembleCoverLetter } from './coverLetterFormat'
import { buildIntroParagraph } from './coverLetterIntro'
import { BODY_WORD_MAX, enforceBodyWordLimit } from './coverLetterWordBudget'
import { detectCoverLetterProfile, getOkitMetricSentence } from './coverLetterProfile'
import {
  extractPostingHighlights,
  matchEvidenceToPosting,
  type MatchedEvidence,
} from './coverLetterMatcher'

function buildEnterpriseParagraph(language: CoverLetterLanguage): string {
  const metric = getOkitMetricSentence(language)
  if (language === 'de') {
    return `${metric} Als Lead Developer verantworte ich bei OKIT mehrere Kundenprojekte mit Java Spring Boot Microservices und Full-Stack-Lieferung in Agile-Teams.`
  }
  return `${metric} As lead developer at OKIT, I own Java Spring Boot microservices and full-stack delivery across client projects in Agile teams.`
}

function buildBriefAiProjectParagraph(language: CoverLetterLanguage): string {
  if (language === 'de') {
    return 'Ergänzend habe ich in einem persönlichen Projekt (AI-Powered Support Ticket Assistant) die OpenAI-API in eine NestJS/Spring-Boot-Anwendung integriert—praktische Erfahrung mit KI-gestützten Workflows.'
  }
  return 'In a personal project, my AI-Powered Support Ticket Assistant integrates the OpenAI API in a NestJS/Spring Boot stack—practical experience shipping AI-assisted workflows.'
}

function buildStandardAchievements(matches: MatchedEvidence[], language: CoverLetterLanguage): string {
  const metric = getOkitMetricSentence(language)
  const professional = matches
    .filter((m) => m.id === 'java' || m.id === 'react' || m.id === 'angular')
    .slice(0, 1)
    .map((m) => compactProof(m.proof))[0]

  const extra = professional
    ? ` ${professional}`
    : language === 'de'
      ? ' Ich verantworte produktive Microservices und Full-Stack-Lösungen in Kundenprojekten.'
      : ' I own production microservices and full-stack delivery on client projects.'

  return `${metric}${extra}`
}

function compactProof(proof: string): string {
  const first = proof.match(/^[^.!?]+[.!?]/)?.[0]?.trim()
  return first && first.length > 40 ? first : proof.slice(0, 160).trim() + (proof.length > 160 ? '…' : '')
}

function buildCompanyParagraph(
  job: Job,
  description: string,
  language: CoverLetterLanguage,
): string {
  const highlight = extractPostingHighlights(description)
  if (language === 'de') {
    const ref = highlight ? ` Besonders relevant: ${highlight}` : ''
    return `Bei ${job.company} möchte ich diese Erfahrung in Ihr Team einbringen—fokussiert auf belastbare Software und klare Ergebnisse.${ref}`
  }
  const ref = highlight ? ` One theme from your posting that fits my background: ${highlight}` : ''
  return `At ${job.company}, I would apply this experience on your team with a focus on reliable delivery and practical impact.${ref}`
}

function buildClosing(language: CoverLetterLanguage): string {
  const p = APPLICANT_PROFILE
  const start = p.preferredStart === 'Flexible' ? 'flexible' : p.preferredStart
  if (language === 'de') {
    const startDe = p.preferredStart === 'Flexible' ? 'flexibel' : p.preferredStart
    return `Gerne bespreche ich in einem kurzen Gespräch, wie ich Sie unterstützen kann. Kündigungsfrist: ${p.noticePeriod}, Start: ${startDe}.`
  }
  return `I would welcome a brief conversation. Notice period: ${p.noticePeriod}; start date: ${start}.`
}

export function generateCoverLetterFromTemplate(
  job: Job,
  description: string,
  language: CoverLetterLanguage,
): string {
  const profile = detectCoverLetterProfile(job.title, description)
  const matches = matchEvidenceToPosting(job.title, job.company, job.location ?? '', description, language, 3)

  const intro = buildIntroParagraph(job, description, language)

  const restBody =
    profile === 'ai_heavy'
      ? [
          buildEnterpriseParagraph(language),
          buildBriefAiProjectParagraph(language),
          buildCompanyParagraph(job, description, language),
          buildClosing(language),
        ].join('\n\n')
      : [
          buildStandardAchievements(matches, language),
          buildCompanyParagraph(job, description, language),
          buildClosing(language),
        ].join('\n\n')

  const body = enforceBodyWordLimit(`${intro}\n\n${restBody}`, BODY_WORD_MAX)
  return assembleCoverLetter(job, description, language, body)
}
