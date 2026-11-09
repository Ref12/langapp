import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../database'
import { loadParallel, resetParallel, type ParallelLanguage } from './data'
import { addParallelKnowledge, parallelDue, parallelKnown, recordParallelResult } from './practice'
import { isParallelRef, parallelRef, parallelRefsOf } from './refs'
import { gradeTiles, itemsUpTo, lessonItems, normaliseTile, planParallel, usablePhrases } from './session'
import { dueCards } from '../study/knowledge'
import { replay } from '../backup/journal'
import { romanizeKorean } from './romanize'

beforeEach(async () => { resetParallel(); await db.delete(); await db.open(); await initializeWorkspace() })

describe('parallel session planning', () => {
  it.each<[ParallelLanguage, number]>([['ja', 4], ['ko', 3]])('plans lesson 1 for %s: meet, recognise, use, with language-prefixed ids', async (language, grammarPoints) => {
    const data = await loadParallel(language)
    const refs = lessonItems(data, language, data.lessons[0]).map(item => item.ref)
    expect(refs).toHaveLength(3 + grammarPoints)
    expect(refs.every(ref => ref.startsWith(language + ':w:') || ref.startsWith(language + ':g:'))).toBe(true)
    const plan = planParallel({ language, data, intent: 'lesson', lessonNumber: 1, refs, known: new Set(), length: 'standard', seed: 7 })
    expect(plan.language).toBe(language)
    expect(plan.stages.map(stage => stage.stage)).toEqual(['introduce', 'recognise', 'use'])
    const forms = new Set(plan.stages.flatMap(stage => stage.exercises.map(exercise => exercise.form)))
    expect([...forms].sort()).toEqual(['choice', 'conjugate', 'form-pick', 'intro', 'listen-pick', 'match', 'tiles'])
    for (const exercise of plan.stages.flatMap(stage => stage.exercises)) expect(exercise.refs.every(isParallelRef)).toBe(true)
  })

  it('only uses phrases that are strict at the lesson', async () => {
    const data = await loadParallel('ja')
    const lesson1 = usablePhrases(data, 1)
    expect(lesson1.length).toBeGreaterThan(0)
    const introduced = new Set(data.lessons[0].words.map(word => word.entry))
    for (const phrase of lesson1) expect(phrase.words.every(id => introduced.has(id))).toBe(true)
  })

  it('knows every item of a track by its prefixed ref', async () => {
    const data = await loadParallel('ko')
    const all = itemsUpTo(data, 'ko', 87)
    expect(all.size).toBeGreaterThan(100)
    expect([...all.keys()].every(ref => ref.startsWith('ko:'))).toBe(true)
  })
})

describe('tile grading', () => {
  it('grades on token order, ignoring spaces and full-/half-width punctuation', () => {
    const model = ['私', 'は', '学生', 'です']
    expect(gradeTiles('ja', ['私', 'は', '学生', 'です', '。'], [model]).correct).toBe(true)
    expect(gradeTiles('ja', ['私', 'は', ' 学生', 'です', '.'], [model]).correct).toBe(true)
    expect(normaliseTile('学生です！')).toBe('学生です')
    expect(gradeTiles('ja', ['学生', 'は', '私', 'です'], [model]).correct).toBe(false)
  })

  it('treats particles as tiles and explains a wrong one', () => {
    const ja = gradeTiles('ja', ['私', 'が', '学生', 'です'], [['私', 'は', '学生', 'です']])
    expect(ja.correct).toBe(false)
    expect(ja.wrong).toEqual([{ position: 1, given: 'が', expected: 'は', particle: true }])
    expect(ja.messages[0]).toContain('が marks the subject')
    expect(ja.messages[0]).toContain('needs は')
    const ko = gradeTiles('ko', ['학생', '는', '공부해요'], [['학생', '은', '공부해요']])
    expect(ko.correct).toBe(false)
    expect(ko.messages[0]).toContain('는 marks the topic after a vowel')
  })

  it('romanizes Korean for the reading aid', () => { expect(romanizeKorean('저는 학생')).toBe('jeoneun haksaeng') })
})

describe('knowledge and reviews per language', () => {
  it('keeps Japanese and Korean records apart from Chinese and from each other', async () => {
    const now = Date.now()
    await addParallelKnowledge([parallelRef('ja', 'w', 'ja-n5-00679'), parallelRef('ko', 'w', 'ko-nikl-24021')], now)
    await recordParallelResult(parallelRef('ja', 'w', 'ja-n5-00679'), false, false, now + 1000)
    expect(await db.knowledge.count()).toBe(2)
    expect([...await parallelKnown('ja')]).toEqual(['ja:w:ja-n5-00679'])
    expect([...await parallelKnown('ko')]).toEqual(['ko:w:ko-nikl-24021'])
    const later = now + 30 * 86_400_000
    expect((await parallelDue('ja', later)).map(card => card.ref)).toEqual(['ja:w:ja-n5-00679'])
    expect((await parallelDue('ko', later)).map(card => card.ref)).toEqual(['ko:w:ko-nikl-24021'])
    // Chinese code never sees them
    expect(await dueCards(later)).toEqual([])
    const workspace = await loadWorkspace()
    expect(workspace.knowledge).toEqual([])
    expect(workspace.studyCards).toEqual([])
  })

  it('ignores records of a language this build does not know', async () => {
    await db.knowledge.put({ ref: 'fr:w:bonjour', kind: 'vocabulary', lb: 'bonjour', band: '1', addedAt: 1, source: 'new' })
    await db.studyCards.put({ id: 'fr:w:bonjour:reading', ref: 'fr:w:bonjour', domain: 'reading', due: 1, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 'new', updatedAt: 1 })
    await db.knowledge.put({ ref: 'ja:w:ja-n5-00679', kind: 'vocabulary', lb: 'ja-n5-00679', band: '1', addedAt: 1, source: 'new' })
    const workspace = await loadWorkspace()
    expect(workspace.knowledge).toEqual([])
    expect(workspace.studyCards).toEqual([])
    expect(await dueCards(Date.now())).toEqual([])
    expect(await parallelKnown('ja')).toEqual(new Set(['ja:w:ja-n5-00679']))
    expect(parallelRefsOf('ko', ['fr:w:x', 'ja:w:ja-n5-1'])).toEqual([])
    // a journal from a build with a newer language replays without failing
    const state = replay([{ t: '2026-01-01T00:00:00.000Z', op: 'add', ref: 'fr:w:bonjour', band: 1, source: 'new' }, { t: '2026-01-01T00:00:01.000Z', op: 'add', ref: 'ja:w:ja-n5-00679', band: 1, source: 'new' }])
    expect(state.knowledge.get('ja:w:ja-n5-00679')?.kind).toBe('vocabulary')
  })
})
