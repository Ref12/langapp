import { db } from '../database'
import { practiceEvent } from '../backup/journal'
import { recordJournal } from '../backup/journal-store'
import { practiceHistoryEntrySchema, type PracticeHistoryEntry, type SpeechBlock, type SpeechRate } from './contracts'
import type { PracticePlaylistItem } from './practice-chain-contracts'

export type PracticeKind = 'speak' | 'write'

/** The kinds an entry has, with older entries (no `kinds`) counting as spoken. */
export function entryKinds(entry: Pick<PracticeHistoryEntry, 'kinds' | 'lastOpenedAt'>): { speak?: number; write?: number } {
  return entry.kinds ?? { speak: entry.lastOpenedAt }
}

/** The kind used last: write only when it is strictly the newest. */
export function lastKind(entry: Pick<PracticeHistoryEntry, 'kinds' | 'lastOpenedAt'>): PracticeKind {
  const kinds = entryKinds(entry)
  return (kinds.write ?? 0) > (kinds.speak ?? 0) ? 'write' : 'speak'
}

export async function rememberPracticePhrase(phrase: SpeechBlock, rate: SpeechRate, ends?: number[], items?: PracticePlaylistItem[], kind: PracticeKind = 'speak'): Promise<void> {
  const now = Date.now()
  await db.transaction('rw', db.practiceHistory, db.journal, async () => {
    const existing = await db.practiceHistory.get(phrase.text)
    const entry = practiceHistoryEntrySchema.parse({
      text: phrase.text, phrase, rate, lastOpenedAt: now,
      kinds: { ...(existing ? entryKinds(existing) : {}), [kind]: now },
      ...(ends ? { chain: { text: phrase.text, ends, ...(items ? { items } : {}) } } : {}),
    })
    await db.practiceHistory.put(entry)
    await recordJournal(practiceEvent(entry.text, entry.lastOpenedAt))
  })
}

/** The Writing page reached from a phrase: mark the phrase as written, keeping its playlist and rate. */
export async function rememberWrittenPhrase(text: string): Promise<void> {
  const existing = await db.practiceHistory.get(text)
  if (existing) return rememberPracticePhrase(existing.phrase, existing.rate, existing.chain?.ends, existing.chain?.items, 'write')
  return rememberPracticePhrase({ type: 'speech', text, locale: 'zh-Hans' }, 1, undefined, undefined, 'write')
}
