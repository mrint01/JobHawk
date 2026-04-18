/**
 * Turn a raw li_at (from the Python capture script) into a full cookie jar
 * inside the same Firefox/Playwright instance used for LinkedIn scraping.
 */
import { getLinkedInFirefoxPage } from './linkedinFirefox'
import { playwrightCookiesToProtocol, protocolCookiesToPlaywright } from './linkedinPlaywrightCookies'
import { sanitizeLinkedInCookiesForReplay } from './linkedinCookies'
import {
  puppeteerCookiesToFileEntries,
  sessionFileToPuppeteerCookies,
  writeLinkedInSessionFile,
  type LinkedInSessionFile,
} from './linkedinSession'
import { saveSession } from './sessions'

const FEED_URL = 'https://www.linkedin.com/feed/'

function isLoginOrCheckpointUrl(url: string): boolean {
  const u = url.toLowerCase()
  return (
    u.includes('/login')
    || u.includes('/checkpoint')
    || u.includes('/challenge')
    || u.includes('/authwall')
  )
}

/**
 * Visit /feed with only li_at so LinkedIn issues companion cookies for this Firefox profile.
 */
export async function materializeLinkedInSessionFromLiAt(liAt: string, username: string): Promise<void> {
  const token = liAt.trim()
  if (!token) throw new Error('li_at is empty')

  const page = await getLinkedInFirefoxPage()
  try {
    await page.context().clearCookies()

    await page.context().addCookies(
      protocolCookiesToPlaywright(
        sanitizeLinkedInCookiesForReplay([
          {
            name: 'li_at',
            value: token,
            domain: '.linkedin.com',
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'Lax',
          },
        ]),
      ),
    )
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

    await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 55_000 })
    await new Promise((r) => setTimeout(r, 1200))

    const url = page.url()
    if (isLoginOrCheckpointUrl(url)) {
      throw new Error(
        'LinkedIn did not accept this li_at in Firefox (redirected to login/checkpoint). Run the capture script again.',
      )
    }

    const rawCookies = await page.context().cookies(['https://www.linkedin.com', 'https://www.linkedin.com/feed/'])
    const sanitized = playwrightCookiesToProtocol(rawCookies)
    const refreshed = sanitized.find((c) => c.name === 'li_at' && c.value.length > 0)?.value
    if (!refreshed) {
      throw new Error('Could not read li_at after feed load — session materialization failed.')
    }

    const filePayload: LinkedInSessionFile = {
      liAt: refreshed,
      username,
      capturedAt: new Date().toISOString(),
      jarVersion: 2,
      puppeteerCookies: puppeteerCookiesToFileEntries(sanitized),
    }
    writeLinkedInSessionFile(filePayload)

    saveSession('linkedin', {
      cookies: sessionFileToPuppeteerCookies(filePayload),
      loggedInAt: new Date(),
      username,
    })

    console.log(`[linkedin/bootstrap] materialized session in Firefox (${sanitized.length} cookies, user: ${username})`)
  } finally {
    await page.close().catch(() => undefined)
  }
}
