// What the form boxes of "Build your own preset" do: a form joins the stages it suits, and an item the learner does not know yet never types the learned language
// (plan.ts: a Dictation or English-to-target question for a new item is the sentence builder). The same in Chinese and in Japanese: no pack decides it.
import { afterEach, describe, expect, it } from 'vitest'
import { loadItems } from '../drills/items'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { planSession } from './plan'
import { presetFromCustom } from './presets'
import { loadSessionBank } from './sources'
import { isVocabulary } from '../study/local-exercises'
import type { Form } from './types'

afterEach(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

async function formsOf(language: 'zh' | 'ja', only: Form, knownItems: boolean): Promise<Set<Form>> {
  setBuildLanguageForTests(language === 'ja' ? 'ja' : undefined)
  resetCatalogCache()
  const catalog: Catalog = await loadCatalog()
  const vocabulary = catalog.orderedGroups.slice(0, 6).flatMap(entry => entry.group.units.filter(unit => unit.kind === 'vocabulary').map(unit => `vocabulary:${unit.ref}`)).filter(ref => catalog.units.has(ref) && isVocabulary(catalog.units.get(ref)!))
  const refs = vocabulary.slice(-5)
  const items = await loadItems(refs, catalog)
  const known = new Set(knownItems ? vocabulary : vocabulary.filter(ref => !refs.includes(ref)))
  const allowed = new Set([...known, ...refs])
  const bank = await loadSessionBank(catalog, items, allowed)
  const preset = presetFromCustom({ id: 'custom', name: 'Only', forms: [only], stages: ['recognise', 'recall', 'produce', 'use'] })
  const plan = planSession({ intent: 'practice-set', items, seed: 7, catalog, known, bank: bank.byItem, allBank: bank.all, length: 'standard', preset })
  return new Set(plan.stages.flatMap(stage => stage.exercises.map(exercise => exercise.form)))
}

describe.each(['zh', 'ja'] as const)('a custom preset with only one kind ticked (%s)', language => {
  it('Dictation on new items is Word order, never a Dictation question', async () => {
    const forms = await formsOf(language, 'dictation', false)
    expect(forms.has('dictation')).toBe(false)
    expect(forms.has('tiles')).toBe(true)
  }, 60000)
  it('English to the language on new items is Word order too', async () => {
    const forms = await formsOf(language, 'translate-en-zh', false)
    expect(forms.has('translate-en-zh')).toBe(false)
    expect(forms.has('tiles')).toBe(true)
  }, 60000)
  it('Dictation on items the learner already knows is a Dictation question', async () => {
    expect((await formsOf(language, 'dictation', true)).has('dictation')).toBe(true)
  }, 60000)
  it('English to the language on known items is a typed question', async () => {
    expect((await formsOf(language, 'translate-en-zh', true)).has('translate-en-zh')).toBe(true)
  }, 60000)
})
