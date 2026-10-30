import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../database'
import { startReviewSession as startReviewSessionRaw, submitExerciseAnswer, advanceExercise } from '../study/knowledge'
import { cardId } from '../study/contracts'
import { addLines, createCollection, deleteCollection, dueItems, promoteItems, removeItems, renameCollection, showCollection, startCollectionSession as startCollectionSessionRaw, studyLines as studyLinesRaw } from './store'
import { itemId, phraseRef } from './contracts'
import { initializeWorkspace } from '../database'
import { exportActiveProfile, restoreActiveProfile } from '../profiles/store'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { whenGenerated } from '../study/generation'
const startReviewSession = async (...args: Parameters<typeof startReviewSessionRaw>) => { const id = await startReviewSessionRaw(...args); await whenGenerated(id); return id }
const startCollectionSession = async (...args: Parameters<typeof startCollectionSessionRaw>) => { const id = await startCollectionSessionRaw(...args); await whenGenerated(id); return id }
const studyLines = async (...args: Parameters<typeof studyLinesRaw>) => { const id = await studyLinesRaw(...args); await whenGenerated(id); return id }

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const connection = {
  id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const,
}
const line = { text: '我是学生。', translation: 'I am a student.', source: { mediaId: 'm1', title: 'Drama', line: 3, start: 12.5, text: '我是学生。' } }
const phrase = phraseRef(line.text)

function proposalFor(refs: string[]) {
  return { exercises: [
    { id: 'c1', type: 'choice', targets: refs.slice(0, 1), direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'Identity.' },
    { id: 'c2', type: 'choice', targets: refs.slice(0, 2), direction: 'en-to-zh', question: 'I am a student.', options: ['我是学生。', '学生是我。'], answer: 0, explanation: 'Identity.' },
    { id: 't1', type: 'tiles', targets: refs.slice(0, 6), translation: 'I am a student.', tiles: ['我', '是', '学生'], distractors: [], explanation: 'Subject, verb, noun.' },
    { id: 't2', type: 'tiles', targets: refs.slice(-1), translation: 'I am a student.', tiles: ['我是', '学生'], distractors: [], explanation: 'Two parts.' },
  ] }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  structured.requestStructuredJSON.mockReset()
})

afterEach(() => vi.restoreAllMocks())

describe('collections', () => {
  it('creates, renames and deletes user collections', async () => {
    const made = await createCollection('  Kitchen words ')
    expect(made).toMatchObject({ name: 'Kitchen words', kind: 'user' })
    await renameCollection(made.id, 'Food')
    expect((await db.collections.get(made.id))!.name).toBe('Food')
    await addLines(made.id, [{ text: '我是学生。' }])
    await deleteCollection(made.id)
    expect(await db.collections.count()).toBe(0)
    expect(await db.collectionItems.count()).toBe(0)
    await expect(createCollection('  ')).rejects.toThrow(/Name the study set/)
  })

  it('creates a show collection on first add and extracts catalog units from lines', async () => {
    const first = await showCollection('m1', 'Drama')
    expect(await showCollection('m1', 'Drama')).toEqual(first)
    expect(first).toMatchObject({ kind: 'show', mediaId: 'm1' })
    const result = await addLines(first.id, [line])
    expect(result.phrases).toBe(1)
    expect(result.units).toBeGreaterThan(1)
    const items = await db.collectionItems.where('collectionId').equals(first.id).toArray()
    const refs = items.map(item => item.ref)
    expect(refs).toContain(phrase)
    expect(refs).toContain('vocabulary:wo3--me')
    expect(items.find(item => item.ref === phrase)).toMatchObject({ text: line.text, translation: 'I am a student.', source: { mediaId: 'm1', line: 3, start: 12.5 } })
    expect((await addLines(first.id, [line])).total).toBe(0)
    await expect(db.studyCards.get(cardId('vocabulary:wo3--me', 'reading'))).resolves.toMatchObject({ state: 'new' })
    expect(await db.knowledge.count()).toBe(0)
    await removeItems([itemId(first.id, 'vocabulary:wo3--me')])
    expect(await db.collectionItems.count()).toBe(items.length - 1)
  })

  it('practises a collection without touching the knowledge set, and reschedules the shared cards', async () => {
    await db.aiConnections.add(connection)
    structured.requestStructuredJSON.mockImplementation(async (_c: unknown, request: { user: string }) => proposalFor(JSON.parse(request.user).targets.map((target: { ref: string }) => target.ref)))
    const id = (await showCollection('m1', 'Drama')).id
    const sessionId = await studyLines([line])
    const session = (await db.exerciseSessions.get(sessionId))!
    expect(session.collectionId).toBe(id)
    expect(session.targetRefs).toContain(phrase)
    expect(await db.knowledge.count()).toBe(0)
    await submitExerciseAnswer(sessionId, 0, 0)
    await advanceExercise(sessionId, 0)
    expect(await db.knowledge.count()).toBe(0)
    expect((await db.studyCards.get(cardId(session.exercises[0].targets[0], 'reading')))!.reps).toBe(1)
    expect((await db.journal.toArray()).filter(event => event.op === 'review')).toEqual([])
  })

  it('keeps collection-only items out of the daily review and hands them to the collection review', async () => {
    await db.aiConnections.add(connection)
    structured.requestStructuredJSON.mockImplementation(async (_c: unknown, request: { user: string }) => proposalFor(JSON.parse(request.user).targets.map((target: { ref: string }) => target.ref)))
    const { id } = await showCollection('m1', 'Drama')
    await addLines(id, [line])
    await expect(startReviewSession(Date.now(), true)).rejects.toThrow(/knowledge set is empty/)
    expect(structured.requestStructuredJSON).not.toHaveBeenCalled()
    expect((await dueItems(id, Date.now() + 1000)).length).toBeGreaterThan(1)
    // One known item: the daily review targets only it, never the collection-only ones.
    const { addToKnowledge } = await import('../study/knowledge')
    await addToKnowledge(['vocabulary:wo3--me'])
    structured.requestStructuredJSON.mockImplementationOnce(async () => ({ exercises: [['I', 'you'], ['me', 'you'], ['I am', 'you are'], ['myself', 'yours']].map((options, index) => (
      { id: `r${index}`, type: 'choice', targets: ['vocabulary:wo3--me'], direction: 'zh-to-en', question: '我', options, answer: 0, explanation: 'First person.' })) }))
    await startReviewSession(Date.now() + 1000)
    const review = (await db.exerciseSessions.toArray()).find(session => !session.collectionId)!
    expect(review.targetRefs).toEqual(['vocabulary:wo3--me'])
    const sessionId = await startCollectionSession(id, { dueOnly: true, now: Date.now() + 1000 })
    expect((await db.exerciseSessions.get(sessionId))!.targetRefs).toContain(phrase)
  })

  it('keeps every picked word: 20 picks make 3 generation requests and one session', async () => {
    await db.aiConnections.add(connection)
    const { loadCatalog } = await import('../study/catalog')
    const units = (await loadCatalog()).units
    const refs = [...units.values()].filter(unit => unit.kind === 'vocabulary').slice(0, 20).map(unit => unit.ref)
    const asked: string[][] = []
    structured.requestStructuredJSON.mockImplementation(async (_c: unknown, request: { user: string }) => {
      const described = JSON.parse(request.user).targets as { ref: string; chinese: string }[]
      const targets = described.map(target => target.ref)
      asked.push(targets)
      return { exercises: [0, 1, 2, 3].map(n => ({ id: 'c' + n, type: 'choice', targets: [targets[n % targets.length]], direction: 'zh-to-en', question: described[n % described.length].chinese, options: ['I', 'you', 'we', 'they'], answer: 0, explanation: 'x' })) }
    })
    const { id } = await createCollection('Picks')
    const { addUnitsToCollection } = await import('./store')
    await addUnitsToCollection(id, refs)
    const sessionId = await startCollectionSession(id, { itemIds: refs.map(ref => itemId(id, ref)) })
    expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(3)
    expect(asked.map(chunk => chunk.length)).toEqual([8, 8, 4])
    const session = (await db.exerciseSessions.get(sessionId))!
    expect(new Set(session.targetRefs)).toEqual(new Set(refs))
    expect(session.exercises).toHaveLength(12)
    expect(new Set(session.exercises.map(exercise => exercise.id)).size).toBe(12)
    // Without a selection the old cap of 8 words holds.
    structured.requestStructuredJSON.mockClear()
    await startCollectionSession(id, { resume: false })
    expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(1)
  })

  it('promotes items to the knowledge set and keeps the card history', async () => {
    await db.aiConnections.add(connection)
    structured.requestStructuredJSON.mockImplementation(async (_c: unknown, request: { user: string }) => proposalFor(JSON.parse(request.user).targets.map((target: { ref: string }) => target.ref)))
    const { id } = await showCollection('m1', 'Drama')
    await addLines(id, [line])
    const sessionId = await startCollectionSession(id)
    const first = (await db.exerciseSessions.get(sessionId))!.exercises[0].targets[0]
    await submitExerciseAnswer(sessionId, 0, 0)
    const before = (await db.studyCards.get(cardId(first, 'reading')))!
    expect(before.reps).toBe(1)
    const added = await promoteItems(await db.collectionItems.where('collectionId').equals(id).primaryKeys())
    expect(added).toBeGreaterThan(1)
    expect((await db.knowledge.count())).toBe(added)
    if (first.startsWith('phrase:')) expect(await db.knowledge.get(first)).toBeUndefined()
    else expect(await db.studyCards.get(cardId(first, 'reading'))).toEqual(before)
    expect(await promoteItems([itemId(id, 'vocabulary:wo3--me')])).toBe(0)
  })

  it('round-trips through a backup, cards of collection-only items included', async () => {
    await initializeWorkspace()
    const { id } = await showCollection('m1', 'Drama')
    await addLines(id, [line])
    const text = await exportWorkspaceBackup()
    const before = { items: await db.collectionItems.count(), cards: await db.studyCards.count() }
    await db.collectionItems.clear(); await db.collections.clear(); await db.studyCards.clear()
    await restoreBackup(text)
    expect(await db.collections.get(id)).toMatchObject({ mediaId: 'm1' })
    expect({ items: await db.collectionItems.count(), cards: await db.studyCards.count() }).toEqual(before)
  })

  it('round-trips through the profile export', async () => {
    await initializeWorkspace()
    const { id } = await showCollection('m1', 'Drama')
    await addLines(id, [line])
    const before = { items: await db.collectionItems.count(), cards: await db.studyCards.count(), knowledge: await db.knowledge.count() }
    const text = await exportActiveProfile()
    await restoreActiveProfile(text)
    expect({ items: await db.collectionItems.count(), cards: await db.studyCards.count(), knowledge: await db.knowledge.count() }).toEqual(before)
    expect(before.knowledge).toBe(0)
  })
})
