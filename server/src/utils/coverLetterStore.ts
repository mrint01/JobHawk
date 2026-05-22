import { supabase } from './supabase'

export type CoverLetterLanguage = 'en' | 'de'

export interface CoverLetterRecord {
  id: string
  userId: string
  jobId: string
  language: CoverLetterLanguage
  content: string
  filename: string
  createdAt: string
  updatedAt: string
}

function rowToRecord(row: Record<string, unknown>): CoverLetterRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    jobId: row.job_id as string,
    language: row.language as CoverLetterLanguage,
    content: row.content as string,
    filename: row.filename as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export async function upsertCoverLetter(
  userId: string,
  jobId: string,
  language: CoverLetterLanguage,
  content: string,
  filename: string,
): Promise<CoverLetterRecord> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('cover_letters')
    .upsert(
      {
        user_id: userId,
        job_id: jobId,
        language,
        content,
        filename,
        updated_at: now,
      },
      { onConflict: 'user_id,job_id,language' },
    )
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to save cover letter')
  }
  return rowToRecord(data)
}

export async function readCoverLetterById(
  userId: string,
  id: string,
): Promise<CoverLetterRecord | null> {
  const { data } = await supabase
    .from('cover_letters')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  return data ? rowToRecord(data) : null
}

export async function listCoverLettersForJob(
  userId: string,
  jobId: string,
): Promise<CoverLetterRecord[]> {
  const { data } = await supabase
    .from('cover_letters')
    .select('*')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .order('updated_at', { ascending: false })
  return (data ?? []).map(rowToRecord)
}
