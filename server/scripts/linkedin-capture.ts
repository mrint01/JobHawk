/**
 * JobHawk — LinkedIn session capture script.
 *
 * Run this LOCALLY (not on Railway) once to capture your LinkedIn session:
 *
 *   cd server
 *   npx tsx scripts/linkedin-capture.ts
 *
 *   # Or point to your deployed Railway backend:
 *   npx tsx scripts/linkedin-capture.ts --url https://your-app.up.railway.app
 *
 * What it does:
 *   1. Opens a real Chrome window on your machine
 *   2. Navigates to LinkedIn login
 *   3. You log in manually (handles CAPTCHA, 2FA — it's your real browser)
 *   4. Captures your li_at session token
 *   5. Sends it to the backend → saved to data/linkedin-session.json
 *   6. LinkedIn will show as "Connected" next time you click Connect in the app
 *
 * The session lasts ~1 year. Re-run if LinkedIn shows "Session expired".
 */
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin())

const cliArgs  = process.argv.slice(2)
const urlIdx   = cliArgs.indexOf('--url')
const BACKEND  = urlIdx !== -1 ? cliArgs[urlIdx + 1] : (process.env.BACKEND_URL ?? 'http://localhost:3001')

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════╗')
  console.log('║   JobHawk — LinkedIn Session Capture Tool   ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log(`\n  Backend: ${BACKEND}`)
  console.log('  Opening Chrome...\n')

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
    defaultViewport: null,
  })

  const [page] = await browser.pages()
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

  await page.goto('https://www.linkedin.com/login', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })

  console.log('  ✋  Please log in to LinkedIn in the browser window.')
  console.log('      Waiting up to 5 minutes...\n')

  try {
    await page.waitForFunction(
      () => {
        const href = window.location.href
        return (
          href.includes('/feed') ||
          href.includes('/mynetwork') ||
          (href.includes('linkedin.com') && !href.includes('/login') && !href.includes('/checkpoint'))
        )
      },
      { timeout: 5 * 60_000, polling: 1000 },
    )
  } catch {
    console.error('\n  ❌  Timed out waiting for login. Run the script again.')
    await browser.close()
    process.exit(1)
  }

  console.log('  ✅  Login detected — capturing session...')
  // Let companion cookies settle
  await new Promise<void>((r) => setTimeout(r, 2500))

  const cookies = await page.cookies('https://www.linkedin.com', 'https://linkedin.com')
  const liAt    = cookies.find((c) => c.name === 'li_at')

  if (!liAt?.value) {
    console.error('\n  ❌  Could not find li_at cookie. The login may not have finished.')
    console.error('      Try waiting a few seconds after the feed loads, then run again.')
    await browser.close()
    process.exit(1)
  }

  // Try to extract the display name from the page
  let username = 'linkedin-user'
  try {
    const name = await page.evaluate(() => {
      const selectors = [
        '.feed-identity-module__member-name',
        '.profile-nav-card__name',
        '[data-control-name="nav.settings_signout"] ~ span',
        '.t-16.t-black.t-bold',
      ]
      for (const s of selectors) {
        const el = document.querySelector(s)
        if (el?.textContent?.trim()) return el.textContent.trim()
      }
      return null
    })
    if (name) username = name
  } catch { /* ignore — username is cosmetic */ }

  console.log(`\n  Token   : ${liAt.value.slice(0, 24)}...`)
  console.log(`  Username: ${username}`)
  console.log(`\n  Sending to ${BACKEND}...`)

  let result: { ok: boolean; error?: string }
  try {
    const res = await fetch(`${BACKEND}/api/auth/linkedin/import-session`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ liAt: liAt.value, username }),
    })
    result = await res.json() as typeof result
  } catch (err) {
    console.error(`\n  ❌  Could not reach backend at ${BACKEND}`)
    console.error(`      Make sure the server is running.`)
    console.error(`      Error: ${err instanceof Error ? err.message : String(err)}`)
    await browser.close()
    process.exit(1)
  }

  if (result.ok) {
    console.log('\n  ✅  Session saved!')
    console.log('      Click "Connect" for LinkedIn in the app — it will show as Connected.\n')
  } else {
    console.error(`\n  ❌  Backend error: ${result.error}`)
  }

  await browser.close()
}

main().catch((err) => {
  console.error('\n❌ Script crashed:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
