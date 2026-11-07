import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog, type Catalog } from '../study/catalog'
import { loadItems } from '../drills/items'
import { phraseKey } from '../phrases/key'
import { usableFor } from '../phrases/bank'
import { planSession, stageRounds, type PlanInput } from './plan'
import { loadSessionBank } from './sources'
import { BUILTIN_PRESETS, DEFAULT_PRESET, presetFromCustom, SKILL_PRESETS } from './presets'
import { STAGES, type Form, type Length, type SessionExercise } from './types'

const REFS = ['wo3--me', 'ni3--you', 'shi4--identity', 'shu1--book', 'yao4--want'].map(ref => `vocabulary:${ref}`)
let catalog: Catalog
let base: Omit<PlanInput, 'length' | 'preset'>
let allowed: Set<string>

beforeAll(async () => {
  catalog = await loadCatalog()
  const refs = REFS.filter(ref => catalog.units.has(ref))
  const items = await loadItems(refs, catalog)
  // The learner knows the rest of HSK 1 and is practising these five (so Introduce teaches the five).
  const known = new Set([...catalog.units.values()].filter(unit => unit.kind === 'vocabulary' && unit.band === '1')  .map(unit => unit.ref).filter(ref => !REFS.includes(ref)))
  allowed = new Set([...known, ...refs])
  const bank = await loadSessionBank(catalog, items, allowed)
  base = { intent: 'practice-set', items, seed: 7, catalog, known, bank: bank.byItem, allBank: bank.all }
}, 60000)

const plan = (length: Length, preset = DEFAULT_PRESET) => planSession({ ...base, length, preset })
const all = (length: Length, preset = DEFAULT_PRESET) => plan(length, preset).stages.flatMap(stage => stage.exercises)
const graded = (list: SessionExercise[]) => list.filter(exercise => exercise.form !== 'intro')

describe('the planner', () => {
  it('has the five practice items to plan with', () => { expect(base.items.length).toBeGreaterThanOrEqual(4) })

  it('orders the stages introduce, recognise, recall, produce, use and teaches only items not yet known', () => {
    const result = plan('standard')
    const order = result.stages.map(stage => stage.stage)
    expect(order).toEqual(STAGES.filter(stage => order.includes(stage)))
    const intro = result.stages.find(stage => stage.stage === 'introduce')
    const unknown = base.items.filter(item => !base.known.has(item.ref)).map(item => item.ref)
    expect((intro?.exercises ?? []).map(exercise => exercise.refs[0])).toEqual(unknown.length ? expect.arrayContaining(unknown) : [])
  })

  it('gives about 4 exercises per item at Standard (about 20 for 5 items) and scales with Short and Long', () => {
    const standard = plan('standard').total, short = plan('short').total, long = plan('long').total
    const perItem = standard / base.items.length
    expect(perItem).toBeGreaterThanOrEqual(3)
    expect(perItem).toBeLessThanOrEqual(5.5)
    expect(short).toBeLessThan(standard)
    expect(short).toBeGreaterThanOrEqual(standard * 0.3)
    expect(long).toBeGreaterThanOrEqual(standard * 1.6)
    expect(long).toBeLessThanOrEqual(standard * 2.4)
  })

  it('never cuts a stage in half: a Short stage is whole or absent', () => {
    const rounds = stageRounds(DEFAULT_PRESET, 'short')
    const standard = stageRounds(DEFAULT_PRESET, 'standard')
    for (const stage of STAGES) expect([0, standard[stage]]).toContain(rounds[stage])
    const short = plan('short').stages.filter(entry => entry.stage !== 'introduce')
    const full = plan('standard').stages
    for (const entry of short) expect(entry.exercises.length).toBe(full.find(other => other.stage === entry.stage)!.exercises.length)
  })

  it('puts every item in every round of a stage, in mixed order across rounds', () => {
    const long = plan('long').stages.find(stage => stage.stage === 'recall')!
    const perItem = new Map<string, number>()
    for (const exercise of long.exercises) if (exercise.form !== 'match') for (const ref of exercise.refs) perItem.set(ref, (perItem.get(ref) ?? 0) + 1)
    for (const item of base.items) expect(perItem.get(item.ref) ?? 0).toBeGreaterThanOrEqual(long.rounds)
  })

  it('is the same plan for the same seed', () => {
    expect(JSON.stringify(plan('standard'))).toBe(JSON.stringify(plan('standard')))
  })
})

describe('the exercise bank forms, built from real phrases', () => {
  const forms = (list: SessionExercise[]) => new Set(list.map(exercise => exercise.form))
  it('builds every bank form from a real phrase across the presets', () => {
    const seen = new Set<Form>()
    for (const preset of BUILTIN_PRESETS) for (const length of ['standard', 'long'] as const) for (const form of forms(all(length, preset))) seen.add(form)
    for (const form of ['translate-zh-en', 'translate-en-zh', 'tiles', 'gap', 'listen-pick', 'dictation', 'repeat'] as const) expect(seen, form).toContain(form)
  })
  it('gives each bank exercise a model answer and a phrase that is in the shipped bank', () => {
    for (const exercise of all('long')) {
      if (exercise.form === 'tiles') { expect(exercise.tiles.length).toBeGreaterThanOrEqual(2); expect(exercise.accepted[0]).toBe(exercise.model) }
      if (exercise.form === 'gap') { expect(exercise.gapped).toContain('＿＿'); expect(exercise.options[exercise.answer]).toBeTruthy(); expect(exercise.options.length).toBeGreaterThanOrEqual(3) }
      if (exercise.form === 'listen-pick') { expect(exercise.options[exercise.answer]).toBeTruthy(); expect(new Set(exercise.options).size).toBe(exercise.options.length) }
      if (exercise.form === 'translate-en-zh') expect(exercise.accepted[0]).toBe(exercise.model)
    }
  })
})

describe('sentence rules', () => {
  const sentenceOf = (exercise: SessionExercise): string | undefined => {
    switch (exercise.form) {
      case 'translate-zh-en': case 'translate-en-zh': case 'dictation': return exercise.phrase?.zh ?? exercise.model
      case 'tiles': return exercise.model
      case 'gap': return exercise.sentence
      case 'listen-pick': return exercise.model
      case 'repeat': return exercise.zh
      default: return undefined
    }
  }
  it('uses no sentence twice in a session', () => {
    for (const length of ['standard', 'long'] as const) {
      const seen = new Set<string>()
      for (const exercise of all(length)) {
        const zh = sentenceOf(exercise)
        if (!zh) continue
        expect(seen.has(phraseKey(zh)), zh).toBe(false)
        seen.add(phraseKey(zh))
      }
    }
  })
  it('never uses a fallback sentence in Produce, or in any exercise where the learner writes Chinese', () => {
    for (const preset of BUILTIN_PRESETS) for (const exercise of all('long', preset)) {
      const writes = exercise.stage === 'produce' || exercise.form === 'translate-en-zh' || exercise.form === 'tiles' || exercise.form === 'dictation'
      if (!writes) continue
      expect('unknown' in exercise ? exercise.unknown : undefined, `${preset.id} ${exercise.form}`).toBeUndefined()
      const zh = sentenceOf(exercise)
      if (zh && exercise.form !== 'gap') {
        const phrase = [...base.allBank, ...[...base.bank.values()].flat()].find(candidate => phraseKey(candidate.zh) === phraseKey(zh))
        if (phrase) expect(usableFor(phrase, allowed), zh).toBe(true)
      }
    }
  })
})

describe('presets', () => {
  it('change which forms the stages use', () => {
    const used = (id: string) => new Set(graded(all('standard', BUILTIN_PRESETS.find(preset => preset.id === id)!)).map(exercise => exercise.form))
    expect(used('listening').has('listen-pick') || used('listening').has('dictation')).toBe(true)
    expect(used('listening').has('tiles')).toBe(false)
    expect(used('writing').has('choice') || used('writing').has('pinyin')).toBe(true)
    expect([...used('writing')].some(form => form === 'translate-en-zh' || form === 'tiles' || form === 'dictation')).toBe(true)
    expect(used('reading').has('dictation')).toBe(false)
    expect(used('speaking').has('tiles')).toBe(false)
    expect(SKILL_PRESETS.every(preset => JSON.stringify(preset.forms) !== JSON.stringify(DEFAULT_PRESET.forms))).toBe(true)
  })
  it('weights the stages differently: Writing has no Use stage, Reading has no Produce stage', () => {
    const stages = (id: string) => plan('standard', BUILTIN_PRESETS.find(preset => preset.id === id)!).stages.map(stage => stage.stage)
    expect(stages('writing')).not.toContain('use')
    expect(stages('reading')).not.toContain('produce')
  })
  it('a saved custom preset uses only the ticked stages and forms', () => {
    const preset = presetFromCustom({ id: 'mine', name: 'Mine', stages: ['recognise', 'use'], forms: ['choice', 'dictation'] })
    const result = plan('standard', preset)
    expect(result.stages.map(stage => stage.stage).every(stage => ['recognise', 'use'].includes(stage))).toBe(true)
    const names = new Set(graded(result.stages.flatMap(stage => stage.exercises)).map(exercise => exercise.form))
    expect([...names].every(form => ['choice', 'dictation', 'recall', 'pinyin', 'tiles', 'translate-zh-en', 'gap', 'listen-pick', 'match'].includes(form))).toBe(true)
    expect(names.has('dictation') || names.has('choice')).toBe(true)
  })
})
