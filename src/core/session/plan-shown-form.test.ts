import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPack } from '../language'
import { activeDisplayForm, headwordFor } from '../forms/display'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { loadItems } from '../drills/items'
import { planSession, type PlanInput } from './plan'
import { loadSessionBank } from './sources'
import { BUILTIN_PRESETS } from './presets'
import type { Form, SessionExercise, ChoiceItem, MatchItem, TextItem } from './types'

// Practice shows a vocabulary word in the form the learner chose ("Show verbs as"), as the Lessons cards do. The item's ref and what is recorded stay the word's.
let catalog: Catalog
let base: Omit<PlanInput, 'shown'>
let verb: string

beforeAll(async () => {
  setBuildLanguageForTests('ja')
  resetCatalogCache()
  catalog = await loadCatalog()
  const vocabulary = [...catalog.units.values()].filter(unit => unit.kind === 'vocabulary')
  verb = vocabulary.find(unit => unit.record.ch === '勉強する')!.ref
  const others = vocabulary.filter(unit => unit.ref !== verb).slice(0, 8).map(unit => unit.ref)
  const refs = [verb, ...others]
  const items = await loadItems(refs, catalog)
  const known = new Set(refs)
  const bank = await loadSessionBank(catalog, items, known)
  base = { intent: 'practice-set', items, seed: 5, catalog, known, bank: bank.byItem, allBank: bank.all, length: 'long', preset: BUILTIN_PRESETS[0] }
}, 60000)
afterAll(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

const shownFor = (chosen: string | undefined) => {
  const pack = getPack(), form = activeDisplayForm(pack, chosen)
  return (record: Parameters<typeof headwordFor>[2]) => headwordFor(pack.displayForms, form, record)
}
const exercises = (chosen: string | undefined, preset = base.preset): SessionExercise[] => planSession({ ...base, preset, shown: shownFor(chosen) }).stages.flatMap(stage => stage.exercises)
const only = (forms: Form[]) => ({ ...base.preset, forms: { recognise: forms, recall: forms, produce: forms, use: forms }, rounds: { recognise: 2, recall: 2, produce: 2, use: 2 } })
const POLITE = '勉強します', DICTIONARY = '勉強する'

describe('Practice shows the verb form the learner chose', () => {
  it('Choose the meaning: the polite form by default, the dictionary form when chosen', () => {
    const choice = (chosen?: string) => exercises(chosen, only(['choice'])).filter((exercise): exercise is ChoiceItem => exercise.form === 'choice' && exercise.refs[0] === verb)
    for (const exercise of choice(undefined)) expect(exercise.direction === 'zh-to-en' ? exercise.question : exercise.options.join('|')).toContain(POLITE)
    expect(choice(undefined).length).toBeGreaterThan(0)
    for (const exercise of choice('dict')) expect(exercise.direction === 'zh-to-en' ? exercise.question : exercise.options.join('|')).not.toContain(POLITE)
    expect(choice('dict').some(exercise => exercise.question === DICTIONARY || exercise.options.includes(DICTIONARY))).toBe(true)
    expect(choice('dict')[0].refs).toEqual([verb])
  })
  it('Match: the cell of the verb', () => {
    const cells = (chosen?: string) => exercises(chosen, only(['match'])).filter((exercise): exercise is MatchItem => exercise.form === 'match').flatMap(exercise => exercise.pairs).filter(pair => pair.ref === verb).map(pair => pair.left)
    expect(cells(undefined)).toContain(POLITE)
    expect(cells('masu')).toContain(POLITE)
    expect(cells('dict')).toContain(DICTIONARY)
    expect(cells('dict')).not.toContain(POLITE)
  })
  it('Type the meaning and the typed reading: the prompt and the reading of the shown form', () => {
    const typed = (form: Form, chosen?: string) => exercises(chosen, only([form])).filter((exercise): exercise is TextItem => exercise.form === form && exercise.refs[0] === verb)
    for (const exercise of typed('recall')) { expect(exercise.prompt).toBe(POLITE); expect(exercise.hearText).toBe(POLITE) }
    for (const exercise of typed('recall', 'dict')) expect(exercise.prompt).toBe(DICTIONARY)
    const reading = typed('pinyin')
    expect(reading.length).toBeGreaterThan(0)
    for (const exercise of reading) { expect(exercise.prompt).toBe(POLITE); expect(exercise.accepted).toEqual(['べんきょうします']); expect(exercise.refs).toEqual([verb]) }
    for (const exercise of typed('pinyin', 'dict')) expect(exercise.accepted).toEqual(['べんきょうする'])
  })
  it('without a shown form the words are as stored (Chinese, and a pack with no choice)', () => {
    const stored = planSession({ ...base, preset: only(['recall']) }).stages.flatMap(stage => stage.exercises)
    expect((stored.find(exercise => exercise.refs[0] === verb) as TextItem).prompt).toBe(DICTIONARY)
  })
})
