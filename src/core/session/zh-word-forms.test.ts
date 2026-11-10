// The Chinese pack has no word-form questions: no Chinese set, preset or count contains them.
import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog, type Catalog } from '../study/catalog'
import { fillByItems } from '../study/daily'
import { loadItems } from '../drills/items'
import { zhPack, jaPack, koPack } from '../language'
import { planSession } from './plan'
import { loadSessionBank } from './sources'
import { BUILTIN_PRESETS } from './presets'
import { isFormOffered, offeredPreset } from './offered'
import { FORMS, WORD_FORMS } from './types'

let catalog: Catalog
beforeAll(async () => { catalog = await loadCatalog() }, 60000)

describe('Chinese has no word-form questions', () => {
  it('no set of any preset contains Conjugate or Which form is this?', async () => {
    const refs = fillByItems(catalog, new Set(), 5)
    const items = await loadItems(refs, catalog)
    const bank = await loadSessionBank(catalog, items, new Set(refs))
    for (const preset of BUILTIN_PRESETS) for (const length of ['standard', 'long'] as const) {
      const plan = planSession({ intent: 'practice-set', items, seed: 7, catalog, known: new Set(), bank: bank.byItem, allBank: bank.all, length, preset })
      expect(plan.stages.flatMap(stage => stage.exercises).filter(entry => WORD_FORMS.includes(entry.form)), preset.id).toEqual([])
    }
  }, 60000)
  it('the preset builder lists neither form for Chinese (the form list of EngineSet is the offered forms), and lists both for Japanese', () => {
    const listed = (pack: typeof zhPack) => FORMS.filter(form => isFormOffered(form, pack))
    expect(listed(zhPack)).not.toContain('conjugate')
    expect(listed(zhPack)).not.toContain('form-pick')
    expect(listed(jaPack)).toContain('conjugate')
    for (const preset of BUILTIN_PRESETS) expect(offeredPreset(preset, zhPack)).toBe(preset)
  })
  it('Korean has the entry, with the forms engine as it is, and no data: it asks nothing yet', () => {
    expect(koPack.wordForms.offered).toBe(true)
    expect(koPack.wordForms.exercises({ stage: 'produce', count: 3, words: [], pool: [], taught: new Set(), inflected: [], rng: () => 0.5 })).toEqual([])
  })
})
