import { getBrowserPage } from './browser'
import type { CoverLetterLanguage } from './coverLetterStore'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function contentToHtml(content: string, language: CoverLetterLanguage): string {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const body =
    paragraphs.length > 0
      ? paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`).join('')
      : `<p>${escapeHtml(content)}</p>`

  const title = language === 'de' ? 'Anschreiben' : 'Cover Letter'

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8"/>
  <style>
    @page { size: A4; margin: 22mm 20mm; }
    body {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #111;
    }
    p { margin: 0 0 12pt 0; }
    p:first-child { font-weight: 600; font-size: 11.5pt; margin-bottom: 14pt; }
  </style>
  <title>${title}</title>
</head>
<body>${body}</body>
</html>`
}

/** Render plain cover letter text as a professional A4 PDF (via headless Chromium). */
export async function coverLetterTextToPdfBuffer(
  content: string,
  language: CoverLetterLanguage,
): Promise<Buffer> {
  const page = await getBrowserPage(true)
  try {
    await page.setContent(contentToHtml(content, language), { waitUntil: 'networkidle0', timeout: 15_000 })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '22mm', bottom: '22mm', left: '20mm', right: '20mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close().catch(() => undefined)
  }
}
