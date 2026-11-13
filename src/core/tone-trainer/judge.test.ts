import { describe, expect, it } from 'vitest'
import { calibrate } from './calibration'
import { hintFor, judgeRecording } from './judge'
import { fourTones, join, RATE, silence, syllable } from './synth'

const range = calibrate(fourTones(120, 240), RATE)!
const say = (...hz: number[]) => join(syllable(...hz), silence(0.3))

describe('judgeRecording', () => {
  it('hears each tone said in the learner\'s range', () => {
    expect(judgeRecording(say(225, 225), RATE, [1], range).heard).toEqual([1])
    expect(judgeRecording(say(150, 230), RATE, [2], range).heard).toEqual([2])
    expect(judgeRecording(say(135, 120, 125), RATE, [3], range).heard).toEqual([3])
    expect(judgeRecording(say(235, 125), RATE, [4], range).heard).toEqual([4])
  })
  it('right: no hint; wrong: says what was heard and gives a hint', () => {
    const right = judgeRecording(say(150, 230), RATE, [2], range)
    expect(right).toMatchObject({ status: 'ok', correct: true, hint: '' })
    const wrong = judgeRecording(say(135, 120, 125), RATE, [2], range)
    expect(wrong).toMatchObject({ correct: false, heard: [3], hint: 'Start higher and rise all the way.' })
  })
  it('judges each syllable of a word, cut at the pause', () => {
    const word = join(syllable(225, 225), syllable(235, 125), silence(0.3))
    const result = judgeRecording(word, RATE, [1, 4], range)
    expect(result.heard).toEqual([1, 4]); expect(result.correct).toBe(true); expect(result.curves).toHaveLength(2)
    const miss = judgeRecording(join(syllable(225, 225), syllable(225, 225), silence(0.3)), RATE, [1, 4], range)
    expect(miss).toMatchObject({ correct: false, heard: [1, 1] })
  })
  it('accepts a low falling contour as the third tone, in a word\'s first syllable too', () => {
    expect(judgeRecording(say(150, 112), RATE, [3], range).correct).toBe(true)
    const word = join(syllable(150, 112), syllable(225, 225), silence(0.3))
    expect(judgeRecording(word, RATE, [3, 1], range)).toMatchObject({ heard: [3, 1], correct: true })
  })
  it('too little voice is not judged', () => {
    expect(judgeRecording(silence(2), RATE, [2], range).status).toBe('quiet')
    expect(judgeRecording(join(silence(0.5), syllable(200, 200).slice(0, 2000)), RATE, [2], range).status).toBe('quiet')
  })
  it('without a calibration it uses a provisional range from the recording and says so', () => {
    const result = judgeRecording(say(150, 230), RATE, [2])
    expect(result.status).toBe('ok'); expect(result.provisional).toBe(true); expect(result.range).toBeDefined()
  })
  it('hints for the common mix-ups', () => {
    expect(hintFor(2, 3)).toMatch(/rise all the way/); expect(hintFor(1, 3)).toMatch(/high/); expect(hintFor(4, 1)).toMatch(/start high and drop fast/i); expect(hintFor(2, 2)).toBe('')
  })
})
