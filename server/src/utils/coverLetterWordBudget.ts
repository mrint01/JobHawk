/** Word limits for text between greeting and sign-off (intro + body paragraphs). */
export const BODY_WORD_MIN = 250
export const BODY_WORD_MAX = 350

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export function maxTokensForWordBudget(wordMax: number): number {
  // The model now writes the whole body, so 350 words must fit comfortably.
  return Math.min(700, Math.ceil(wordMax * 1.45))
}

/** Hard cap so greeting→sign-off block stays ≤350 words. */
export function enforceBodyWordLimit(body: string, maxWords: number = BODY_WORD_MAX): string {
  if (countWords(body) <= maxWords) return body.trim()

  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const kept: string[] = []
  let total = 0

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).filter(Boolean)
    if (total + paraWords.length <= maxWords) {
      kept.push(para)
      total += paraWords.length
      continue
    }
    const room = maxWords - total
    if (room > 15) {
      kept.push(paraWords.slice(0, room).join(' '))
    }
    break
  }

  return kept.join('\n\n')
}
