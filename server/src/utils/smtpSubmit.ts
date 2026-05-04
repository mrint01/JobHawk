import net from 'net'
import tls from 'tls'
import { randomBytes } from 'crypto'

/** Minimal SMTP submission (STARTTLS on 587 or TLS on 465). Gmail-compatible. */

type Sock = net.Socket | tls.TLSSocket

function createLineReader(sock: Sock) {
  let buf = ''
  return async function readResponse(): Promise<{ code: number; lines: string[] }> {
    const linesOut: string[] = []
    for (;;) {
      while (true) {
        const nl = buf.indexOf('\r\n')
        if (nl === -1) break
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 2)
        if (!line.length) continue
        linesOut.push(line)
        if (/^\d{3} /.test(line)) {
          return { code: parseInt(line.slice(0, 3), 10), lines: linesOut }
        }
      }
      const chunk = await new Promise<string>((resolve, reject) => {
        sock.once('data', (d: Buffer) => resolve(d.toString('utf8')))
        sock.once('error', reject)
      })
      buf += chunk
    }
  }
}

function writeLine(sock: Sock, line: string): void {
  sock.write(`${line}\r\n`)
}

function extractAddr(from: string): string {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim()
}

function escapeDataDot(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n').replace(/^\./gm, '..')
}

export async function sendMailViaSmtp(opts: {
  host: string
  port: number
  user?: string
  pass?: string
  from: string
  to: string
  subject: string
  text: string
  html?: string
}): Promise<void> {
  const port = opts.port
  const implicitTls = port === 465

  let sock: Sock

  if (implicitTls) {
    sock = tls.connect({ host: opts.host, port, servername: opts.host })
    await new Promise<void>((resolve, reject) => {
      sock.once('secureConnect', () => resolve())
      sock.once('error', reject)
    })
  } else {
    sock = net.createConnection({ host: opts.host, port })
    await new Promise<void>((resolve, reject) => {
      sock.once('connect', () => resolve())
      sock.once('error', reject)
    })
  }

  let readResponse = createLineReader(sock)

  try {
    await readResponse()

    writeLine(sock, 'EHLO jobhawk.local')
    await readResponse()

    if (!implicitTls) {
      writeLine(sock, 'STARTTLS')
      const st = await readResponse()
      if (st.code !== 220) throw new Error(`STARTTLS failed: ${st.lines.join(' | ')}`)

      const plainSock = sock as net.Socket
      sock = tls.connect({ socket: plainSock, host: opts.host, servername: opts.host })
      await new Promise<void>((resolve, reject) => {
        sock.once('secureConnect', () => resolve())
        sock.once('error', reject)
      })

      readResponse = createLineReader(sock)

      writeLine(sock, 'EHLO jobhawk.local')
      await readResponse()
    }

    const user = opts.user?.trim()
    const pass = opts.pass?.replace(/\s+/g, '')
    if (user && pass) {
      writeLine(sock, 'AUTH LOGIN')
      const c1 = await readResponse()
      if (c1.code !== 334) throw new Error(`AUTH LOGIN failed: ${c1.lines.join(' | ')}`)
      writeLine(sock, Buffer.from(user, 'utf8').toString('base64'))
      const c2 = await readResponse()
      if (c2.code !== 334) throw new Error(`AUTH user rejected: ${c2.lines.join(' | ')}`)
      writeLine(sock, Buffer.from(pass, 'utf8').toString('base64'))
      const c3 = await readResponse()
      if (c3.code !== 235) {
        const detail = c3.lines.join(' | ')
        const gmailHint =
          opts.host.toLowerCase().includes('gmail')
            ? ' Use an App Password (not your normal Gmail password): Google Account → Security → enable 2-Step Verification → App passwords → create one for “Mail”. Then set SMTP_USER to your full @gmail.com address and SMTP_PASS to that 16-character password.'
            : ''
        throw new Error(`AUTH failed: ${detail}.${gmailHint}`)
      }
    }

    const fromAddr = extractAddr(opts.from)
    writeLine(sock, `MAIL FROM:<${fromAddr}>`)
    const mf = await readResponse()
    if (mf.code !== 250) throw new Error(`MAIL FROM failed: ${mf.lines.join(' | ')}`)

    writeLine(sock, `RCPT TO:<${opts.to}>`)
    const rc = await readResponse()
    if (rc.code !== 250 && rc.code !== 251) throw new Error(`RCPT TO failed: ${rc.lines.join(' | ')}`)

    writeLine(sock, 'DATA')
    const dt = await readResponse()
    if (dt.code !== 354) throw new Error(`DATA failed: ${dt.lines.join(' | ')}`)

    const safeSubject = opts.subject.replace(/\r|\n/g, ' ')
    let mimeBody: string
    if (opts.html?.trim()) {
      const boundary = `----=_JobHawk_${randomBytes(16).toString('hex')}`
      const plain = escapeDataDot(opts.text)
      const html = escapeDataDot(opts.html.trim())
      mimeBody =
        `MIME-Version: 1.0\r\n` +
        `Content-Type: multipart/alternative; boundary="${boundary}"\r\n` +
        `\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain; charset=UTF-8\r\n` +
        `\r\n` +
        `${plain}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/html; charset=UTF-8\r\n` +
        `\r\n` +
        `${html}\r\n` +
        `--${boundary}--\r\n`
    } else {
      mimeBody =
        `MIME-Version: 1.0\r\n` +
        `Content-Type: text/plain; charset=UTF-8\r\n` +
        `\r\n` +
        `${escapeDataDot(opts.text)}\r\n`
    }

    const payload =
      `From: ${opts.from}\r\n` +
      `To: ${opts.to}\r\n` +
      `Subject: ${safeSubject}\r\n` +
      `${mimeBody}` +
      `.\r\n`

    sock.write(payload)
    const sent = await readResponse()
    if (sent.code !== 250) throw new Error(`Message rejected: ${sent.lines.join(' | ')}`)

    writeLine(sock, 'QUIT')
    await readResponse().catch(() => undefined)
  } finally {
    sock.end()
  }
}
