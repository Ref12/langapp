import { beforeEach, describe, expect, it } from 'vitest'
import { loadWriteChoice, saveWriteChoice } from './write-choice'
import { buildQuestions, grade, DEFAULT_OPTIONS, type Q } from './tasks'
import { storageNames } from '../../core/storage-names'

beforeEach(() => localStorage.clear())

describe('Write it options', () => {
  it('start on the pad for new-item and lesson sets and on Write elsewhere for the rest', () => {
    expect(loadWriteChoice('new')).toEqual({ writeMode: 'pad' })
    expect(loadWriteChoice('lesson')).toEqual({ writeMode: 'pad' })
    expect(loadWriteChoice('review')).toEqual({ writeMode: 'paper' })
  })
  it('remember the last writing mode and drop the old unit and learn/test choices', () => {
    localStorage.setItem(storageNames().local.writeDrill, JSON.stringify({ unit: 'words', style: 'learn', reviewMode: 'pad' }))
    expect(loadWriteChoice('review')).toEqual({ writeMode: 'pad' })
    saveWriteChoice({ writeMode: 'paper' })
    expect(JSON.parse(localStorage.getItem(storageNames().local.writeDrill)!)).toEqual({ mode: 'paper' })
    expect(loadWriteChoice('new')).toEqual({ writeMode: 'paper' })
  })
})

describe('Learn to write and Write it questions', () => {
  const item = { ref: 'vocabulary:xue2-sheng5--student', kind: 'vocabulary' as const, zh: '学生', py: 'xué sheng', en: 'student' }
  const sentence = { zh: '他是学生。', py: 'x', en: 'x', source: 'catalog' as const }
  const build = (type: 'learn' | 'write', writeMode: 'pad' | 'paper' = 'paper') => buildQuestions(type, { setId: 's', items: [item], catalog: {} as never, known: new Set(), content: { state: 'ready', sentences: { [item.ref]: sentence }, conversations: [] }, options: { ...DEFAULT_OPTIONS, writeMode } })
  it('Learn to write has a question per word and records Got it, never a miss', () => {
    const [q] = build('learn')
    expect(q.data).toEqual({ t: 'learn', item })
    expect(grade(q, { misses: 9, hinted: true, skipped: true })).toMatchObject({ correct: true, marks: { [item.ref]: 'got' } })
  })
  it('Write it is a test of one word from memory, with no teaching', () => {
    const [q] = build('write', 'pad')
    expect(q.data).toEqual({ t: 'write', item, sentence, mode: 'pad' })
    expect((grade(q as Q, { misses: 0, hinted: false, skipped: true }) as { marks: Record<string, string> }).marks[item.ref]).toBe('missed')
    expect((grade(q as Q, { misses: 0, hinted: true }) as { marks: Record<string, string> }).marks[item.ref]).toBe('hint')
    expect((grade(q as Q, { misses: 0, hinted: false }) as { marks: Record<string, string> }).marks[item.ref]).toBe('got')
  })
})
