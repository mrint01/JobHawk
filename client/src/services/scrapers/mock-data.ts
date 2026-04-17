import { subHours, subDays } from 'date-fns'
import type { Job, Platform } from '../../types'
import { nanoid } from '../nanoid'

const COMPANIES = [
  'SAP SE', 'Siemens AG', 'Deutsche Telekom', 'BMW Group', 'Bosch GmbH',
  'Volkswagen AG', 'Allianz SE', 'BASF SE', 'Bayer AG', 'Daimler AG',
  'Zalando SE', 'Delivery Hero', 'HelloFresh', 'AUTO1 Group', 'Trivago',
  'ING Deutschland', 'Commerzbank', 'Deutsche Bank', 'Lufthansa', 'Adidas',
  'Otto GmbH', 'Metro AG', 'Rewe Group', 'Lidl Digital', 'Aldi', 'Henkel',
]

const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Remote', 'Hybrid']

const DESCRIPTIONS = [
  'Join our dynamic team and help shape the future of digital transformation.',
  'We are looking for a passionate professional to join our growing team.',
  'Exciting opportunity to work on cutting-edge technology in a collaborative environment.',
  'Be part of an international team that values innovation and continuous learning.',
  'Work on high-impact projects that affect millions of users across Europe.',
]

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomDate(maxHoursAgo = 120): string {
  const hoursAgo = Math.floor(Math.random() * maxHoursAgo)
  if (hoursAgo < 24) return subHours(new Date(), hoursAgo).toISOString()
  return subDays(new Date(), Math.floor(hoursAgo / 24)).toISOString()
}

function linkedinUrl(id: string) {
  return `https://www.linkedin.com/jobs/view/${id}`
}

function stepstonUrl(title: string, id: string) {
  const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  return `https://www.stepstone.de/stellenangebote--${slug}-${id}.html`
}

function xingUrl(title: string, id: string) {
  const slug = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  return `https://www.xing.com/jobs/${slug}-${id}`
}

export function generateMockJobs(
  platform: Platform,
  searchTitle: string,
  searchLocation: string,
  count = 10,
): Job[] {
  const titles = [
    searchTitle,
    `Senior ${searchTitle}`,
    `Junior ${searchTitle}`,
    `Lead ${searchTitle}`,
    `${searchTitle} Manager`,
    `${searchTitle} Engineer`,
    `${searchTitle} Specialist`,
    `Principal ${searchTitle}`,
    `Staff ${searchTitle}`,
    `${searchTitle} Consultant`,
  ]

  return Array.from({ length: count }, () => {
    const id = nanoid()
    const title = randomFrom(titles)
    const company = randomFrom(COMPANIES)
    const postedDate = randomDate(96) // within last 4 days

    let url = ''
    if (platform === 'linkedin') url = linkedinUrl(id)
    else if (platform === 'stepstone') url = stepstonUrl(title, id)
    else url = xingUrl(title, id)

    return {
      id,
      title,
      company,
      location: searchLocation || randomFrom(['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne']),
      platform,
      url,
      postedDate,
      description: randomFrom(DESCRIPTIONS),
      jobType: randomFrom(JOB_TYPES),
      scrapedAt: new Date().toISOString(),
      status: 'new' as const,
    }
  })
}
