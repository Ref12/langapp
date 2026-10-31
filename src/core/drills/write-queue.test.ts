import { describe, expect, it } from 'vitest'
import { describeItems, newCharacters, worstMark, writeQueue } from './write-queue'

const has = () => true
const words = [{ ref: 'vocabulary:xue2-sheng5', zh: '学生' }, { ref: 'vocabulary:xue2-xi2', zh: '学习' }, { ref: 'vocabulary:ni3', zh: '你' }]

describe('the Write it character queue', () => {
  it('lists every distinct character once, however many words share it', () => {
    const queue = writeQueue(words, { seed: 's', pass: 0, has })
    expect(queue.map(entry => entry.char).sort()).toEqual(['你', '学', '生', '习'].sort())
    expect(queue.find(entry => entry.char === '学')!.words).toEqual(['vocabulary:xue2-sheng5', 'vocabulary:xue2-xi2'])
  })
  it('is shuffled across words, and stable for a seed and pass', () => {
    const again = writeQueue(words, { seed: 's', pass: 0, has }).map(entry => entry.char)
    expect(writeQueue(words, { seed: 's', pass: 0, has }).map(entry => entry.char)).toEqual(again)
    const orders = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(seed => writeQueue(words, { seed, pass: 0, has }).map(entry => entry.char).join('')))
    expect(orders.size).toBeGreaterThan(1)
  })
  it('rotates the cue word of a shared character from pass to pass, with its syllable index', () => {
    const cue = (pass: number) => writeQueue(words, { seed: 's', pass, has }).find(entry => entry.char === '学')!
    expect(cue(0).cue).not.toBe(cue(1).cue)
    expect(cue(0).cue).toBe(cue(2).cue)
    expect(cue(0).index).toBe(0)
    expect(writeQueue(words, { seed: 's', pass: 0, has }).find(entry => entry.char === '习')!.index).toBe(1)
  })
  it('leaves out characters without a stroke guide and those that already have a result', () => {
    expect(writeQueue(words, { seed: 's', pass: 0, has: character => character !== '你', skip: new Set(['学']) }).map(entry => entry.char).sort()).toEqual(['生', '习'].sort())
  })
})

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
