import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog, type Catalog } from '../study/catalog'
import { fillByItems } from '../study/daily'
import { loadItems } from '../drills/items'
import { planSession, producesChinese, type PlanInput } from './plan'
import { loadSessionBank } from './sources'
import { BUILTIN_PRESETS, DEFAULT_PRESET } from './presets'
import type { SessionExercise } from './types'

let catalog: Catalog
/** A fresh learner doing lesson N: the first N-1 sessions of 5 new items are known, session N's items are the new ones. */
async function lesson(number: number, preset = DEFAULT_PRESET, seed = 7) {
  let known = new Set<string>()
  let refs: string[] = []
  for (let at = 1; at <= number; at++) { refs = fillByItems(catalog, known, 5); if (at < number) known = new Set([...known, ...refs]) }
  const items = await loadItems(refs, catalog)
  const allowed = new Set([...known, ...refs])
  const bank = await loadSessionBank(catalog, items, allowed)
  const input: PlanInput = { intent: 'practice-set', items, seed, catalog, known, bank: bank.byItem, allBank: bank.all, length: 'standard', preset }
  return { input, plan: planSession(input), known, refs }
}
const flat = (plan: ReturnType<typeof planSession>) => plan.stages.flatMap(stage => stage.exercises)
const typedChinese = (exercise: SessionExercise) => 'answerLang' in exercise && exercise.answerLang === 'zh'

beforeAll(async () => { catalog = await loadCatalog() }, 60000)

describe('new items produce with tiles', () => {
  it('never types Chinese for a new item, in any preset (Produce, retries and Use)', async () => {
    for (const preset of BUILTIN_PRESETS) {
      const { plan, known } = await lesson(6, preset)
      for (const exercise of flat(plan)) {
        if (exercise.refs.length === 1 && !known.has(exercise.refs[0])) expect(typedChinese(exercise), preset.id + ' ' + exercise.form).toBe(false)
        if (exercise.refs.length && exercise.refs.every(ref => !known.has(ref))) expect(producesChinese(exercise.form) && exercise.form !== 'tiles', preset.id + ' ' + exercise.form).toBe(false)
      }
    }
  }, 120000)
  it('Writing gives tiles where it asked for translate and dictation', async () => {
    const writing = BUILTIN_PRESETS.find(preset => preset.id === 'writing')!
    const forms = flat((await lesson(6, writing)).plan).map(exercise => exercise.form)
    expect(forms).toContain('tiles')
    expect(forms).not.toContain('translate-en-zh')
    expect(forms).not.toContain('dictation')
  }, 60000)
  it('items that were already known still get typed forms', async () => {
    const { input, refs } = await lesson(6)
    const writing = BUILTIN_PRESETS.find(preset => preset.id === 'writing')!
    const plan = planSession({ ...input, preset: writing, known: new Set([...input.known, ...refs]) })
    expect(flat(plan).some(typedChinese)).toBe(true)
  }, 60000)
})

describe('flagged fallback sentences (counted, not changed)', () => {
  it('counts the flagged sentences in a fresh learner Default Standard plan at lessons 6, 11 and 20', async () => {
    const rows: string[] = []
    for (const number of [6, 11, 20]) {
      const { plan } = await lesson(number)
      const list = flat(plan).filter(exercise => exercise.form !== 'intro')
      const flagged = list.filter(exercise => 'unknown' in exercise && exercise.unknown)
      rows.push(`lesson ${number}: ${flagged.length} flagged of ${list.length} exercises (${flagged.map(exercise => exercise.form).join(', ')})`)
    }
    console.log('FLAGGED ' + rows.join(' | '))
    expect(rows).toHaveLength(3)
  }, 120000)
})
