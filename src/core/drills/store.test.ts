import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { addToKnowledge, DOMAIN } from '../study/knowledge'
import { cardId } from '../study/contracts'
import { addUnitsToCollection, createCollection } from '../collections/store'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { recordWriteChar, discardDrillSet, createDrillSet, finishDrillSet, getDrillSet, MAX_UNFINISHED_SETS, NEW_SET_SIZE, recordDrillResult, recordRedo, setFormat, unfinishedSets } from './store'
import { whenContent } from './content'
import { countMarks, scoreOf } from './contracts'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const connection = {
  id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const,
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
  structured.requestStructuredJSON.mockReset()
})
afterEach(() => vi.restoreAllMocks())

const created = async (...args: Parameters<typeof createDrillSet>) => { const id = await createDrillSet(...args); await whenContent(id); return (await getDrillSet(id))! }

describe('creating drill sets', () => {
  it('New items takes the next curriculum items into the knowledge set', async () => {
    const set = await created({ kind: 'new' }, Date.UTC(2026, 9, 30, 12))
    expect(set.refs.length).toBeGreaterThan(0)
    expect(set.refs.length).toBeLessThanOrEqual(NEW_SET_SIZE)
    expect(set.title).toBe('New items · 30 Oct')
    expect(set.source).toBe('new')
    expect(await db.knowledge.bulkGet(set.refs)).toSatisfy((rows: unknown[]) => rows.every(Boolean))
    // The catalog's own example sentences fill most items without any AI; with no connection the rest is said to be unavailable.
    expect(Object.keys(set.content.sentences).length).toBeGreaterThan(0)
    expect(set.content.state).toBe('no-ai')
  })

  it('Reviews takes due items, and says so when nothing is due', async () => {
    await expect(createDrillSet({ kind: 'review' })).rejects.toThrow(/knowledge set is empty/)
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you'])
    await expect(createDrillSet({ kind: 'review' }, Date.now() - 10 * 86_400_000)).rejects.toThrow(/Nothing is due/)
    const set = await created({ kind: 'review' }, Date.now() + 1000)
    expect(set.title).toMatch(/^Reviews · \d+ \w{3}$/)
    expect(set.refs).toEqual(expect.arrayContaining(['vocabulary:wo3--me', 'vocabulary:ni3--you']))
  })

  it('a study set starts on its own items, and New words can draw from one', async () => {
    const collection = await createCollection('Introductions')
    await addUnitsToCollection(collection.id, ['vocabulary:wo3--me', 'vocabulary:ni3--you', 'grammar:s-shi4-n--identity'])
    const own = await created({ kind: 'study-set', collectionId: collection.id })
    expect(own.title).toBe('Introductions')
    expect(own.refs).toHaveLength(3)
    const fresh = await created({ kind: 'new', from: collection.id })
    expect(fresh.source).toBe('new')
    expect(fresh.collectionId).toBe(collection.id)
    expect(fresh.refs).toHaveLength(3)
    expect((await db.knowledge.get('vocabulary:wo3--me'))?.ref).toBe('vocabulary:wo3--me')
    await expect(createDrillSet({ kind: 'new', from: collection.id })).rejects.toThrow(/already in your knowledge set/)
  })

  it('writes only the missing sentences and the conversations with the AI, in batches', async () => {
    await db.aiConnections.put(connection)
    structured.requestStructuredJSON.mockImplementation(async (_connection, request: { name: string }) => request.name === 'drill_conversations'
      ? { conversations: [{ title: 'Hello', lines: [{ who: 'A', zh: '你好', py: 'nǐ hǎo', en: 'Hello' }, { who: 'B', zh: '我是学生。', py: 'wǒ shì xué shēng', en: 'I am a student.' }],
        questions: [{ after: 1, question: 'Who is a student?', options: ['A', 'B'], answer: 1 }] }] }
      : { sentences: [] })
    const set = await created({ kind: 'new' })
    expect(set.content.conversations).toHaveLength(1)
    expect(set.content.state).toBe('ready')
    // One request per batch of sentences plus one for the conversations, never one per item.
    expect(structured.requestStructuredJSON.mock.calls.length).toBeLessThanOrEqual(2)
  })
})

describe('unfinished sets', () => {
  it('lists, resumes, discards and keeps the number of unfinished sets bounded', async () => {
    await addToKnowledge(['vocabulary:wo3--me'])
    const first = await created({ kind: 'review' }, Date.now() + 1000)
    expect(unfinishedSets(await db.drillSets.toArray()).map(set => set.id)).toEqual([first.id])
    expect((await getDrillSet(first.id))?.status).toBe('active')
    await discardDrillSet(first.id)
    expect((await getDrillSet(first.id))?.status).toBe('abandoned')
    expect(unfinishedSets(await db.drillSets.toArray())).toHaveLength(0)
    for (let index = 0; index < MAX_UNFINISHED_SETS + 2; index++) await created({ kind: 'review' }, Date.now() + 1000 + index)
    expect(unfinishedSets(await db.drillSets.toArray()).length).toBeLessThanOrEqual(MAX_UNFINISHED_SETS)
  })

  it('discarding keeps the results already graded', async () => {
    await addToKnowledge(['vocabulary:wo3--me'])
    const set = await created({ kind: 'review' }, Date.now() + 1000)
    await recordDrillResult(set.id, 'meanings', 'vocabulary:wo3--me', 'got', set.refs)
    const reps = (await db.studyCards.get(cardId('vocabulary:wo3--me', DOMAIN)))!.reps
    await discardDrillSet(set.id)
    expect((await db.studyCards.get(cardId('vocabulary:wo3--me', DOMAIN)))!.reps).toBe(reps)
  })
})

describe('grading', () => {
  const refs = ['vocabulary:wo3--me', 'vocabulary:ni3--you', 'vocabulary:ta1--he']
  it('grades only the first pass of a type, mapping marks onto FSRS grades', async () => {
    await addToKnowledge(refs)
    const set = await created({ kind: 'review' }, Date.now() + 1000)
    const card = (ref: string) => db.studyCards.get(cardId(ref, DOMAIN))
    const before = await Promise.all(refs.map(card))
    expect(await recordDrillResult(set.id, 'meanings', refs[0], 'got', refs)).toEqual({ graded: true })
    expect(await recordDrillResult(set.id, 'meanings', refs[1], 'hint', refs)).toEqual({ graded: true })
    expect(await recordDrillResult(set.id, 'meanings', refs[2], 'missed', refs)).toEqual({ graded: true })
    const [got, hint, missed] = await Promise.all(refs.map(card))
    expect(got!.reps).toBe(before[0]!.reps + 1)
    expect(got!.stability).toBeGreaterThan(hint!.stability)
    expect(hint!.stability).toBeGreaterThan(missed!.stability)
    expect(missed!.lapses + (missed!.state === 'relearning' || missed!.state === 'learning' ? 1 : 0)).toBeGreaterThan(0)
    const done = (await getDrillSet(set.id))!
    expect(done.progress.meanings).toMatchObject({ done: true, results: { [refs[0]]: 'got', [refs[1]]: 'hint', [refs[2]]: 'missed' } })
    expect(scoreOf(countMarks(done))).toEqual({ correct: 2, total: 3 })
    // A redo is ungraded: the score and the schedule stay as they were.
    const snapshot = await Promise.all(refs.map(card))
    for (const ref of refs) expect(await recordDrillResult(set.id, 'meanings', ref, 'missed', refs)).toEqual({ graded: false })
    await recordRedo(set.id, 'meanings')
    expect(await Promise.all(refs.map(card))).toEqual(snapshot)
    const after = (await getDrillSet(set.id))!
    expect(after.progress.meanings!.results).toEqual(done.progress.meanings!.results)
    expect(after.progress.meanings!.redos).toBe(1)
    // A second type has its own first pass.
    expect(await recordDrillResult(set.id, 'pinyin', refs[0], 'got', refs)).toEqual({ graded: true })
    expect((await getDrillSet(set.id))!.progress.pinyin!.done).toBe(false)
  })

  it('does not grade an item twice in one unfinished type, and finishing/format persist', async () => {
    await addToKnowledge(refs)
    const set = await created({ kind: 'review' }, Date.now() + 1000)
    await recordDrillResult(set.id, 'write', refs[0], 'got', refs)
    expect(await recordDrillResult(set.id, 'write', refs[0], 'missed', refs)).toEqual({ graded: false })
    await setFormat(set.id, 'quiz')
    await finishDrillSet(set.id)
    const saved = (await getDrillSet(set.id))!
    expect(saved).toMatchObject({ format: 'quiz', status: 'completed' })
    expect(saved.progress.write!.results[refs[0]]).toBe('got')
  })
})

describe('backup', () => {
  it('round-trips drill sets and their per-type progress', async () => {
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you'])
    const set = await created({ kind: 'review' }, Date.now() + 1000)
    await recordDrillResult(set.id, 'meanings', 'vocabulary:wo3--me', 'hint', set.refs)
    const before = await db.drillSets.toArray()
    const text = await exportWorkspaceBackup()
    expect(JSON.parse(text).drillSets).toHaveLength(1)
    await db.drillSets.clear()
    await restoreBackup(text)
    expect(await db.drillSets.toArray()).toEqual(before)
    // Backups without drill sets still restore, and clear what was there.
    await db.drillSets.clear()
    const plain = await exportWorkspaceBackup()
    expect(JSON.parse(plain)).not.toHaveProperty('drillSets')
    await db.drillSets.add(before[0])
    await restoreBackup(plain)
    expect(await db.drillSets.count()).toBe(0)
  })

  it('keeps data saved before the drill table existed', async () => {
    await addToKnowledge(['vocabulary:wo3--me'])
    db.close()
    await db.open()
    expect(await db.knowledge.count()).toBe(1)
    expect(await db.drillSets.count()).toBe(0)
  })
})

describe('Write it by character', () => {
  it('gives a word the worst result of its characters, once every one has a result, and finishes when each word has one', async () => {
    const set = await created({ kind: 'new' })
    const [a, b] = set.refs
    const words = [{ ref: a, chars: ['学', '生'] }, { ref: b, chars: ['学', '习'] }]
    const scope = [a, b]
    expect(await recordWriteChar(set.id, '学', 'got', a, words, scope)).toEqual({ graded: true })
    expect((await getDrillSet(set.id))!.progress.write!.results).toEqual({})
    await recordWriteChar(set.id, '生', 'hint', a, words, scope)
    let saved = (await getDrillSet(set.id))!.progress.write!
    expect(saved.results).toEqual({ [a]: 'hint' })
    expect(saved.done).toBe(false)
    await recordWriteChar(set.id, '习', 'missed', b, words, scope)
    saved = (await getDrillSet(set.id))!.progress.write!
    expect(saved.results).toEqual({ [a]: 'hint', [b]: 'missed' })
    expect(saved.done).toBe(true)
    expect(Object.keys(saved.chars!).sort()).toEqual(['学', '生', '习'].sort())
    expect(countMarks({ progress: { write: saved } })).toEqual({ got: 1, hint: 1, missed: 1 })
    expect(await recordWriteChar(set.id, '习', 'got', b, words, scope)).toEqual({ graded: false })
  })
})
