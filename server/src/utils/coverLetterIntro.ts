import type { Job } from '../scrapers/types'
import type { CoverLetterLanguage } from './coverLetterStore'

function postingText(jobTitle: string, description: string): string {
  return `${jobTitle}\n${description}`.toLowerCase()
}

function stackPhraseForRole(jobTitle: string, description: string, language: CoverLetterLanguage): string {
  const t = postingText(jobTitle, description)
  if (/ai\b|llm|machine learning|ml engineer|genai|deep learning|\bki\b|intelligent|adas|autonomous/.test(t)) {
    return language === 'de'
      ? 'Java Spring Boot, Backend- und KI-nahe Systeme, React/TypeScript und AWS'
      : 'Java Spring Boot, backend and AI-oriented systems, React/TypeScript, and AWS'
  }
  if (/\bangular\b/.test(t)) {
    return language === 'de'
      ? 'Angular, TypeScript, React/TypeScript-Webanwendungen, Java Spring Boot und AWS'
      : 'Angular, TypeScript, React/TypeScript web applications, Java Spring Boot, and AWS'
  }
  if (/typescript|nestjs|node\.?js|full.?stack|frontend/.test(t)) {
    return language === 'de'
      ? 'TypeScript/React, Node.js, Java Spring Boot und AWS'
      : 'TypeScript/React, Node.js, Java Spring Boot, and AWS'
  }
  if (/mobile|react native|ios|android/.test(t)) {
    return language === 'de'
      ? 'React Native, TypeScript, React und cloudnahe Backend-Integration'
      : 'React Native, TypeScript, React, and cloud-backed backend integration'
  }
  if (/devops|sre|platform|cloud engineer|infrastructure|ci\/cd/.test(t)) {
    return language === 'de'
      ? 'AWS, Docker, CI/CD, Java Spring Boot und produktionsnahe Automatisierung'
      : 'AWS, Docker, CI/CD, Java Spring Boot, and production automation'
  }
  if (/java|spring|backend|microservice/.test(t)) {
    return language === 'de'
      ? 'Java Spring Boot Microservices, REST APIs, PostgreSQL und AWS'
      : 'Java Spring Boot microservices, REST APIs, PostgreSQL, and AWS'
  }
  return language === 'de'
    ? 'Java Spring Boot, React/TypeScript, AWS und Full-Stack-Delivery'
    : 'Java Spring Boot, React/TypeScript, AWS, and full-stack delivery'
}

function companyContributionPhrase(
  job: Job,
  description: string,
  language: CoverLetterLanguage,
): string {
  const t = postingText(job.title, description)
  const company = job.company

  if (/autonomous|self-driving|autonomes fahren|fahrassistenz|adas/.test(t)) {
    return language === 'de'
      ? `die Entwicklung assistierter Fahrfunktionen und Fahrzeugsoftware bei ${company}`
      : `${company}'s work on driver-assistance and in-vehicle software`
  }
  if (/ai\b|machine learning|ml engineer|genai|deep learning|\bki\b/.test(t)) {
    return language === 'de'
      ? `technische KI- und Softwarearbeit bei ${company}`
      : `${company}'s software and AI engineering work`
  }
  if (/cloud|aws|azure|gcp|infrastructure/.test(t)) {
    return language === 'de'
      ? `der Cloud- und Plattformentwicklung bei ${company}`
      : `${company}'s cloud and platform engineering goals`
  }
  if (/recruit|talent|hr tech|bewerb/.test(t)) {
    return language === 'de'
      ? `den digitalen Recruiting- und Talent-Produkten von ${company}`
      : `${company}'s digital recruiting and talent products`
  }
  if (/mobile|app entwicklung|react native/.test(t)) {
    return language === 'de'
      ? `der mobilen Produktentwicklung bei ${company}`
      : `${company}'s mobile product engineering`
  }

  return language === 'de'
    ? `der Position „${job.title}“ bei ${company}`
    : `the ${job.title} opportunity at ${company}`
}

/**
 * Opening body paragraph — always first after the greeting.
 * Not counted in the OpenAI 250–350 word budget for paragraphs 2–4.
 */
export function buildIntroParagraph(
  job: Job,
  description: string,
  language: CoverLetterLanguage,
): string {
  const stack = stackPhraseForRole(job.title, description, language)
  const contribution = companyContributionPhrase(job, description, language)

  if (language === 'de') {
    return `Ich bin Software Engineer mit über vier Jahren Erfahrung in Backend- und Full-Stack-Entwicklung, derzeit bei OKIT GmbH in Deutschland. Schwerpunkte: ${stack}. Ich würde die Gelegenheit begrüßen, zu ${contribution} beizutragen.`
  }

  return `I am a software engineer with more than four years of experience in backend and full-stack development, currently at OKIT GmbH in Germany. My focus areas include ${stack}. I would welcome the opportunity to contribute to ${contribution}.`
}

/** Remove a duplicate self-intro if the model wrote one anyway. */
export function stripLeadingIntroParagraph(body: string, language: CoverLetterLanguage): string {
  const parts = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return body

  const first = parts[0]
  const isIntro =
    language === 'de'
      ? /^ich bin software engineer/i.test(first) || /^als software engineer/i.test(first)
      : /^i am a software engineer/i.test(first) || /^i am a software developer/i.test(first)

  if (isIntro) return parts.slice(1).join('\n\n')
  return body.trim()
}

export function combineIntroWithBody(intro: string, restBody: string, language: CoverLetterLanguage): string {
  const rest = stripLeadingIntroParagraph(restBody, language)
  if (!rest) return intro
  return `${intro}\n\n${rest}`
}
