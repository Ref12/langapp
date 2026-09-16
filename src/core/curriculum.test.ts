import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { curriculumLessons, curriculumLevels, curriculumProgress, curriculumWords, nextCurriculumLesson } from '../data/curriculum'
import { getWord, starterWords, words } from '../data/mandarin'
import { db, initializeWorkspace, loadWorkspace } from './database'
import { advancePractice, lessonReviewWords, revealAnswer, startPractice, submitAnswer, trackWord } from './learning'
import { makeQuestions } from './questions'
import { exportBackup, readBackup, restoreBackup } from './backup'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => vi.restoreAllMocks())

describe('sense-specific recognition questions', () => {
  it('uses four distinct visible choices for every curriculum and starter sense', () => {
    for (const question of makeQuestions(words.map(word => word.id))) {
      const options = question.options.map(getWord)
      expect(options).toHaveLength(4)
      expect(question.options).toContain(question.wordId)
      expect(new Set(options.map(word => word.native)).size).toBe(4)
      expect(new Set(options.map(word => word.meaning)).size).toBe(4)
      const target = getWord(question.wordId)
      expect(options.filter(word => word.native === target.native)).toHaveLength(1)
    }
  })

  it('avoids shared alternative glosses and prefers words in the current lesson', () => {
    const first = curriculumLessons[0]
    for (const question of makeQuestions(first.wordIds)) {
      const options = question.options.map(getWord)
      expect(question.options.every(id => first.wordIds.includes(id))).toBe(true)
      const pronouns = options.filter(word => word.meaning.startsWith('you'))
      expect(pronouns.length).toBeLessThanOrEqual(1)
    }
    const want = curriculumWords.find(word => word.id === 'zh-hsk1-00404-s004')!
    for (const question of makeQuestions([want.id], ['zh-hsk1-00427-s002', 'zh:want', want.id])) {
      expect(question.options).not.toContain('zh-hsk1-00427-s002')
      expect(question.options).not.toContain('zh:want')
    }
  })
})

describe('bounded curriculum learning', () => {
  it('introduces only a small canonical lesson and retains unrelated starter progress', async () => {
    await trackWord('zh:tea', 'story:zh:tea-house')
    const starter = await db.words.get('zh:tea')
    const lesson = curriculumLessons[0]
    const id = await startPractice('lesson', lesson.id)
    const session = (await db.sessions.get(id))!
    expect(session.questions).toHaveLength(lesson.wordIds.length * 2)
    expect(new Set(session.questions.map(question => question.wordId))).toEqual(new Set(lesson.wordIds))
    expect((await db.words.toArray()).map(word => word.wordId).sort()).toEqual(['zh:tea', ...lesson.wordIds].sort())
    expect(await db.words.get('zh:tea')).toEqual(starter)
    expect(await db.words.get('zh-hsk1-00037-s001')).toBeUndefined()
    expect(await db.words.get('zh-hsk1-00140-s001')).toBeUndefined()
    expect(await startPractice('lesson', lesson.id)).toBe(id)
    expect((await db.sessions.get(id))?.questions).toEqual(session.questions)
  })

  it('reviews at most three previously introduced senses before new material without resetting them', async () => {
    const first = curriculumLessons[0]
    const second = curriculumLessons[1]
    await startPractice('lesson', first.id)
    await db.words.update(first.wordIds[0], { dueAt: 0, attempts: 4 })
    const before = await db.words.get(first.wordIds[0])
    const reviews = lessonReviewWords(second, await db.words.toArray())
    expect(reviews).toHaveLength(3)
    expect(reviews[0]).toBe(first.wordIds[0])
    const id = await startPractice('lesson', second.id)
    const session = (await db.sessions.get(id))!
    expect(new Set(session.questions.slice(0, 6).map(question => question.wordId))).toEqual(new Set(reviews))
    expect(new Set(session.questions.slice(6).map(question => question.wordId))).toEqual(new Set(second.wordIds))
    expect(await db.words.get(first.wordIds[0])).toEqual(before)
    expect(await db.words.count()).toBe(first.wordIds.length + second.wordIds.length)
    expect((await db.sessions.get(await startPractice('lesson', second.id)))?.questions).toEqual(session.questions)
  })

  it('allows an available later level without inventing prerequisite completion or reviews', async () => {
    const lesson = curriculumLessons.find(item => item.curriculum?.levelId === 'zh-level-04')!
    const id = await startPractice('lesson', lesson.id)
    expect((await db.sessions.get(id))?.questions).toHaveLength(lesson.wordIds.length * 2)
    expect(await db.lessons.count()).toBe(1)
    expect(curriculumProgress(curriculumLevels[0], await loadWorkspace()).practiced).toBe(0)
    await expect(startPractice('lesson', 'zh-level-05:unavailable:part-1')).rejects.toThrow('not available')
  })

  it('completes recognition only and recommends the next unfinished small lesson', async () => {
    const lesson = curriculumLessons[0]
    const id = await startPractice('lesson', lesson.id)
    const session = (await db.sessions.get(id))!
    for (const [index, question] of session.questions.entries()) {
      await submitAnswer(id, index, question.wordId)
      await advancePractice(id, index)
    }
    const workspace = await loadWorkspace()
    expect(curriculumProgress(curriculumLevels[0], workspace)).toMatchObject({ practiced: 1, introduced: lesson.wordIds.length })
    expect(nextCurriculumLesson(workspace)?.id).toBe(curriculumLessons[1].id)
    expect(workspace.lessons).toHaveLength(1)
    expect(workspace.words.every(word => word.successfulDays.length === 1)).toBe(true)
    expect(workspace.lessons[0]).not.toHaveProperty('mastery')
    expect(workspace).not.toHaveProperty('grammar')
  })

  it('keeps introductions and lesson state atomic when session creation fails', async () => {
    vi.spyOn(db.sessions, 'add').mockRejectedValueOnce(new Error('Storage full'))
    await expect(startPractice('lesson', curriculumLessons[0].id)).rejects.toThrow('Storage full')
    expect(await db.words.count()).toBe(0)
    expect(await db.lessons.count()).toBe(0)
  })
})

describe('content-version compatible backups', () => {
  it('restores previous starter-only backups without changing IDs or their saved choices', async () => {
    const id = await startPractice('lesson', 'zh:greetings')
    const session = (await db.sessions.get(id))!
    session.questions.forEach(question => { question.options = ['zh:hello', 'zh:thanks', 'zh:tea', 'zh:rain'] })
    await db.sessions.put(session)
    await revealAnswer(id, 0)
    await submitAnswer(id, 0, session.questions[0].wordId)
    const original = await loadWorkspace()
    const old = { ...JSON.parse(exportBackup(original)), contentVersion: 1 }
    await startPractice('lesson', curriculumLessons[0].id)
    await restoreBackup(JSON.stringify(old))
    expect(await loadWorkspace()).toEqual(original)
    expect((await db.words.toArray()).every(word => starterWords.some(item => item.id === word.wordId))).toBe(true)
  })

  it('round-trips curriculum sessions and rejects future content versions before replacing data', async () => {
    const id = await startPractice('lesson', curriculumLessons[0].id)
    await revealAnswer(id, 0)
    await submitAnswer(id, 0, (await db.sessions.get(id))!.questions[0].wordId)
    const workspace = await loadWorkspace()
    const text = exportBackup(workspace)
    expect(JSON.parse(text).contentVersion).toBe(2)
    expect(readBackup(text)).toEqual(workspace)
    await advancePractice(id, 0)
    await restoreBackup(text)
    expect(await loadWorkspace()).toEqual(workspace)
    await expect(restoreBackup(JSON.stringify({ ...JSON.parse(text), contentVersion: 3 }))).rejects.toThrow()
    expect(await loadWorkspace()).toEqual(workspace)
  })
})
