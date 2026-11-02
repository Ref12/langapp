import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from './database'
import { exportWorkspaceBackup, restoreBackup } from './backup'
import { createDrillSet, getDrillSet, newHandsfreeActivity, unfinishedSets, updateHandsfree } from './drills/store'
import { whenContent } from './drills/content'
import { rememberPracticePhrase } from './assistant/practice-history'
import { removeHistoryItems, restoreHistoryItems } from './history-removal'
import { addToKnowledge } from './study/knowledge'

vi.mock('./ai/structured', () => ({ requestStructuredJSON: vi.fn() }))

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(() => vi.restoreAllMocks())

const lesson = (id: string) => ({
  id, mode: 'review', domain: 'reading', targetRefs: ['vocabulary:wo3--me'], reviewRefs: [], cursor: 0, status: 'completed', model: 'm', rejected: [], createdAt: 5, completedAt: 6,
  exercises: [{ id: 'c', type: 'choice', targets: ['vocabulary:wo3--me'], direction: 'zh-to-en', question: '我', options: ['I', 'you'], answer: 0, explanation: 'x' }],
}) as never

async function seed() {
  const setId = await createDrillSet({ kind: 'new', count: 5 }); await whenContent(setId)
  const runId = await createDrillSet({ kind: 'new', count: 3 }, Date.now(), { handsfree: newHandsfreeActivity() }); await updateHandsfree(runId, { started: true })
  await db.exerciseSessions.add(lesson('les1'))
  await rememberPracticePhrase({ type: 'speech', text: '你好', locale: 'zh-Hans', meaning: 'Hello' }, 1)
  return { setId, runId }
}
const learning = async () => JSON.stringify([await db.knowledge.toArray(), await db.studyCards.toArray(), await db.exerciseAttempts.toArray(), await db.characterStates.toArray()])

describe('removing History items', () => {
  it('hides each kind, leaves what was learned untouched, and Undo restores them', async () => {
    const { setId, runId } = await seed()
    await addToKnowledge(['vocabulary:wo3--me'])
    const before = await learning()
    expect(before).not.toBe('[[],[],[],[]]')
    await removeHistoryItems([`drill:${setId}`, `drill:${runId}`, 'lesson:les1', 'phrase:你好'], 99)
    expect((await getDrillSet(setId))?.removedAt).toBe(99)
    expect((await db.drillSets.get(runId))?.removedAt).toBe(99)
    expect((await db.exerciseSessions.get('les1'))?.removedAt).toBe(99)
    expect((await db.practiceHistory.get('你好'))?.removedAt).toBe(99)
    expect(await learning()).toBe(before)
    await restoreHistoryItems([`drill:${setId}`, `drill:${runId}`, 'lesson:les1', 'phrase:你好'])
    expect((await getDrillSet(setId))?.removedAt).toBeUndefined()
    expect((await db.practiceHistory.get('你好'))?.removedAt).toBeUndefined()
    expect(await learning()).toBe(before)
  })

  it('removed sets and Hands-free runs leave Unfinished sets', async () => {
    const { setId, runId } = await seed()
    expect(unfinishedSets(await db.drillSets.toArray()).map(set => set.id).sort()).toEqual([setId, runId].sort())
    await removeHistoryItems([`drill:${setId}`, `drill:${runId}`])
    expect(unfinishedSets(await db.drillSets.toArray())).toHaveLength(0)
  })

  it('removedAt survives a backup export and restore, and the removal persists after reload', async () => {
    const { setId, runId } = await seed()
    await removeHistoryItems([`drill:${setId}`, `drill:${runId}`, 'lesson:les1', 'phrase:你好'], 77)
    const text = await exportWorkspaceBackup()
    await db.drillSets.clear(); await db.exerciseSessions.clear(); await db.practiceHistory.clear()
    await restoreBackup(text)
    expect((await db.drillSets.get(setId))?.removedAt).toBe(77)
    expect((await db.drillSets.get(runId))?.removedAt).toBe(77)
    expect((await db.exerciseSessions.get('les1'))?.removedAt).toBe(77)
    expect((await db.practiceHistory.get('你好'))?.removedAt).toBe(77)
  })
})
