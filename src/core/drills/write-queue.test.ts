import { describe, expect, it } from 'vitest'
import { describeItems, newCharacters, worstMark } from './write-queue'

const has = () => true
describe('worst-character grading', () => {
  it('takes the worst result of a word\'s characters', () => {
    expect(worstMark(['got', 'got'])).toBe('got')
    expect(worstMark(['got', 'hint'])).toBe('hint')
    expect(worstMark(['hint', 'missed', 'got'])).toBe('missed')
  })
})

describe('new characters', () => {
  const states = [{ character: '学', practiceCompletions: 1 }, { character: '生', practiceCompletions: 0 }]
  it('are the guided characters never written successfully', () => {
    expect(newCharacters(['学生', '学习'], states, has).sort()).toEqual(['习', '生'].sort())
  })
  it('make the breakdown of words, grammar patterns and new characters', () => {
    expect(describeItems([{ kind: 'vocabulary', zh: '学生' }, { kind: 'vocabulary', zh: '学习' }, { kind: 'grammar', zh: '把' }], states, has)).toBe('2 words · 1 grammar pattern · 2 new characters')
  })
})
