/**
 * File-based LinkedIn session persistence.
 *
 * Stores only the li_at token + metadata in server/data/linkedin-session.json.
 * The file survives server restarts but is lost on redeploy — run the capture
 * script again after each Railway redeploy.
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR  = path.join(__dirname, '..', '..', 'data')
const FILE_PATH = path.join(DATA_DIR, 'linkedin-session.json')

// Conservative TTL: 330 days (LinkedIn sessions last ~1 year)
const SESSION_TTL_MS = 330 * 24 * 60 * 60 * 1000

export interface LinkedInSessionFile {
  liAt:        string   // the raw li_at cookie value
  capturedAt:  string   // ISO timestamp of when the script ran
  username:    string
}

export function readLinkedInSessionFile(): LinkedInSessionFile | null {
  try {
    if (!fs.existsSync(FILE_PATH)) return null
    const parsed = JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8')) as LinkedInSessionFile
    if (!parsed?.liAt) return null
    return parsed
  } catch {
    return null
  }
}

export function writeLinkedInSessionFile(data: LinkedInSessionFile): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

export function deleteLinkedInSessionFile(): void {
  try { if (fs.existsSync(FILE_PATH)) fs.unlinkSync(FILE_PATH) } catch { /* ignore */ }
}

export function isLinkedInSessionExpired(session: LinkedInSessionFile): boolean {
  const capturedAt = new Date(session.capturedAt).getTime()
  if (isNaN(capturedAt)) return true
  return Date.now() > capturedAt + SESSION_TTL_MS
}
