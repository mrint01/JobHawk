import type { Job } from '../scrapers/types'

export type CoverLetterProfile = 'ai_heavy' | 'standard'

const OKIT_METRIC_EN =
  'At OKIT GmbH, I improved backend transaction performance by approximately 40% for systems serving over 50,000 daily users.'
const OKIT_METRIC_DE =
  'Bei OKIT GmbH habe ich die Backend-Performance um ca. 40 % bei Systemen mit über 50.000 täglichen Nutzern verbessert.'

export function getOkitMetricSentence(language: 'en' | 'de'): string {
  return language === 'de' ? OKIT_METRIC_DE : OKIT_METRIC_EN
}

export function detectCoverLetterProfile(jobTitle: string, description: string): CoverLetterProfile {
  const t = `${jobTitle}\n${description}`.toLowerCase()
  if (
    /adas|autonomous|self-driving|autonomes fahren|fahrassistenz|ai system|ai engineer|machine learning|llm|genai|\bki\b/.test(
      t,
    )
  ) {
    return 'ai_heavy'
  }
  if (/\bai\b/.test(t) && /engineer|developer|architect|research/.test(t)) {
    return 'ai_heavy'
  }
  return 'standard'
}

export function isAiHeavyJob(job: Job, description: string): boolean {
  return detectCoverLetterProfile(job.title, description) === 'ai_heavy'
}
