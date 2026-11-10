import { db } from '../database'
import { addEvent, reviewEvent } from '../backup/journal'
import { recordJournal } from '../backup/journal-store'
import { cardId, type KnowledgeEntry, type StudyCard } from '../study/contracts'
import { DOMAIN } from '../study/knowledge'
import { emptySchedulingState, schedule, type Rating } from '../study/fsrs'
import type { ParallelLanguage } from '../language/ids'
import { parseParallelRef, parallelRefsOf } from '../language/refs'

// Knowledge and review cards of the Japanese and Korean tracks. They sit in the same tables as the Chinese ones under language-prefixed refs (ja:w:<entry>, ja:g:<grammar>):
// additive, no migration. The workspace view and the Chinese queues filter them out, so each language has its own queue.

const newCard = (ref: string, now: number): StudyCard => ({ id: cardId(ref, DOMAIN), ref, domain: DOMAIN, ...emptySchedulingState(now), updatedAt: now })

/** Adds items to a language's knowledge set (once each), with a new card. */
export async function addParallelKnowledge(refs: readonly string[], now = Date.now()): Promise<string[]> {
  const added: string[] = []
  await db.transaction('rw', db.knowledge, db.studyCards, db.journal, async () => {
    for (const ref of refs) {
      const parsed = parseParallelRef(ref)
      if (!parsed || await db.knowledge.get(ref)) continue
      const entry: KnowledgeEntry = { ref, kind: parsed.kind === 'g' ? 'grammar' : 'vocabulary', lb: parsed.id, band: '1', addedAt: now, source: 'new' }
      await db.knowledge.add(entry)
      await recordJournal(addEvent(entry))
      if (!await db.studyCards.get(cardId(ref, DOMAIN))) await db.studyCards.add(newCard(ref, now))
      added.push(ref)
    }
  })
  return added
}

/** One first-try result per item: Got it = Good, Needed a hint = Hard, Missed = Again, scheduled like a Chinese lesson answer. */
export async function recordParallelResult(ref: string, correct: boolean, hint = false, now = Date.now()): Promise<void> {
  if (!parseParallelRef(ref)) return
  await addParallelKnowledge([ref], now)
  const rating: Rating = correct ? (hint ? 2 : 3) : 1
  await db.transaction('rw', db.studyCards, db.knowledge, db.journal, async () => {
    const card = await db.studyCards.get(cardId(ref, DOMAIN))
    if (!card) return
    await db.studyCards.put({ ...card, ...schedule({ due: card.due, stability: card.stability, difficulty: card.difficulty, reps: card.reps, lapses: card.lapses, state: card.state, lastReview: card.lastReview }, rating, now), updatedAt: now })
    await recordJournal(reviewEvent(ref, rating, now, 'parallel'))
  })
}

/** The refs of a language in its knowledge set. Records of any other language are ignored. */
export async function parallelKnown(language: ParallelLanguage): Promise<Set<string>> {
  return new Set(parallelRefsOf(language, (await db.knowledge.toArray()).map(entry => entry.ref)))
}

/** A language's due cards, earliest first (its own queue). */
export async function parallelDue(language: ParallelLanguage, now: number): Promise<StudyCard[]> {
  const known = await parallelKnown(language)
  return (await db.studyCards.toArray()).filter(card => known.has(card.ref) && card.due <= now).sort((a, b) => a.due - b.due || a.ref.localeCompare(b.ref))
}
