import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../database'
import { addedBy, addedDate } from './addedby'
import type { ExerciseSession, KnowledgeEntry } from './contracts'
import type { DrillSet } from '../drills/contracts'
import { removeRunFromKnowledge } from './knowledge'

beforeEach(async () => { await db.delete(); await db.open() })

const T = Date.UTC(2026, 10, 2, 12)
const entry = (ref: string, addedAt: number, source: KnowledgeEntry['source'] = 'new'): KnowledgeEntry => ({ ref, kind: 'vocabulary', lb: ref.split(':')[1], band: '1', addedAt, source })
const lesson = (fields: Partial<ExerciseSession>): ExerciseSession => ({ id: 'l1', mode: 'new', domain: 'reading', targetRefs: ['vocabulary:a'], reviewRefs: [], exercises: [], cursor: 0, status: 'completed', model: 'm', rejected: [], createdAt: T - 9000, completedAt: T, addOnFinish: ['vocabulary:a'], addedRefs: ['vocabulary:a'], ...fields })
const set = (fields: Partial<DrillSet>): DrillSet => ({ id: 's1', source: 'new', title: 'New items · 2 Nov', refs: ['vocabulary:a'], status: 'completed', format: 'single', progress: {}, content: { state: 'pending', sentences: {}, conversations: [] }, createdAt: T - 9000, updatedAt: T, completedAt: T, addedRefs: ['vocabulary:a'], ...fields })

describe('addedBy', () => {
  it('formats the date', () => expect(addedDate(T)).toBe('Nov 2, 2026'))

  it('finds the lesson that added an entry', async () => {
    const e = entry('vocabulary:a', T); await db.knowledge.add(e); await db.exerciseSessions.add(lesson({}))
    expect(await addedBy(e)).toMatchObject({ href: '#lessons/session/l1' })
  })

  it('finds the practice set, and an older lesson without addedRefs', async () => {
    const e = entry('vocabulary:a', T); await db.knowledge.add(e); await db.drillSets.add(set({}))
    expect(await addedBy(e)).toMatchObject({ href: '#practice/set/s1' })
    await db.drillSets.clear(); await db.exerciseSessions.add(lesson({ addOnFinish: undefined, addedRefs: undefined, createdAt: T }))
    expect(await addedBy(e)).toMatchObject({ href: '#lessons/session/l1' })
  })

  it('says from the Dictionary only for a dictionary entry; a New entry with no matching run has no "by"', async () => {
    const e = entry('vocabulary:a', T + 86_400_000, 'dictionary')
    await db.exerciseSessions.add(lesson({}))
    expect(await addedBy(e)).toEqual({ at: e.addedAt, label: 'from the Dictionary' })
    expect(await addedBy({ ...e, source: 'new' })).toEqual({ at: e.addedAt })
    expect(await addedBy({ ...e, ref: 'source:x', kind: 'source' })).toMatchObject({ label: 'from Media' })
  })

  it('labels every drill set as a practice set, even a Hands-free shortcut one', async () => {
    const e = entry('vocabulary:a', T); await db.knowledge.add(e); await db.drillSets.add(set({ shortcut: 'handsfree' }))
    expect(await addedBy(e)).toMatchObject({ label: 'practice set: New items · 2 Nov', href: '#practice/set/s1' })
  })

  it('shows the latest addition after a revoke and re-add, with no link to the revoked run', async () => {
    await db.knowledge.add(entry('vocabulary:a', T)); await db.exerciseSessions.add(lesson({}))
    await removeRunFromKnowledge('lesson', 'l1')
    expect(await db.knowledge.get('vocabulary:a')).toBeUndefined()
    const again = entry('vocabulary:a', T + 86_400_000, 'dictionary'); await db.knowledge.add(again)
    expect(await addedBy(again)).toEqual({ at: again.addedAt, label: 'from the Dictionary' })
    const reNew = { ...again, source: 'new' as const }
    expect(await addedBy(reNew)).toEqual({ at: again.addedAt })
  })
})
