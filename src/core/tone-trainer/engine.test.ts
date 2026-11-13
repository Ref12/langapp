// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { confusionRows, emptyProgress, pickRound, recordAnswer, stageAccuracy, stageUnlocked, unlockedStages, UNLOCK_WINDOW, type TrainerAnswer, type TrainerProgress } from './engine'
import type { ToneManifest } from './manifest'

const single = (base: string, tone: number) => ({ id: 's-' + base + tone, kind: 'single' as const, chars: 'x', pinyin: base + tone, tones: [tone], clips: { a: { file: 'a/x.mp3', chars: 'x' }, b: { file: 'b/x.mp3', chars: 'x' } } })
const manifest: ToneManifest = { version: 1, voices: [], items: ['ba', 'ma', 'di', 'shu'].flatMap(base => [1, 2, 3, 4].map(tone => single(base, tone))) }
const answer = (correct: boolean, stage: 1 | 2 | 3 = 1, extra: Partial<TrainerAnswer> = {}): TrainerAnswer => ({ stage, item: 's-ba1', voice: 'a', heard: [1], chosen: [correct ? 1 : 4], correct, at: 1, ...extra })
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const rate = (picks: ReturnType<typeof pickRound>, a: number, b: number) => picks.filter(p => a === p.item.tones[0] || b === p.item.tones[0]).length

describe('the stage unlock rule', () => {
  it('opens the next stage at 85% over the last 40 answers of a stage, and not before', () => {
    const run = (right: number, total: number) => [...Array(total).keys()].map(i => answer(i < right))
    expect(unlockedStages([])).toEqual([1])
    expect(stageAccuracy(run(30, 39), 1)).toBeUndefined()
    expect(stageUnlocked(run(30, 39), 2)).toBe(false)
    expect(stageUnlocked(run(33, 40), 2)).toBe(false)
    expect(stageUnlocked(run(34, 40), 2)).toBe(true)
    expect(unlockedStages([...run(34, 40), ...Array(UNLOCK_WINDOW).fill(0).map(() => answer(true, 2))])).toEqual([1, 2, 3])
  })
  it('only the last 40 count: old misses fall out of the window', () => {
    const answers = [...Array(20).fill(0).map(() => answer(false)), ...Array(40).fill(0).map(() => answer(true))]
    expect(stageUnlocked(answers, 2)).toBe(true)
  })
})

describe('the adaptive picker', () => {
  it('a learner who confuses tones 2 and 3 gets more 2 and 3 items in stage 2', () => {
    const confused: TrainerProgress = [...Array(30)].reduce<TrainerProgress>(p => recordAnswer(p, answer(false, 2, { heard: [2], chosen: [3] })), emptyProgress())
    let plain = 0, adapted = 0
    for (let seed = 1; seed <= 30; seed++) { plain += rate(pickRound(manifest, 2, emptyProgress(), rng(seed), 20), 2, 3); adapted += rate(pickRound(manifest, 2, confused, rng(seed), 20), 2, 3) }
    expect(adapted).toBeGreaterThan(plain * 1.25)
  })
  it('serves the voices the learner misses more often', () => {
    const missesB: TrainerProgress = [...Array(20)].reduce<TrainerProgress>(p => recordAnswer(p, answer(false, 2, { voice: 'b' })), emptyProgress())
    let b = 0, total = 0
    for (let seed = 1; seed <= 30; seed++) for (const pick of pickRound(manifest, 2, missesB, rng(seed), 20)) { total++; if (pick.voice === 'b') b++ }
    expect(b / total).toBeGreaterThan(0.55)
  })
  it('stage 1 starts with the 1 versus 4 contrast and offers two tones', () => {
    for (const pick of pickRound(manifest, 1, emptyProgress(), rng(3), 20)) { expect(pick.options).toEqual([1, 4]); expect([1, 4]).toContain(pick.item.tones[0]) }
  })
  it('gives rounds of 20 and keeps a tally of what was heard as what', () => {
    expect(pickRound(manifest, 2, emptyProgress(), rng(5))).toHaveLength(20)
    const p = recordAnswer(recordAnswer(emptyProgress(), answer(false, 2, { heard: [2], chosen: [3] })), answer(false, 2, { heard: [2], chosen: [3] }))
    expect(confusionRows(p)).toEqual([{ heard: 2, chosen: 3, count: 2 }])
  })
})
