import { db } from '../database'
import { practiceHistoryEntrySchema, type SpeechBlock, type SpeechRate } from './contracts'
import type { PracticePlaylistItem } from './practice-chain-contracts'

export async function rememberPracticePhrase(phrase: SpeechBlock, rate: SpeechRate, ends?: number[], items?: PracticePlaylistItem[]): Promise<void> {
  const entry = practiceHistoryEntrySchema.parse({
    text: phrase.text, phrase, rate, lastOpenedAt: Date.now(),
    ...(ends ? { chain: { text: phrase.text, ends, ...(items ? { items } : {}) } } : {}),
  })
  await db.practiceHistory.put(entry)
}
