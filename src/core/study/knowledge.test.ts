import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../database'
import { loadCatalog } from './catalog'
import { addToKnowledge, advanceExercise, discardSession, dueCards, groupProgress, nextGroup, startNewSession, startReviewSession, submitExerciseAnswer } from './knowledge'

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

beforeEach(async () => {
  await db.delete()
  await db.open()
  structured.requestStructuredJSON.mockReset()
})

describe('knowledge set and sessions', () => {
  it('walks the generated curriculum order group by group', async () => {
    const catalog = await loadCatalog()
    const first = nextGroup(catalog, new Set())!
    expect(first.group.id).toBe('zh-hsk-1-lesson-0001')
    expect(first.units.map(unit => unit.ref)).toContain('vocabulary:wo3--me')
    expect(first.units.map(unit => unit.ref)).toContain('grammar:s-shi4-n--identity')
    const known = new Set(first.units.map(unit => unit.ref))
    expect(nextGroup(catalog, known)!.group.id).toBe('zh-hsk-1-lesson-0002')
    expect(groupProgress(catalog, known)).toEqual({ completed: 1, total: catalog.orderedGroups.length })
    const partial = new Set([first.units[0].ref])
    expect(nextGroup(catalog, partial)!.newUnits).toHaveLength(first.units.length - 1)
  })

  it('adds dictionary items as review-eligible cards without asserting proficiency', async () => {
    await addToKnowledge(['vocabulary:cha2--tea', 'grammar:s-shi4-n--identity'])
    await addToKnowledge(['vocabulary:cha2--tea'])
    const knowledge = await db.knowledge.toArray()
    expect(knowledge.map(entry => [entry.ref, entry.source, entry.band])).toEqual([
      ['grammar:s-shi4-n--identity', 'dictionary', '1'], ['vocabulary:cha2--tea', 'dictionary', '1'],
    ])
    const cards = await db.studyCards.toArray()
    expect(cards.map(card => card.state)).toEqual(['new', 'new'])
    expect((await dueCards(Date.now())).length).toBe(2)
    await expect(addToKnowledge(['vocabulary:nope--nothing'])).rejects.toThrow(/Unknown curriculum unit/)
  })

  it('requires an AI connection before generating a session', async () => {
    await expect(startNewSession()).rejects.toThrow(/Connect an AI model in Settings/)
    expect(await db.knowledge.count()).toBe(0)
    expect(structured.requestStructuredJSON).not.toHaveBeenCalled()
  })

  it('introduces the next group, validates generated exercises, records answers and reschedules', async () => {
    await db.aiConnections.add(connection)
    const catalog = await loadCatalog()
    const group = nextGroup(catalog, new Set())!
    structured.requestStructuredJSON.mockImplementationOnce(async () => proposal(group.units.map(unit => unit.ref)))
    const id = await startNewSession()
    expect(await startNewSession()).toBe(id)
    expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(1)
    const request = structured.requestStructuredJSON.mock.calls[0][1]
    expect(request.name).toBe('study_exercises')
    expect(JSON.parse(request.user).targets.map((target: { ref: string }) => target.ref)).toEqual(group.units.map(unit => unit.ref))
    const session = (await db.exerciseSessions.get(id))!
    expect(session.mode).toBe('new')
    expect(session.groupId).toBe(group.group.id)
    expect(session.exercises.map(exercise => exercise.id)).toEqual(['c1', 'c2', 't1', 't2'])
    expect(session.rejected).toEqual([])
    expect((await db.knowledge.toArray()).map(entry => entry.source)).toEqual(group.units.map(() => 'new'))

    const before = (await db.studyCards.get(`${session.exercises[0].targets[0]}:reading`))!
    const attempt = await submitExerciseAnswer(id, 0, 0)
    expect(attempt.correct).toBe(true)
    expect(await submitExerciseAnswer(id, 0, 1)).toEqual(attempt)
    const after = (await db.studyCards.get(before.id))!
    expect(after.state).toBe('review')
    expect(after.due).toBeGreaterThan(before.due)
    await expect(advanceExercise(id, 1)).rejects.toThrow(/Check your answer/)
    await advanceExercise(id, 0)
    expect((await db.exerciseSessions.get(id))!.cursor).toBe(1)
    const miss = await submitExerciseAnswer(id, 1, 1)
    expect(miss.correct).toBe(false)
    expect((await db.studyCards.get(`${session.exercises[1].targets[0]}:reading`))!.state).toBe('relearning')
    expect((await db.studyCards.get(`${session.exercises[1].targets[1]}:reading`))!.state).toBe('learning')
    await advanceExercise(id, 1)
    const tiles = session.exercises[2]
    if (tiles.type !== 'tiles') throw new Error('expected tiles')
    expect((await submitExerciseAnswer(id, 2, tiles.tiles)).correct).toBe(true)
    await advanceExercise(id, 2)
    await expect(submitExerciseAnswer(id, 3, 'not tiles')).rejects.toThrow(/Arrange the tiles/)
    expect((await submitExerciseAnswer(id, 3, ['学习', '我'])).correct).toBe(false)
    await advanceExercise(id, 3)
    const finished = (await db.exerciseSessions.get(id))!
    expect(finished.status).toBe('completed')
    expect(finished.completedAt).toBeDefined()
    expect(await db.exerciseAttempts.count()).toBe(4)
  })

  it('reviews due items with FSRS order and brings recent items back into the next new session', async () => {
    await db.aiConnections.add(connection)
    const catalog = await loadCatalog()
    const group = nextGroup(catalog, new Set())!
    const refs = group.units.map(unit => unit.ref)
    structured.requestStructuredJSON.mockImplementation(async (_connection, request) => {
      const targets = JSON.parse(request.user).targets.map((target: { ref: string }) => target.ref)
      return proposal(targets)
    })
    const first = await startNewSession()
    for (let index = 0; index < 4; index++) {
      await submitExerciseAnswer(first, index, index < 2 ? 0 : ['我', '是', '学生'])
      await advanceExercise(first, index)
    }
    await expect(startReviewSession(Date.now())).rejects.toThrow(/Nothing is due/)
    const review = await startReviewSession(Date.now(), true)
    const reviewSession = (await db.exerciseSessions.get(review))!
    expect(reviewSession.mode).toBe('review')
    expect(reviewSession.targetRefs.length).toBeGreaterThan(0)
    expect(reviewSession.targetRefs.every(ref => refs.includes(ref))).toBe(true)
    await discardSession(review)
    expect((await db.exerciseSessions.get(review))!.status).toBe('abandoned')
    const second = await startNewSession()
    const next = (await db.exerciseSessions.get(second))!
    expect(next.groupId).toBe('zh-hsk-1-lesson-0002')
    expect(next.reviewRefs.length).toBeGreaterThan(0)
    expect(next.reviewRefs.every(ref => refs.includes(ref))).toBe(true)
    const nextRequest = JSON.parse(structured.requestStructuredJSON.mock.calls.at(-1)![1].user)
    expect(nextRequest.alsoReview.map((item: { ref: string }) => item.ref)).toEqual(next.reviewRefs)
  })

  it('reports when the AI returns too few usable exercises', async () => {
    await db.aiConnections.add(connection)
    structured.requestStructuredJSON.mockResolvedValueOnce({ exercises: [
      { id: 'c1', type: 'choice', targets: ['vocabulary:wo3--me'], direction: 'zh-to-en', question: '我们', options: ['we', 'I'], answer: 0, explanation: 'Unknown word.' },
    ] })
    await expect(startNewSession()).rejects.toThrow(/only 0 usable exercises \(1 rejected\)/)
    expect(await db.knowledge.count()).toBe(0)
    expect(await db.exerciseSessions.count()).toBe(0)
  })
})
