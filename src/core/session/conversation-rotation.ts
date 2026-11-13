import { db } from '../database'
import { recordHeard } from '../phrases/bank'
import type { PhraseHeard } from '../phrases/contracts'

// Which listening conversations the learner has had, and when. The log lives in the profile's `phraseHeard` table (kept in every backup and
// profile export) under keys that start with `conversation:`; no phrase has such a text, so the two uses never meet.

export const CONVERSATION_KEY_PREFIX = 'conversation:'
export type ConversationLog = ReadonlyMap<string, Pick<PhraseHeard, 'heard' | 'lastHeardAt'>>

export const conversationKey = (id: string): string => CONVERSATION_KEY_PREFIX + id

/** The conversations heard so far, by key. */
export async function conversationLog(): Promise<Map<string, PhraseHeard>> {
  return new Map((await db.phraseHeard.where('zh').startsWith(CONVERSATION_KEY_PREFIX).toArray()).map(row => [row.zh, row]))
}

/** Records that these conversations were heard (each later one a millisecond after the one before, so their order is kept). */
export async function recordConversationsHeard(ids: readonly string[], now = Date.now()): Promise<void> {
  const unique = [...new Set(ids)]
  for (const [at, id] of unique.entries()) await recordHeard([conversationKey(id)], now + at)
}

/**
 * The candidates in the order to offer them: conversations not heard yet first, then the one heard longest ago; the conversation heard
 * most recently overall (the previous session's) comes last, so it is only offered when nothing else fits. Ties keep a random order.
 */
export function rotate<T>(candidates: readonly T[], idOf: (entry: T) => string, log: ConversationLog, rng: () => number): T[] {
  let previous: string | undefined
  let newest = -1
  for (const [key, row] of log) if (row.lastHeardAt > newest) { newest = row.lastHeardAt; previous = key }
  const shuffled = [...candidates]
  for (let at = shuffled.length - 1; at > 0; at--) { const other = Math.floor(rng() * (at + 1)); [shuffled[at], shuffled[other]] = [shuffled[other], shuffled[at]] }
  const rank = (entry: T) => {
    const key = conversationKey(idOf(entry)), row = log.get(key)
    return [key === previous ? 1 : 0, row ? 1 : 0, row?.lastHeardAt ?? 0]
  }
  return shuffled.map(entry => ({ entry, rank: rank(entry) })).sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]).map(item => item.entry)
}
