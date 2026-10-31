import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../database'
import { loadCatalog } from './catalog'
import { advanceExercise, nextGroup, startNewSession, submitExerciseAnswer } from './knowledge'
import { isGenerating, whenGenerated } from './generation'
import { playItem, queueLength } from './redo'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const connection = {
  id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const,
}

function proposal(targets: string[], prefix: string) {
  return { exercises: [1, 2, 3, 4].map(number => ({ id: `${prefix}${number}`, type: 'choice', targets: targets.slice(0, 1), direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'x' })) }
}

async function setUp(count = 40) {
  await db.aiConnections.add(connection)
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false, exercisesPerLesson: count })
  return nextGroup(await loadCatalog(), new Set())!.units.filter(unit => unit.kind === 'vocabulary').map(unit => unit.ref)
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  structured.requestStructuredJSON.mockReset()
})

describe('lessons that start on programmatic exercises', () => {
  it('saves local exercises, with a match, before the AI answers; each batch joins as it arrives', async () => {
    const refs = await setUp()
    const resolvers: ((value: unknown) => void)[] = []
    structured.requestStructuredJSON.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
    const id = await startNewSession()
    const opening = (await db.exerciseSessions.get(id))!
    expect(opening.generation).toBe('running')
    expect(opening.exercises.length).toBeGreaterThan(0)
    expect(opening.exercises.every(exercise => exercise.id.startsWith('local-'))).toBe(true)
    expect(refs.length).toBeGreaterThanOrEqual(4)
    expect(opening.exercises.some(exercise => exercise.type === 'match')).toBe(true)
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    const before = opening.exercises.length
    resolvers[0](proposal(refs, 'b1-'))
    await vi.waitFor(async () => expect((await db.exerciseSessions.get(id))!.exercises).toHaveLength(before + 4))
    expect((await db.exerciseSessions.get(id))!.generation).toBe('running')
    expect(isGenerating(id)).toBe(true)
    resolvers[1](proposal(refs, 'b2-'))
    await whenGenerated(id)
    const done = (await db.exerciseSessions.get(id))!
    expect(done.generation).toBeUndefined()
    expect(done.exercises).toHaveLength(before + 8)
    expect(done.aiNotice).toBeUndefined()
  })

  it('fills the shortfall with more local exercises and leaves one quiet notice when the AI rejects', async () => {
    await setUp(20)
    structured.requestStructuredJSON.mockRejectedValue(new Error('Model unavailable'))
    const id = await startNewSession()
    await whenGenerated(id)
    const session = (await db.exerciseSessions.get(id))!
    expect(session.generation).toBeUndefined()
    expect(session.generationError).toBeUndefined()
    expect(session.aiNotice).toBe('Model unavailable')
    expect(session.exercises.length).toBeGreaterThan(8)
    expect(session.exercises.every(exercise => exercise.id.startsWith('local-'))).toBe(true)
    expect(new Set(session.exercises.map(exercise => exercise.id)).size).toBe(session.exercises.length)
  })

  it('keeps the batches that arrived when another fails', async () => {
    const refs = await setUp()
    structured.requestStructuredJSON.mockResolvedValueOnce(proposal(refs, 'b1-')).mockRejectedValueOnce(new Error('Second batch failed'))
    const id = await startNewSession()
    await whenGenerated(id)
    const session = (await db.exerciseSessions.get(id))!
    expect(session.exercises.filter(exercise => !exercise.id.startsWith('local-'))).toHaveLength(4)
    expect(session.aiNotice).toBe('Second batch failed')
  })

  it('shows the lesson as complete only after the learner has played everything, and waits at the end while the AI runs', async () => {
    const refs = await setUp(20)
    let release: (value: unknown) => void = () => undefined
    structured.requestStructuredJSON.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const id = await startNewSession()
    const length = (await db.exerciseSessions.get(id))!.exercises.length
    for (let index = 0; index < length; index++) {
      const session = (await db.exerciseSessions.get(id))!
      const item = playItem(session, index)!
      await submitExerciseAnswer(id, index, item.exercise.type === 'match' ? [] : item.exercise.type === 'choice' ? item.exercise.answer : [])
      await advanceExercise(id, index)
    }
    const waiting = (await db.exerciseSessions.get(id))!
    expect(waiting.status).toBe('active')
    expect(waiting.cursor).toBe(length)
    expect(playItem(waiting, waiting.cursor)).toBeUndefined()
    await vi.waitFor(() => expect(structured.requestStructuredJSON).toHaveBeenCalled())
    release(proposal(refs, 'a-'))
    await whenGenerated(id)
    const next = (await db.exerciseSessions.get(id))!
    expect(next.status).toBe('active')
    expect(playItem(next, next.cursor)?.exercise.id).toMatch(/^a-/)
  })
})

describe('match grading and redo', () => {
  async function playableMatch() {
    await setUp(20)
    structured.requestStructuredJSON.mockImplementation(() => new Promise(() => undefined))
    const id = await startNewSession()
    const session = (await db.exerciseSessions.get(id))!
    const index = session.exercises.findIndex(exercise => exercise.type === 'match')
    return { id, session, index }
  }

  it('charges a miss to the item, reschedules only that item as failed, and queues the match once for a redo', async () => {
    const { id, session, index } = await playableMatch()
    const match = session.exercises[index]
    if (match.type !== 'match') throw new Error('expected a match')
    for (let position = 0; position < index; position++) {
      await submitExerciseAnswer(id, position, (session.exercises[position] as { answer: number }).answer)
      await advanceExercise(id, position)
    }
    const missed = match.pairs[0].ref
    const attempt = await submitExerciseAnswer(id, index, [missed])
    expect(attempt.correct).toBe(false)
    expect(attempt.response).toBe(JSON.stringify([missed]))
    const lapsed = (await db.studyCards.get(`${missed}:reading`))!
    const clean = (await db.studyCards.get(`${match.pairs[1].ref}:reading`))!
    // A first miss on a card that is still being learned is not a lapse, but it is scored worse than the clean one.
    expect(lapsed.lapses > 0 || lapsed.difficulty > clean.difficulty || lapsed.stability < clean.stability).toBe(true)
    expect(clean.lapses).toBe(0)
    expect((await db.exerciseSessions.get(id))!.redos).toEqual([{ exercise: index, round: 1 }])
    // The redo is the same exercise, played after the last one and not scored again.
    const after = (await db.exerciseSessions.get(id))!
    await db.exerciseSessions.put({ ...after, generation: undefined })
    const finalState = (await db.exerciseSessions.get(id))!
    expect(playItem(finalState, finalState.exercises.length)).toMatchObject({ index, redo: 1 })
    expect(queueLength(finalState)).toBe(finalState.exercises.length + 1)
  })

  it('a clean match is correct and queues nothing', async () => {
    const { id, session, index } = await playableMatch()
    for (let position = 0; position < index; position++) {
      await submitExerciseAnswer(id, position, (session.exercises[position] as { answer: number }).answer)
      await advanceExercise(id, position)
    }
    expect((await submitExerciseAnswer(id, index, [])).correct).toBe(true)
    expect((await db.exerciseSessions.get(id))!.redos).toBeUndefined()
  })
})
