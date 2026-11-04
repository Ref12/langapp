import { describe, expect, it } from 'vitest'
import { describeItems, newCharacters, worstMark, writtenCharacters } from './write-queue'

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
  it('treat a writeKnown character as written, without any practice completion', () => {
    const flagged = [...states, { character: '生', practiceCompletions: 0, writeKnown: true }]
    expect(writtenCharacters(flagged).has('生')).toBe(true)
    expect(newCharacters(['学生', '学习'], flagged, has)).toEqual(['习'])
    expect(describeItems([{ kind: 'vocabulary', zh: '学生' }, { kind: 'vocabulary', zh: '学习' }], flagged, has)).toBe('2 words · 1 new character')
  })
})
