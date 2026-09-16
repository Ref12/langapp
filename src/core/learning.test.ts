import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from './database'
import { advancePractice, moveReading, openStory, revealAnswer, savePreferences, startPractice, submitAnswer, trackWord } from './learning'
import { applyAnswer, DAY, readingStage } from './progress'
import { exportBackup, readBackup, restoreBackup } from './backup'
import type { PracticeSession } from './model'
import { curriculumLessons } from '../data/curriculum'

const firstLesson = curriculumLessons[0]

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { vi.restoreAllMocks() })

async function session(id: string): Promise<PracticeSession> {
  const result = await db.sessions.get(id)
  if (!result) throw new Error('Missing session fixture')
  return result
}

describe('isolated local workspace', () => {
  it('initializes only once and starts with no invented progress', async () => {
    await Promise.all([initializeWorkspace(), initializeWorkspace()])
    expect(db.name).toBe('linguaweave-next')
    const workspace = await loadWorkspace()
    expect(workspace.preferences.language).toBe('zh-Hans')
    expect(workspace.words).toEqual([])
    expect(workspace.lessons).toEqual([])
    expect(workspace.attempts).toEqual([])
    expect(await db.preferences.count()).toBe(1)
  })

  it('persists preferences and refuses blank names', async () => {
    await savePreferences({ name: '  Mei  ', theme: 'light', pinyin: false })
    await expect(savePreferences({ name: '  ' })).rejects.toThrow('workspace name')
    expect((await loadWorkspace()).preferences).toMatchObject({ name: 'Mei', theme: 'light', pinyin: false })
  })

  it('preserves shared word state when Dictionary and lessons introduce the same sense', async () => {
    const wordId = firstLesson.wordIds[0]
    await trackWord(wordId, 'dictionary')
    const original = await db.words.get(wordId)
    await startPractice('lesson', firstLesson.id)
    await trackWord(wordId, 'dictionary')
    expect(await db.words.get(wordId)).toEqual(original)
    expect(await db.words.count()).toBe(firstLesson.wordIds.length)
  })

  it('saves actual completed passages and does not overwrite a newer reading place', async () => {
    await openStory('zh:tea-house')
    await moveReading('zh:tea-house', 0, 1, true)
    await expect(moveReading('zh:tea-house', 0, 2, true)).rejects.toThrow('another tab')
    await moveReading('zh:tea-house', 1, 0, false)
    await openStory('zh:tea-house')
    expect(await db.readings.get('zh:tea-house')).toMatchObject({ passage: 0, completed: [0] })
    await expect(moveReading('zh:tea-house', 0, 9, true)).rejects.toThrow('not available')
  })
})

describe('durable practice', () => {
  it('resumes an existing session with the same shuffled choices and no duplicated word introductions', async () => {
    const ids = await Promise.all([startPractice('lesson', firstLesson.id), startPractice('lesson', firstLesson.id)])
    expect(ids[0]).toBe(ids[1])
    const saved = await session(ids[0])
    expect(saved.questions).toHaveLength(firstLesson.wordIds.length * 2)
    expect((await session(await startPractice('lesson', firstLesson.id))).questions).toEqual(saved.questions)
    for (const question of saved.questions) {
      expect(question.options).toHaveLength(4)
      expect(new Set(question.options).size).toBe(4)
      expect(question.options).toContain(question.wordId)
    }
  })

  it('records one immutable attempt for duplicate Check clicks and resumes feedback before Next', async () => {
    const id = await startPractice('lesson', firstLesson.id)
    const saved = await session(id)
    const correct = saved.questions[0].wordId
    await Promise.all([submitAnswer(id, 0, correct), submitAnswer(id, 0, correct)])
    expect(await db.attempts.count()).toBe(1)
    expect((await db.words.get(correct))?.attempts).toBe(1)
    expect((await session(id)).cursor).toBe(0)
    await expect(submitAnswer(id, 0, saved.questions[0].options.find(option => option !== correct)!)).rejects.toThrow('saved answer')
    await Promise.all([advancePractice(id, 0), advancePractice(id, 0)])
    expect((await session(id)).cursor).toBe(1)
    await expect(advancePractice(id, 1)).rejects.toThrow('Check your answer')
  })

  it('persists revealed answers and does not treat them as independent success', async () => {
    const now = new Date(2026, 0, 1, 12).getTime()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const id = await startPractice('lesson', firstLesson.id)
    const wordId = (await session(id)).questions[0].wordId
    await revealAnswer(id, 0)
    expect((await session(id)).questions[0].revealed).toBe(true)
    const attempt = await submitAnswer(id, 0, wordId)
    expect(attempt).toMatchObject({ correct: true, assisted: true })
    expect(await db.words.get(wordId)).toMatchObject({ independentCorrect: 0, successfulDays: [], dueAt: now + 300_000 })
    await expect(revealAnswer(id, 0)).rejects.toThrow('already been recorded')
  })

  it('atomically completes a practiced lesson, not a mastered skill', async () => {
    const id = await startPractice('lesson', firstLesson.id)
    const saved = await session(id)
    for (const [index, question] of saved.questions.entries()) {
      await submitAnswer(id, index, question.wordId)
      await advancePractice(id, index)
    }
    expect((await session(id)).status).toBe('completed')
    expect((await db.lessons.get(firstLesson.id))?.completedAt).toBeDefined()
    expect(readingStage(await db.words.get(firstLesson.wordIds[0]))).toBe('Practicing')
  })

  it('rejects unknown choices and never commits partial attempts when saving fails', async () => {
    const id = await startPractice('lesson', firstLesson.id)
    await expect(submitAnswer(id, 0, 'invalid')).rejects.toThrow('available answers')
    const saved = await session(id)
    vi.spyOn(db.words, 'put').mockRejectedValueOnce(new Error('Storage full'))
    await expect(submitAnswer(id, 0, saved.questions[0].wordId)).rejects.toThrow('Storage full')
    expect(await db.attempts.count()).toBe(0)
    expect((await db.words.get(saved.questions[0].wordId))?.attempts).toBe(0)
  })

  it('limits due reviews to currently due tracked words', async () => {
    await expect(startPractice('due')).rejects.toThrow('No words are due')
    await trackWord('zh:tea', 'test')
    await trackWord('zh:rain', 'test')
    await db.words.update('zh:rain', { dueAt: Date.now() + DAY })
    const review = await session(await startPractice('due'))
    expect(review.questions.map(question => question.wordId)).toEqual(['zh:tea', 'zh:tea'])
    await expect(startPractice('all', firstLesson.id)).rejects.toThrow('cannot be attached')
  })
})

describe('reading-specific evidence', () => {
  it('requires spaced days and both directions, and schedules misses and help sooner', async () => {
    await trackWord('zh:tea', 'test')
    let state = (await db.words.get('zh:tea'))!
    const now = new Date(2026, 0, 1, 12).getTime()
    expect(readingStage(state)).toBe('Introduced')
    for (let repeat = 0; repeat < 10; repeat++) state = applyAnswer(state, 'meaning', true, false, now)
    expect(state.successfulDays).toHaveLength(1)
    expect(state.dueAt).toBe(now + DAY)
    state = applyAnswer(state, 'meaning', true, false, now + DAY)
    state = applyAnswer(state, 'meaning', true, false, now + 2 * DAY)
    expect(readingStage(state)).toBe('Practicing')
    state = applyAnswer(state, 'form', true, false, now + 2 * DAY)
    expect(readingStage(state)).toBe('Learned')
    const missed = applyAnswer(state, 'meaning', false, false, now + 3 * DAY)
    const helped = applyAnswer(state, 'meaning', true, true, now + 3 * DAY)
    for (const result of [missed, helped]) {
      expect(readingStage(result)).toBe('Practicing')
      expect(result.dueAt).toBe(now + 3 * DAY + 300_000)
      expect(result.successfulDays).toEqual([])
    }
    expect(state).not.toHaveProperty('speaking')
    expect(state).not.toHaveProperty('writing')
  })
})

describe('workspace backups', () => {
  it('round-trips an unfinished, assisted session and its exact resume position', async () => {
    const id = await startPractice('lesson', firstLesson.id)
    await revealAnswer(id, 0)
    const wordId = (await session(id)).questions[0].wordId
    await submitAnswer(id, 0, wordId)
    await openStory('zh:tea-house')
    await moveReading('zh:tea-house', 0, 1, true)
    const before = await loadWorkspace()
    const backup = exportBackup(before)
    expect(readBackup(backup)).toEqual({ ...before, assistant: { threads: [], messages: [], runs: [] } })
    await advancePractice(id, 0)
    await restoreBackup(backup)
    expect(await loadWorkspace()).toEqual(before)
    expect((await session(id)).cursor).toBe(0)
    expect((await db.attempts.get(`${id}:0`))?.assisted).toBe(true)
  })

  it('rejects v1 backups and broken references before touching current data', async () => {
    await trackWord('zh:tea', 'test')
    const before = await loadWorkspace()
    await expect(restoreBackup('{"format":"linguaweave-backup","version":2}')).rejects.toThrow()
    const invalid = JSON.parse(exportBackup(before))
    invalid.workspace.words[0].wordId = 'zh:unknown'
    await expect(restoreBackup(JSON.stringify(invalid))).rejects.toThrow('Unknown Mandarin word')
    expect(await loadWorkspace()).toEqual(before)
  })

  it('rejects inconsistent recorded answers and rolls back a failed restore', async () => {
    const id = await startPractice('lesson', firstLesson.id)
    await submitAnswer(id, 0, (await session(id)).questions[0].wordId)
    const before = await loadWorkspace()
    const backup = exportBackup(before)
    const invalid = JSON.parse(backup)
    invalid.workspace.attempts[0].correct = false
    expect(() => readBackup(JSON.stringify(invalid))).toThrow('inconsistent practice answer')
    vi.spyOn(db.words, 'bulkAdd').mockRejectedValueOnce(new Error('Storage full'))
    await expect(restoreBackup(backup)).rejects.toThrow('Storage full')
    expect(await loadWorkspace()).toEqual(before)
  })
})
