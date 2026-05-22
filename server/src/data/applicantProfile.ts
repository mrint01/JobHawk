/**
 * Canonical applicant facts for cover letters — sourced from Sfar Hatem resume.
 * Keep in sync when CV changes.
 */
export const APPLICANT_PROFILE = {
  fullName: 'Hatem Sfar',
  firstName: 'Hatem',
  lastName: 'Sfar',
  headline: 'Software Engineer – Java | Spring Boot | React | AWS',
  email: 'sfarhatem7@yahoo.com',
  phone: '+49 157 35446974',
  location: 'Cologne, Germany',
  linkedIn: 'https://www.linkedin.com/in/sfar-hatem',
  github: 'https://github.com/mrint01',
  noticePeriod: '1 month',
  preferredStart: 'Flexible',
  languages: {
    english: 'Fluent',
    german: 'Intermediate (A2 – actively improving)',
    french: 'Intermediate',
    arabic: 'Native',
  },
  summary:
    'Software Engineer with 4+ years of experience building scalable backend and full-stack applications using Java, Spring Boot, React, and AWS. Strong background in microservices, SaaS platforms, and cloud deployments, with proven delivery in Agile/SCRUM environments.',
  coreSkills: [
    'Java, Spring Boot, microservices, REST APIs',
    'React.js, React Native, TypeScript',
    'PostgreSQL, MongoDB',
    'AWS (EC2, S3, RDS), Docker, CI/CD',
    'Node.js, Python (automation & testing)',
  ],
  experience: [
    {
      company: 'OKIT GmbH',
      location: 'Germany',
      role: 'Software Engineer',
      period: 'Jan 2023 – Present',
      highlights: [
        'Lead developer on 3 major client projects (full-stack web & mobile)',
        'Java Spring Boot microservices — ~40% backend performance improvement for 50k+ daily users',
        'React Native app from architecture to deployment',
        'AI-enhanced decision features; 15+ Python test automations (90% coverage in one week)',
      ],
    },
    {
      company: 'StartNow',
      location: 'Tunisia',
      role: 'Software Engineer',
      period: 'Sep 2021 – Nov 2022',
      highlights: [
        'Full-stack SaaS recruitment platform (React, Node.js, MongoDB)',
        'AI-based candidate matching; live video interviews',
        'Docker, AWS, GitLab CI deployments',
      ],
    },
  ],
  education: [
    'Engineering Degree in Computer Science, TEK-UP Tunisia (2019–2022)',
    "Bachelor's in Computer Networking, ISMAIK Tunisia (2016–2019)",
  ],
  certifications: [
    'AWS Certified Solutions Architect – Associate (in progress)',
    'Oracle Certified Associate – Java 8',
    'Spring Boot & REST Controllers – Coursera',
  ],
  notableProjects: [
    'JobHawk — multi-source job search & application tracker (React/TypeScript, Express)',
    'AI-Powered Support Ticket Assistant — NestJS, Spring Boot, OpenAI integration',
    'Apartment Listing Automation — TypeScript/Node.js, Playwright; monitors WG-Gesucht, Immowelt, Immoscout24; ~40% higher response vs manual applications',
  ],
} as const

/** Subtitle under the name in the letter header — tuned to the posting when relevant. */
export function headlineForJobPosting(jobTitle: string, description: string): string {
  const text = `${jobTitle}\n${description}`.toLowerCase()
  if (/ai\b|llm|machine learning|ml engineer|intelligent|autonomous|adas|genai|deep learning|\bki\b/.test(text)) {
    return 'Software Engineer | AI Systems | Java | Spring Boot | React | AWS'
  }
  if (/\bangular\b/.test(text)) {
    return 'Software Engineer | Angular | TypeScript | React | Java'
  }
  if (/full.?stack|typescript|react|frontend|node|nestjs/.test(text)) {
    return 'Software Engineer | Full-Stack | TypeScript | React | Java'
  }
  if (/mobile|react native|ios|android/.test(text)) {
    return 'Software Engineer | React Native | TypeScript | Full-Stack'
  }
  if (/devops|sre|platform engineer|cloud engineer|infrastructure/.test(text)) {
    return 'Software Engineer | AWS | Docker | CI/CD | Java'
  }
  if (/java|spring|backend|microservice/.test(text)) {
    return 'Software Engineer | Java | Spring Boot | Microservices | AWS'
  }
  return APPLICANT_PROFILE.headline
}

/** Proof points linked to job-posting topics — used for tailored cover letters. */
export const CV_EVIDENCE = [
  {
    id: 'ai',
    topics: [
      'ai', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'genai', 'generative',
      'openai', 'gpt', 'nlp', 'deep learning', 'intelligent', 'ki ', ' künstliche',
    ],
    en: {
      hook: 'hands-on experience shipping AI features in production, not only prototypes',
      proof:
        'At OKIT GmbH I contributed to AI-enhanced decision-making in intelligent systems. Separately, in my personal AI-Powered Support Ticket Assistant (React/TypeScript, NestJS, Spring Boot, PostgreSQL) I integrated the OpenAI API to summarize tickets, prioritize them, suggest responses, and classify issues—JWT auth, microservices, Docker, and AWS deployment.',
    },
    de: {
      hook: 'praktische Erfahrung mit KI-Funktionen in produktiven Systemen',
      proof:
        'Bei OKIT GmbH habe ich an KI-gestützten Entscheidungsfunktionen mitgewirkt. In meinem persönlichen AI-Powered Support Ticket Assistant (React/TypeScript, NestJS, Spring Boot, PostgreSQL) habe ich die OpenAI-API für Zusammenfassungen, Priorisierung, Antwortvorschläge und Klassifikation integriert—JWT-Auth, Microservices, Docker, AWS.',
    },
  },
  {
    id: 'angular',
    topics: ['angular', 'angularjs'],
    en: {
      hook: 'frontend delivery aligned with Angular-style enterprise web apps',
      proof:
        'Angular is on my CV; in production I have shipped React/TypeScript UIs at OKIT (client projects), StartNow, and JobHawk—component architecture, TypeScript, and API integration translate directly to Angular development.',
    },
    de: {
      hook: 'Frontend-Erfahrung passend zu Angular-basierten Enterprise-Web-Apps',
      proof:
        'Angular steht in meinem CV; produktiv habe ich React/TypeScript-UIs bei OKIT (Kundenprojekte), StartNow und JobHawk geliefert—Komponentenarchitektur, TypeScript und API-Integration übertragen sich direkt auf Angular.',
    },
  },
  {
    id: 'typescript',
    topics: [
      'typescript', 'type script', 'javascript', 'node.js', 'nodejs', 'nestjs', 'express.js', 'express',
      'full stack', 'fullstack', 'full-stack', 'playwright', 'puppeteer', 'automation',
    ],
    en: {
      hook: 'proven TypeScript/Node.js delivery—from SaaS products to production automations you can ship fast',
      proof:
        'In TypeScript and Node.js I have shipped JobHawk (React/TypeScript + Express), my personal AI Support Ticket Assistant (NestJS + React/TypeScript), and Apartment Listing Automation (TypeScript/Node.js + Playwright)—reliable full-stack and automation systems end to end.',
    },
    de: {
      hook: 'nachweisbare TypeScript/Node.js-Delivery—von SaaS bis zu produktionsreifen Automationen',
      proof:
        'In TypeScript und Node.js habe ich JobHawk (React/TypeScript + Express), meinen persönlichen AI Support Ticket Assistant (NestJS + React/TypeScript) und Apartment Listing Automation (TypeScript/Node.js + Playwright) umgesetzt—Full-Stack- und Automations-Kompetenz aus einer Hand.',
    },
  },
  {
    id: 'java',
    topics: ['java', 'spring boot', 'spring', 'jvm', 'backend', 'microservice', 'microservices'],
    en: {
      hook: 'deep Java/Spring Boot microservices experience at scale',
      proof:
        'At OKIT GmbH I designed Java Spring Boot microservices and improved backend transaction performance by ~40% on systems serving 50,000+ daily users. I hold Oracle Certified Associate – Java 8 and Spring Boot training (Coursera); Spring Boot is also part of my personal AI Ticket Assistant project.',
    },
    de: {
      hook: 'fundierte Java/Spring-Boot-Microservice-Erfahrung im produktiven Betrieb',
      proof:
        'Bei OKIT GmbH habe ich Java-Spring-Boot-Microservices entwickelt und die Backend-Performance um ca. 40 % bei Systemen mit über 50.000 täglichen Nutzern verbessert. Oracle Java 8 OCA; Spring Boot auch im persönlichen AI Ticket Assistant Projekt.',
    },
  },
  {
    id: 'react',
    topics: ['react', 'react.js', 'reactjs', 'frontend', 'front-end', 'ui', 'spa'],
    en: {
      hook: 'React expertise from SaaS products to personal production apps',
      proof:
        'I led full-stack delivery with React.js at OKIT (client projects) and built StartNow’s SaaS recruitment platform in React with Node.js and MongoDB—including live video interviews and an admin dashboard. JobHawk is my React (TypeScript) + Tailwind product for job search and application tracking.',
    },
    de: {
      hook: 'React-Erfahrung von SaaS-Produkten bis zu eigenen Production-Apps',
      proof:
        'Bei OKIT habe ich Full-Stack-Lösungen mit React.js in Kundenprojekten verantwortet; bei StartNow eine SaaS-Recruiting-Plattform mit React, Node.js und MongoDB—inkl. Live-Video-Interviews und Admin-Dashboard. JobHawk ist meine React-(TypeScript)-Anwendung für Jobsuche und Bewerbungs-Tracking.',
    },
  },
  {
    id: 'mobile',
    topics: ['react native', 'mobile', 'ios', 'android', 'app development'],
    en: {
      hook: 'end-to-end mobile delivery with React Native',
      proof:
        'At OKIT GmbH I developed a React Native mobile application from architecture through deployment as part of multi-project lead responsibilities.',
    },
    de: {
      hook: 'Mobile Delivery mit React Native von der Architektur bis zum Release',
      proof:
        'Bei OKIT GmbH habe ich eine React-Native-App von der Architektur bis zum Deployment entwickelt—als Teil meiner Verantwortung als Lead Developer in mehreren Projekten.',
    },
  },
  {
    id: 'aws',
    topics: ['aws', 'amazon web services', 'ec2', 's3', 'rds', 'cloud', 'devops'],
    en: {
      hook: 'AWS deployments and cloud-native delivery',
      proof:
        'I deploy with AWS (EC2, S3, RDS) and Docker—at StartNow via Docker/AWS/GitLab CI, and on personal projects (AI Ticket Assistant, JobHawk) with containerized services and GitHub Actions pipelines. AWS Solutions Architect Associate (in progress).',
    },
    de: {
      hook: 'AWS-Deployments und cloudnahe Auslieferung',
      proof:
        'Ich deploye mit AWS (EC2, S3, RDS) und Docker—bei StartNow über Docker/AWS/GitLab CI, in Eigenprojekten (AI Ticket Assistant, JobHawk) mit Containerisierung und GitHub Actions. AWS Solutions Architect Associate (in progress).',
    },
  },
  {
    id: 'data',
    topics: ['postgresql', 'postgres', 'sql', 'mongodb', 'database', 'datenbank'],
    en: {
      hook: 'solid relational and document database experience',
      proof:
        'I work with PostgreSQL (OKIT client stacks, AI Ticket Assistant, JobHawk store) and MongoDB (StartNow SaaS platform), designing data models for high-traffic application flows.',
    },
    de: {
      hook: 'Erfahrung mit relationalen und dokumentenbasierten Datenbanken',
      proof:
        'Ich arbeite mit PostgreSQL (Kundenprojekte OKIT, AI Ticket Assistant, JobHawk) und MongoDB (StartNow SaaS)—inkl. Datenmodellierung für anwendungsnahe, skalierbare Flows.',
    },
  },
  {
    id: 'recruitment',
    topics: [
      'recruit', 'hr', 'talent', 'hiring', 'applicant', 'bewerb', 'stellen', 'saas',
      'platform', 'marketplace',
    ],
    en: {
      hook: 'direct domain experience in recruitment SaaS',
      proof:
        'At StartNow I built a full-stack SaaS recruitment platform with AI-based candidate matching, live video interviews, automated job postings (Facebook Graph API), and admin tooling for CVs, offers, and interviews—highly relevant to talent and workflow products.',
    },
    de: {
      hook: 'direkte Domänenerfahrung in Recruiting-SaaS',
      proof:
        'Bei StartNow habe ich eine SaaS-Recruiting-Plattform mit KI-basiertem Matching, Live-Video-Interviews, automatisierter Stellenveröffentlichung (Facebook Graph API) und Admin-Funktionen für CVs, Angebote und Interviews umgesetzt.',
    },
  },
  {
    id: 'testing',
    topics: ['test', 'qa', 'quality', 'automation', 'pytest', 'junit', 'tdd'],
    en: {
      hook: 'pragmatic quality focus with automated testing',
      proof:
        'I created 15+ automated test cases in Python at OKIT, raising coverage to 90% within one week, and use CI/CD (GitLab, GitHub Actions) with unit/integration tests on personal full-stack projects.',
    },
    de: {
      hook: 'pragmatischer Qualitätsfokus mit Testautomatisierung',
      proof:
        'Bei OKIT habe ich 15+ automatisierte Python-Tests erstellt und die Coverage innerhalb einer Woche auf 90 % erhöht; in Eigenprojekten setze ich CI/CD (GitLab, GitHub Actions) mit Unit-/Integrationstests ein.',
    },
  },
  {
    id: 'agile',
    topics: ['agile', 'scrum', 'kanban', 'cross-functional', 'team'],
    en: {
      hook: 'proven collaboration in Agile/SCRUM teams',
      proof:
        'I work closely with product, QA, and design in Agile/SCRUM environments—at OKIT on client delivery and at StartNow on a fast-moving SaaS roadmap.',
    },
    de: {
      hook: 'nachweisbare Zusammenarbeit in Agile/SCRUM-Teams',
      proof:
        'Ich arbeite eng mit Product, QA und Design in Agile/SCRUM—bei OKIT in Kundenprojekten und bei StartNow auf einer schnellen SaaS-Roadmap.',
    },
  },
] as const

export function formatProfileForPrompt(): string {
  const p = APPLICANT_PROFILE
  const exp = p.experience
    .map(
      (e) =>
        `${e.role} @ ${e.company} (${e.location}, ${e.period}):\n${e.highlights.map((h) => `  - ${h}`).join('\n')}`,
    )
    .join('\n\n')
  const evidence = CV_EVIDENCE.map(
    (e) => `[${e.id}] ${e.en.proof}`,
  ).join('\n')
  return [
    `Name: ${p.fullName}`,
    `Headline: ${p.headline}`,
    `Contact: ${p.email} | ${p.phone} | ${p.location}`,
    `LinkedIn: ${p.linkedIn} | GitHub: ${p.github}`,
    `Availability: notice period ${p.noticePeriod}, start ${p.preferredStart}`,
    '',
    `Summary: ${p.summary}`,
    '',
    `Core skills: ${p.coreSkills.join('; ')}`,
    '',
    'Experience:',
    exp,
    '',
    `Education: ${p.education.join('; ')}`,
    `Certifications: ${p.certifications.join('; ')}`,
    `Projects: ${p.notableProjects.join('; ')}`,
    '',
    'Evidence blocks (use those matching the job description):',
    evidence,
  ].join('\n')
}
