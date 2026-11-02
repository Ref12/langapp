import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { LearningDatabase } from '../database'
import { handsfreeRunToSet } from './migrate'
import { runAddedRefs } from '../study/knowledge'
import { unfinishedSets, resumeRoute } from '../drills/store'

const settings = { pause: 'long', repeats: 2, itemWording: 'abridged' } as const
const run = (fields: Record<string, unknown>) => ({ id: 'r', title: 'Hands-free · 1 Nov', refs: ['vocabulary:a', 'vocabulary:b'], source: 'new', seed: 42, settings, status: 'completed', started: true, position: 7, createdAt: 100, updatedAt: 300, completedAt: 300, ...fields })

describe('handsfreeRunToSet', () => {
  it('a completed run keeps its id, settings, seed, completion and addedRefs; removal and history still work on it', () => {
    const set = handsfreeRunToSet(run({ addOnComplete: ['vocabulary:a', 'vocabulary:b'], addedRefs: ['vocabulary:a'], practiced: ['vocabulary:a|listening'] }))!
    expect(set).toMatchObject({ id: 'r', status: 'completed', completedAt: 300, shortcut: 'handsfree', addOnFinish: ['vocabulary:a', 'vocabulary:b'], addedRefs: ['vocabulary:a'],
      handsfree: { seed: 42, settings, started: true, position: 7, done: true, finishedAt: 300, practiced: ['vocabulary:a|listening'] } })
    expect(set.discarded).toBeUndefined()
  })
  it('a started, unfinished run becomes an unfinished set that resumes at its saved prompt', () => {
    const set = handsfreeRunToSet(run({ status: 'abandoned', completedAt: undefined, position: 4 }))!
    expect(set).toMatchObject({ status: 'active', handsfree: { started: true, done: false, position: 4 } })
    expect(unfinishedSets([set]).map(item => item.id)).toEqual(['r'])
    expect(resumeRoute(set)).toBe('practice/set/r/handsfree')
  })
  it('a run never started, or set aside, stays out of Unfinished (and a never-started one out of History)', () => {
    const fresh = handsfreeRunToSet(run({ status: 'active', started: false, position: 0, completedAt: undefined }))!
    expect(fresh).toMatchObject({ status: 'abandoned', discarded: true })
    const aside = handsfreeRunToSet(run({ status: 'abandoned', discarded: true, completedAt: undefined }))!
    expect(unfinishedSets([fresh, aside])).toHaveLength(0)
    expect(handsfreeRunToSet({ nonsense: true })).toBeUndefined()
  })
})

describe('Dexie upgrade 22 to 23', () => {
  const name = 'migration-test'
  afterEach(async () => { await Dexie.delete(name) })

  it('moves stored Hands-free runs into drillSets, and Remove from knowledge set still works on a migrated run', async () => {
    // The database as it was at version 22.
    const old = new Dexie(name)
    old.version(20).stores({ drillSets: '&id, status, createdAt', knowledge: '&ref, kind, band, addedAt', studyCards: '&id, ref, domain, due, [domain+due]', journal: '++seq' })
    old.version(21).stores({ handsfreeRuns: '&id, status, createdAt' })
    await old.open()
    await old.table('handsfreeRuns').bulkAdd([
      run({ id: 'done', addOnComplete: ['vocabulary:a'], addedRefs: ['vocabulary:a'] }),
      run({ id: 'stopped', status: 'abandoned', completedAt: undefined, position: 5 }),
    ])
    await old.close()
    const upgraded = new LearningDatabase(name)
    await upgraded.open()
    expect(upgraded.tables.map(table => table.name)).not.toContain('handsfreeRuns')
    const sets = await upgraded.drillSets.toArray()
    expect(sets.map(set => set.id).sort()).toEqual(['done', 'stopped'])
    expect(await upgraded.drillSets.get('done')).toMatchObject({ status: 'completed', addedRefs: ['vocabulary:a'], handsfree: { done: true, seed: 42, settings } })
    expect(await upgraded.drillSets.get('stopped')).toMatchObject({ status: 'active', handsfree: { started: true, done: false, position: 5 } })
    upgraded.close()
  })
})

describe('removal of what a migrated run added', () => {
  it('uses addedRefs: a migrated run is believed, an item added later by something else is not its to remove', async () => {
    const { db, resetDatabaseForTests } = await import('../database')
    resetDatabaseForTests(); await db.delete(); await db.open()
    await db.knowledge.bulkAdd([{ ref: 'vocabulary:a', kind: 'vocabulary', lb: 'a', band: '1', addedAt: 290, source: 'new' }, { ref: 'vocabulary:b', kind: 'vocabulary', lb: 'b', band: '1', addedAt: 1, source: 'dictionary' }] as never)
    await db.drillSets.add(handsfreeRunToSet(run({ addOnComplete: ['vocabulary:a', 'vocabulary:b'], addedRefs: ['vocabulary:a'] }))!)
    expect(await runAddedRefs('drill', 'r')).toEqual(['vocabulary:a'])
  })
})
