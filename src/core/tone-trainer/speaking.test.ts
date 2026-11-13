import { describe, expect, it } from 'vitest'
import { trainerProgressSchema } from './contracts'
import { emptyProgress } from './engine'
import type { ToneManifest } from './manifest'
import { pickSpeakRound, recordSpeakAnswer, speakAccuracy, speakStageUnlocked, type SpeakAnswer } from './speaking'

const answer = (correct: boolean, at: number, stage: 1 | 2 = 1): SpeakAnswer => ({ stage, item: 's-ba1', voice: 'xiaoxiao', expected: [1], heard: [correct ? 1 : 3], correct, at })
const manifest: ToneManifest = { version: 1, voices: [], items: [
  { id: 's-ba1', kind: 'single', chars: '巴', pinyin: 'ba1', tones: [1], clips: { xiaoxiao: { file: 'a', chars: '巴' } } },
  { id: 's-ba2', kind: 'single', chars: '拔', pinyin: 'ba2', tones: [2], clips: { xiaoxiao: { file: 'b', chars: '拔' } } },
  { id: 'w-ba1-ba4', kind: 'pair', chars: '爸爸', pinyin: 'ba1 ba4', tones: [1, 4], clips: { yunxi: { file: 'c', chars: '爸爸' } } },
  { id: 'w-ma1-ma5', kind: 'pair', chars: '妈妈', pinyin: 'ma1 ma5', tones: [1, 5], clips: { yunxi: { file: 'd', chars: '妈妈' } } },
] }

describe('the speaking practice rules', () => {
  it('unlocks stage 2 at 85% over 40 first tries in stage 1, like the listening stages', () => {
    const rows = (right: number) => Array.from({ length: 40 }, (_, i) => answer(i < right, i))
    expect(speakStageUnlocked([], 1)).toBe(true); expect(speakStageUnlocked([], 2)).toBe(false)
    expect(speakStageUnlocked(rows(33), 2)).toBe(false); expect(speakStageUnlocked(rows(34), 2)).toBe(true)
    expect(speakAccuracy(rows(34).slice(0, 39), 1)).toBeUndefined()
  })
  it('picks singles for stage 1 and words for stage 2, never a neutral tone', () => {
    expect(pickSpeakRound(manifest, 1, undefined, Math.random, 6).every(r => r.item.kind === 'single')).toBe(true)
    const pairs = pickSpeakRound(manifest, 2, undefined, Math.random, 6)
    expect(pairs.length).toBe(6); expect(pairs.every(r => r.item.id === 'w-ba1-ba4')).toBe(true)
  })
  it('keeps speaking answers apart from the listening ones, in the same row, and the backup schema accepts them', () => {
    const progress = { ...emptyProgress(), speaking: recordSpeakAnswer(undefined, answer(true, 1)) }
    expect(progress.answers).toEqual([]); expect(progress.speaking.answers).toHaveLength(1)
    expect(trainerProgressSchema.safeParse({ ...progress, speaking: { ...progress.speaking, range: [110, 230], rangeAt: 5 } }).success).toBe(true)
    expect(trainerProgressSchema.safeParse(emptyProgress()).success).toBe(true)
    expect(trainerProgressSchema.safeParse({ ...progress, speaking: { answers: [], extra: 1 } }).success).toBe(false)
  })
})
