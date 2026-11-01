import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { resetProfileStorage } from '../../test/profile-storage'
import { addedLine } from './summary'
import { completeHandsfreeRun, createHandsfreeRun, discardHandsfreeRun, repeatHandsfreeRun, unfinishedHandsfreeRuns, updateHandsfreeRun } from './store'

beforeEach(async () => {
  localStorage.clear()
  await resetProfileStorage()
  await initializeWorkspace()
})

describe('Hands-free store: knowledge set', () => {
  it('adds a New items run to the knowledge set only when it is completed, and only once', async () => {
    const before = await db.knowledge.count()
    const id = await createHandsfreeRun({ kind: 'new', count: 3 })
    const run = (await db.handsfreeRuns.get(id))!
    expect(run.addOnComplete?.length).toBeGreaterThan(0)
    expect(await db.knowledge.count()).toBe(before)
    await updateHandsfreeRun(id, { status: 'active', started: true, position: 4 })
    expect(await db.knowledge.count()).toBe(before)
    const added = await completeHandsfreeRun(id, 10)
    expect(added.length).toBe(run.addOnComplete!.length)
    expect(await db.knowledge.count()).toBe(before + added.length)
    expect((await db.handsfreeRuns.get(id))).toMatchObject({ status: 'completed', addedRefs: added })
    // completing it again, or playing it again, adds nothing more
    expect(await completeHandsfreeRun(id, 10)).toEqual([])
    const again = await repeatHandsfreeRun(id)
    expect((await db.handsfreeRuns.get(again))!.addOnComplete).toBeUndefined()
    expect(await completeHandsfreeRun(again, 10)).toEqual([])
    expect(await db.knowledge.count()).toBe(before + added.length)
  })

  it('adds nothing for an abandoned or discarded run, nor for a review run', async () => {
    const before = await db.knowledge.count()
    const id = await createHandsfreeRun({ kind: 'new', count: 3 })
    await updateHandsfreeRun(id, { status: 'active', started: true, position: 2 })
    expect(unfinishedHandsfreeRuns(await db.handsfreeRuns.toArray()).map(run => run.id)).toEqual([id])
    await updateHandsfreeRun(id, { status: 'abandoned' })
    expect(unfinishedHandsfreeRuns(await db.handsfreeRuns.toArray())).toHaveLength(1)
    await discardHandsfreeRun(id)
    expect(unfinishedHandsfreeRuns(await db.handsfreeRuns.toArray())).toHaveLength(0)
    expect(await db.knowledge.count()).toBe(before)
  })

  it('words the finish line from what was added', () => {
    expect(addedLine([...Array.from({ length: 5 }, (_, at) => 'vocabulary:w' + at), 'grammar:g1'])).toBe('Added 5 words and 1 grammar pattern to your knowledge set')
    expect(addedLine(['vocabulary:w1'])).toBe('Added 1 word to your knowledge set')
    expect(addedLine(['grammar:a', 'grammar:b'])).toBe('Added 2 grammar patterns to your knowledge set')
    expect(addedLine([])).toBe('')
    expect(addedLine(undefined)).toBe('')
  })
})
