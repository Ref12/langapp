import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../database'
import { addEvent, removeEvent, replay } from '../backup/journal'
import { createDrillSet, finishDrillSet, getDrillSet } from '../drills/store'
import { whenContent } from '../drills/content'
import { addToKnowledge, describeRefs, removeFromKnowledge, removeRunFromKnowledge, runAddedRefs } from './knowledge'
import { cardId, type ExerciseSession, type KnowledgeEntry } from './contracts'
import type { DrillSet } from '../drills/contracts'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const T = Date.UTC(2026, 9, 30, 12)
const entry = (ref: string, addedAt: number, source: KnowledgeEntry['source'] = 'new'): KnowledgeEntry => ({ ref, kind: ref.startsWith('grammar') ? 'grammar' : 'vocabulary', lb: ref.split(':')[1], band: '1', addedAt, source })
async function know(...entries: KnowledgeEntry[]) {
  for (const item of entries) {
    await db.knowledge.add(item)
    await db.studyCards.add({ id: cardId(item.ref, 'reading'), ref: item.ref, domain: 'reading', due: item.addedAt, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 'new', updatedAt: item.addedAt })
  }
}
const legacySet = (fields: Partial<DrillSet>): DrillSet => ({ id: 's1', source: 'new', title: 'New items · 30 Oct', refs: [], status: 'completed', format: 'single', progress: {}, content: { state: 'pending', sentences: {}, conversations: [] }, createdAt: T, updatedAt: T, completedAt: T + 1000, ...fields })

describe('a practice set introduces its New items when it is finished', () => {
  it('adds nothing on create, adds on finish once, and records what it added', async () => {
    await addToKnowledge(['vocabulary:wo3--me'])
    const before = await db.knowledge.count()
    const id = await createDrillSet({ kind: 'new', refs: ['vocabulary:wo3--me', 'vocabulary:ni3--you'] }, T)
    await whenContent(id)
    expect(await db.knowledge.count()).toBe(before)
    expect((await getDrillSet(id))!.addedRefs).toBeUndefined()
    expect(await finishDrillSet(id, T + 5000)).toEqual(['vocabulary:ni3--you'])
    expect(await finishDrillSet(id, T + 9000)).toEqual([])
    expect((await getDrillSet(id))!.addedRefs).toEqual(['vocabulary:ni3--you'])
    expect(await db.knowledge.count()).toBe(before + 1)
  })

  it('a set that is discarded adds nothing', async () => {
    const id = await createDrillSet({ kind: 'new' }, T)
    await whenContent(id)
    await db.drillSets.update(id, { status: 'abandoned', discarded: true })
    expect(await db.knowledge.count()).toBe(0)
    expect(await runAddedRefs('drill', id)).toEqual([])
  })
})

describe('removing from the knowledge set', () => {
  it('deletes the entries and their cards in one go, writes a remove event each, and keeps attempts', async () => {
    await know(entry('vocabulary:wo3--me', T), entry('grammar:s-shi4-n--identity', T))
    await db.exerciseAttempts.add({ id: 'a1', sessionId: 'x', index: 0, refs: ['vocabulary:wo3--me'], response: 'r', correct: true, createdAt: T })
    const removed = await removeFromKnowledge(['vocabulary:wo3--me', 'grammar:s-shi4-n--identity', 'vocabulary:never'], T + 10)
    expect(removed).toEqual(['vocabulary:wo3--me', 'grammar:s-shi4-n--identity'])
    expect(await db.knowledge.count()).toBe(0)
    expect(await db.studyCards.count()).toBe(0)
    expect(await db.exerciseAttempts.count()).toBe(1)
    const events = (await db.journal.toArray()).filter(row => (row as unknown as { op: string }).op === 'remove')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ ref: 'vocabulary:wo3--me', t: new Date(T + 10).toISOString() })
  })

  it('removes only what a finished set added, never what was known before it', async () => {
    await addToKnowledge(['vocabulary:wo3--me'])
    const id = await createDrillSet({ kind: 'new', refs: ['vocabulary:wo3--me', 'vocabulary:ni3--you'] })
    await finishDrillSet(id)
    expect(await runAddedRefs('drill', id)).toEqual(['vocabulary:ni3--you'])
    expect(await removeRunFromKnowledge('drill', id)).toEqual(['vocabulary:ni3--you'])
    expect(await db.knowledge.get('vocabulary:wo3--me')).toBeDefined()
    expect(await db.studyCards.get(cardId('vocabulary:wo3--me', 'reading'))).toBeDefined()
    expect(await db.knowledge.get('vocabulary:ni3--you')).toBeUndefined()
    expect(await db.studyCards.get(cardId('vocabulary:ni3--you', 'reading'))).toBeUndefined()
    expect(await runAddedRefs('drill', id)).toEqual([])
  })

  it('is replayed from the journal: the entry and its card are gone', () => {
    const item = entry('vocabulary:wo3--me', T)
    const state = replay([addEvent(item), removeEvent(item.ref, T + 1)])
    expect(state.knowledge.has(item.ref)).toBe(false)
    expect(state.cards.has(cardId(item.ref, 'reading'))).toBe(false)
  })

  it('describes the refs', () => {
    expect(describeRefs(['vocabulary:a', 'vocabulary:b', 'vocabulary:c', 'vocabulary:d', 'vocabulary:e', 'grammar:g'])).toBe('5 words and 1 grammar pattern')
    expect(describeRefs(['grammar:g', 'grammar:h'])).toBe('2 grammar patterns')
  })
})

describe('sets from before the field was recorded', () => {
  it('a practice set that added at creation is worked out from the entries added at its time', async () => {
    await know(entry('vocabulary:a', T - 86_400_000), entry('vocabulary:b', T), entry('grammar:g', T), entry('vocabulary:other', T))
    await db.drillSets.add(legacySet({ refs: ['vocabulary:a', 'vocabulary:b', 'grammar:g', 'vocabulary:gone'] }))
    expect((await runAddedRefs('drill', 's1')).sort()).toEqual(['grammar:g', 'vocabulary:b'])
    expect(await removeRunFromKnowledge('drill', 's1')).toHaveLength(2)
    expect(await db.knowledge.get('vocabulary:a')).toBeDefined()
    expect(await db.knowledge.get('vocabulary:other')).toBeDefined()
  })

  it('an old Reviews set added nothing, and a lesson is worked out from its start time', async () => {
    await know(entry('vocabulary:a', T), entry('vocabulary:b', T - 500_000), entry('vocabulary:c', T, 'dictionary'))
    await db.drillSets.add(legacySet({ id: 'review', source: 'review', refs: ['vocabulary:a'] }))
    expect(await runAddedRefs('drill', 'review')).toEqual([])
    const lesson = { id: 'l1', mode: 'new', domain: 'reading', targetRefs: ['vocabulary:a', 'vocabulary:b', 'vocabulary:c'], reviewRefs: [], exercises: [], cursor: 0, status: 'completed', model: 'm', rejected: [], createdAt: T } as unknown as ExerciseSession
    await db.exerciseSessions.add(lesson)
    expect(await runAddedRefs('lesson', 'l1')).toEqual(['vocabulary:a'])
  })
})
