/**
 * Pull explicit technologies & themes from a job description
 * so OpenAI must address what the posting actually asks for.
 */

export interface PostingRequirement {
  label: string
  howCandidateMatches: string
}

const TECH_RULES: Array<{
  label: string
  patterns: RegExp[]
  matchEn: string
  matchDe: string
}> = [
  {
    label: 'Angular',
    patterns: [/\bangular\b/i],
    matchEn:
      'Angular is on my CV; I have built production UIs with React/TypeScript (JobHawk, OKIT client projects, StartNow SaaS) and apply the same component-driven patterns in Angular.',
    matchDe:
      'Angular steht in meinem CV; produktive UIs habe ich mit React/TypeScript (JobHawk, OKIT-Kundenprojekte, StartNow SaaS) umgesetzt—dieselben komponentenbasierten Muster übertrage ich auf Angular.',
  },
  {
    label: 'TypeScript',
    patterns: [/\btypescript\b/i, /\btype script\b/i],
    matchEn:
      'TypeScript in personal and product work: JobHawk (React/TypeScript + Express), AI Support Ticket Assistant (NestJS + React/TypeScript), and Apartment Listing Automation (TypeScript/Node.js + Playwright).',
    matchDe:
      'TypeScript in Eigen- und Produktprojekten: JobHawk (React/TypeScript + Express), AI Support Ticket Assistant (NestJS + React/TypeScript) und Apartment Listing Automation (TypeScript/Node.js + Playwright).',
  },
  {
    label: 'React',
    patterns: [/\breact\.?js\b/i, /\breact\b/i],
    matchEn: 'React.js across OKIT client delivery, StartNow SaaS, and JobHawk (TypeScript + Vite).',
    matchDe: 'React.js in OKIT-Kundenprojekten, StartNow SaaS und JobHawk (TypeScript + Vite).',
  },
  {
    label: 'Java / Spring Boot',
    patterns: [/\bjava\b/i, /\bspring boot\b/i, /\bspring\b/i],
    matchEn:
      'Java Spring Boot microservices at OKIT (~40% backend performance gain, 50k+ daily users); Oracle Java 8 OCA.',
    matchDe:
      'Java-Spring-Boot-Microservices bei OKIT (~40 % Performance-Gewinn, 50k+ Nutzer/Tag); Oracle Java 8 OCA.',
  },
  {
    label: 'MapLibre / Mapbox',
    patterns: [/\bmaplibre\b/i, /\bmapbox\b/i, /\bmap box\b/i],
    matchEn:
      'MapLibre/Mapbox are a focused ramp-up for me; my strength is TypeScript/React web apps and integrating third-party APIs in full-stack delivery.',
    matchDe:
      'MapLibre/Mapbox würde ich gezielt aufbauen; meine Stärke liegt in TypeScript/React-Web-Apps und der Integration von Drittanbieter-APIs im Full-Stack.',
  },
  {
    label: 'Node.js',
    patterns: [/\bnode\.?js\b/i, /\bnodejs\b/i],
    matchEn: 'Node.js/Express in JobHawk and StartNow; NestJS in my personal AI Ticket Assistant project.',
    matchDe: 'Node.js/Express in JobHawk und StartNow; NestJS im persönlichen AI Ticket Assistant Projekt.',
  },
  {
    label: 'Web applications',
    patterns: [/web-based application/i, /webanwendung/i, /web application/i],
    matchEn: 'End-to-end web applications at OKIT, StartNow, and in personal projects (JobHawk, ticket assistant).',
    matchDe: 'End-to-End-Webanwendungen bei OKIT, StartNow und in Eigenprojekten (JobHawk, Ticket Assistant).',
  },
  {
    label: 'Software architecture',
    patterns: [/software architecture/i, /architektur/i, /architectural specification/i],
    matchEn: 'Architecture ownership on OKIT microservices and full-stack products; documentation and subsystem integration in Agile teams.',
    matchDe: 'Architekturverantwortung bei OKIT-Microservices und Full-Stack-Produkten; Dokumentation und Subsystem-Integration in Agile-Teams.',
  },
  {
    label: 'Testing & quality',
    patterns: [/testing of software/i, /test coverage/i, /\btesting\b/i, /qualitätssicherung/i],
    matchEn: '15+ Python test automations at OKIT (90% coverage in one week); CI/CD on GitLab and GitHub Actions.',
    matchDe: '15+ Python-Testautomatisierungen bei OKIT (90 % Coverage in einer Woche); CI/CD mit GitLab und GitHub Actions.',
  },
  {
    label: 'UX / UI collaboration',
    patterns: [/ux designer/i, /user-friendly interface/i, /benutzeroberfläche/i, /ui design/i],
    matchEn: 'Close collaboration with product and design at OKIT and StartNow on usable interfaces and admin dashboards.',
    matchDe: 'Enge Zusammenarbeit mit Product und Design bei OKIT und StartNow an nutzbaren Oberflächen und Admin-Dashboards.',
  },
  {
    label: 'System integration',
    patterns: [/system integration/i, /integration of software/i, /subsystem/i, /systemintegration/i],
    matchEn: 'Integrating services and subsystems across microservices, APIs, and multi-platform automation (JobHawk aggregators).',
    matchDe: 'Integration von Services und Subsystemen über Microservices, APIs und Multi-Plattform-Automation (JobHawk).',
  },
  {
    label: 'AI / ML',
    patterns: [/\bai\b/i, /machine learning/i, /\bml\b/i, /openai/i, /\bki\b/i],
    matchEn:
      'AI-enhanced features at OKIT; personal AI Support Ticket Assistant (OpenAI API, NestJS, Spring Boot)—not an OKIT product.',
    matchDe:
      'KI-Funktionen bei OKIT; persönliches AI Support Ticket Assistant (OpenAI API, NestJS, Spring Boot)—kein OKIT-Produkt.',
  },
]

export function extractPostingRequirements(
  description: string,
  language: 'en' | 'de',
): PostingRequirement[] {
  if (!description || description.length < 40) return []

  const found: PostingRequirement[] = []
  const seen = new Set<string>()

  for (const rule of TECH_RULES) {
    if (!rule.patterns.some((p) => p.test(description))) continue
    if (seen.has(rule.label)) continue
    seen.add(rule.label)
    found.push({
      label: rule.label,
      howCandidateMatches: language === 'de' ? rule.matchDe : rule.matchEn,
    })
  }

  return found
}

export function formatRequirementsForPrompt(requirements: PostingRequirement[]): string {
  if (requirements.length === 0) {
    return '(No specific technologies detected—use the full job description text carefully.)'
  }
  return requirements
    .map((r) => `- ${r.label}: ${r.howCandidateMatches}`)
    .join('\n')
}

/** True when stored text likely misses profile/tasks sections. */
export function descriptionLooksIncomplete(description: string): boolean {
  const d = description.trim()
  if (d.length < 350) return true
  const hasProfile = /profile|qualification|anforderung|requirements|typescript|angular|tasks|aufgaben/i.test(d)
  return !hasProfile
}
