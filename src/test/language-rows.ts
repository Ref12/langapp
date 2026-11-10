import type { db as appDb } from '../core/database'
import rows from '../core/profiles/fixtures/language-rows.json'

// Rows of the Japanese and Korean tracks as the older parallel screens left them in a Chinese build's storage, written as plain data (no parallel code).
type Db = typeof appDb

/** The recorded rows: ja:/ko: knowledge, cards, journal events, lessons and the workspace preferences. Add after the Chinese rows of a test. */
export async function addLanguageRows(db: Db): Promise<void> {
  await db.knowledge.bulkAdd(rows.knowledge as never)
  await db.studyCards.bulkAdd(rows.cards as never)
  await db.journal.bulkAdd(rows.journal as never)
  await db.lessons.bulkAdd(rows.lessons as never)
  await db.preferences.update('workspace', rows.preferences as never)
}

const NOW_FIELDS = { domain: 'reading', stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 'new' } as const

/** Plain knowledge rows with a new card each (and an add event), for the given language refs; reviewed refs get one answered card. */
export async function addPlainLanguageRows(db: Db, refs: readonly string[], now: number, reviewed: readonly string[] = []): Promise<void> {
  for (const ref of refs) {
    if (await db.knowledge.get(ref)) continue
    const [, kind, ...label] = ref.split(':')
    await db.knowledge.add({ ref, kind: kind === 'g' ? 'grammar' : 'vocabulary', lb: label.join(':'), band: '1', addedAt: now, source: 'new' } as never)
    const answered = reviewed.includes(ref)
    await db.studyCards.add({ id: ref + ':reading', ref, ...NOW_FIELDS, due: answered ? now + 600_000 : now, updatedAt: answered ? now + 100_000 : now, ...(answered ? { stability: 3.17, difficulty: 5.28, reps: 1, state: 'review', lastReview: now + 100_000 } : {}) } as never)
    await db.journal.add({ t: new Date(now).toISOString(), op: 'add', ref, band: 1, source: 'new' } as never)
    if (answered) await db.journal.add({ t: new Date(now + 100_000).toISOString(), op: 'review', ref, grade: 'good', domain: 'reading', sched: 'fsrs-v1', attempt: 'parallel' } as never)
  }
}
