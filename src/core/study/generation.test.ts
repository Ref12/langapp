import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../database'
import { loadCatalog } from './catalog'
import { nextGroup, startNewSession } from './knowledge'
import { isGenerating, whenGenerated } from './generation'
import { splitCount } from './exercises'
import { retryGeneration } from './retry'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const connection = {
  id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const,
}

function proposal(targets: string[]) {
  return { exercises: [
    { id: 'c1', type: 'choice', targets: targets.slice(0, 1), direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'Identity with 是.' },
    { id: 'c2', type: 'choice', targets: targets.slice(0, 2), direction: 'en-to-zh', question: 'I study.', options: ['我学习。', '我是学生。'], answer: 0, explanation: '学习 means study.' },
    { id: 't1', type: 'tiles', targets, translation: 'I am a student.', tiles: ['我', '是', '学生'], distractors: ['学习'], explanation: 'Subject, 是, noun.' },
    { id: 't2', type: 'tiles', targets: targets.slice(-1), translation: 'I study.', tiles: ['我', '学习'], distractors: [], explanation: 'Subject then verb.' },
  ] }
}
const targetsOf = async () => nextGroup(await loadCatalog(), new Set())!.units.map(unit => unit.ref)

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.aiConnections.add(connection)
  structured.requestStructuredJSON.mockReset()
})

describe('exercise count split', () => {
  it('uses requests of at most 20, as even as possible', () => {
    expect(splitCount(8)).toEqual([8])
    expect(splitCount(20)).toEqual([20])
    expect(splitCount(21)).toEqual([11, 10])
    expect(splitCount(40)).toEqual([20, 20])
  })
})

describe('session lifecycle', () => {
  it('saves a shell at once, then fills it in place when the AI answers', async () => {
    const refs = await targetsOf()
    let release: (value: unknown) => void = () => undefined
    structured.requestStructuredJSON.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const id = await startNewSession()
    const shell = (await db.exerciseSessions.get(id))!
    expect(shell).toMatchObject({ exercises: [], generation: 'running', exerciseCount: 20, targetRefs: refs })
    expect(isGenerating(id)).toBe(true)
    expect(await db.knowledge.count()).toBe(refs.length)
    release(proposal(refs))
    await whenGenerated(id)
    const filled = (await db.exerciseSessions.get(id))!
    expect(filled.exercises).toHaveLength(4)
    expect(filled.generation).toBeUndefined()
    expect(isGenerating(id)).toBe(false)
    expect(JSON.parse(structured.requestStructuredJSON.mock.calls[0][1].user).requestedExercises).toBe(20)
  })

  it('records a failure on the session and fills it after Try again', async () => {
    const refs = await targetsOf()
    structured.requestStructuredJSON.mockRejectedValueOnce(new Error('Model unavailable'))
    const id = await startNewSession()
    await whenGenerated(id)
    expect(await db.exerciseSessions.get(id)).toMatchObject({ exercises: [], generation: 'failed', generationError: 'Model unavailable' })
    structured.requestStructuredJSON.mockResolvedValueOnce(proposal(refs))
    await retryGeneration(id)
    await whenGenerated(id)
    const filled = (await db.exerciseSessions.get(id))!
    expect(filled.exercises).toHaveLength(4)
    expect(filled.generation).toBeUndefined()
    expect(filled.generationError).toBeUndefined()
  })

  it('treats a running session with no request in this tab as stale and lets Try again finish it', async () => {
    const refs = await targetsOf()
    await db.exerciseSessions.add({ id: 'stale', mode: 'new', domain: 'reading', targetRefs: refs, reviewRefs: [], exercises: [], cursor: 0, status: 'active',
      model: 'm', rejected: [], createdAt: 1, generation: 'running', exerciseCount: 20 })
    expect(isGenerating('stale')).toBe(false)
    structured.requestStructuredJSON.mockResolvedValueOnce(proposal(refs))
    await retryGeneration('stale')
    expect(isGenerating('stale')).toBe(true)
    await whenGenerated('stale')
    expect((await db.exerciseSessions.get('stale'))!.exercises).toHaveLength(4)
  })

  it('asks for the preferred count: 40 exercises go out as two parallel requests of 20', async () => {
    const refs = await targetsOf()
    const preferences = await db.preferences.get('workspace')
    if (preferences) await db.preferences.put({ ...preferences, exercisesPerLesson: 40 })
    else await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false, exercisesPerLesson: 40 })
    structured.requestStructuredJSON.mockImplementation(async () => proposal(refs))
    const id = await startNewSession()
    await whenGenerated(id)
    expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(2)
    expect(structured.requestStructuredJSON.mock.calls.map(call => JSON.parse(call[1].user).requestedExercises)).toEqual([20, 20])
    const session = (await db.exerciseSessions.get(id))!
    expect(session.exerciseCount).toBe(40)
    expect(session.exercises).toHaveLength(8)
    expect(new Set(session.exercises.map(exercise => exercise.id)).size).toBe(8)
  })
})
