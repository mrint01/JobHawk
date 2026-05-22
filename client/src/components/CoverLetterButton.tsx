import { useState } from 'react'
import { ScrollText } from 'lucide-react'
import type { Job } from '../types'
import { useApp } from '../context/AppContext'
import {
  generateCoverLetterApi,
  downloadCoverLetterBlob,
  type CoverLetterLanguage,
} from '../services/api'
import CoverLetterLanguageModal from './CoverLetterLanguageModal'

interface Props {
  job: Job
}

function triggerPdfDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.pdf') ? filename : `${filename.replace(/\.[^.]+$/, '')}.pdf`
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function CoverLetterButton({ job }: Props) {
  const { appState, addToast } = useApp()
  const [modalOpen, setModalOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatingLang, setGeneratingLang] = useState<CoverLetterLanguage | null>(null)

  async function handleSelect(language: CoverLetterLanguage) {
    setGenerating(true)
    setGeneratingLang(language)
    try {
      const result = await generateCoverLetterApi(job.id, language, appState.userId)
      if (!result.ok || !result.data) {
        addToast(result.error ?? 'Cover letter generation failed', 'error')
        return
      }

      const pdfBlob = await downloadCoverLetterBlob(result.data.id, appState.userId)
      if (!pdfBlob) {
        addToast('Letter saved but PDF download failed — try again from history', 'error')
        return
      }

      triggerPdfDownload(pdfBlob, result.data.filename)
      addToast(
        language === 'de'
          ? 'Anschreiben als PDF erstellt und heruntergeladen.'
          : 'Cover letter PDF generated and downloaded.',
        'success',
      )
      setModalOpen(false)
    } catch {
      addToast('Network error while generating cover letter', 'error')
    } finally {
      setGenerating(false)
      setGeneratingLang(null)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        title="Generate tailored cover letter (PDF)"
        aria-label="Generate cover letter PDF"
        className="p-1 rounded-lg text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
      >
        <ScrollText className="w-4 h-4" />
      </button>

      {modalOpen && (
        <CoverLetterLanguageModal
          title={job.title}
          company={job.company}
          generating={generating}
          generatingLang={generatingLang}
          onSelect={handleSelect}
          onClose={() => !generating && setModalOpen(false)}
        />
      )}
    </>
  )
}

/** Re-download a saved cover letter as PDF. */
export async function redownloadCoverLetter(
  letterId: string,
  filename: string,
  userId: string,
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void,
): Promise<void> {
  const blob = await downloadCoverLetterBlob(letterId, userId)
  if (!blob) {
    addToast('Could not download cover letter', 'error')
    return
  }
  triggerPdfDownload(blob, filename)
}
