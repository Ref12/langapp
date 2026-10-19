import { db } from '../database'
import { practiceEvent } from '../backup/journal'
import { recordJournal } from '../backup/journal-store'
import { practiceHistoryEntrySchema, type SpeechBlock, type SpeechRate } from './contracts'
import type { PracticePlaylistItem } from './practice-chain-contracts'

export async function rememberPracticePhrase(phrase: SpeechBlock, rate: SpeechRate, ends?: number[], items?: PracticePlaylistItem[]): Promise<void> {
  const entry = practiceHistoryEntrySchema.parse({
    text: phrase.text, phrase, rate, lastOpenedAt: Date.now(),
    ...(ends ? { chain: { text: phrase.text, ends, ...(items ? { items } : {}) } } : {}),
  })
  await db.transaction('rw', db.practiceHistory, db.journal, async () => {
    await db.practiceHistory.put(entry)
    await recordJournal(practiceEvent(entry.text, entry.lastOpenedAt))
  })
}
