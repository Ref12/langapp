import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS } from './presets'
import { isFormOffered, offeredPreset } from './offered'
import { takesWordForms } from './word-form-plan'
import { DATASET_FORMS, FORMS, WORD_FORMS } from './types'
import { drillTypeOffered } from '../drills/offered'
import { DRILL_TYPES } from '../drills/contracts'
import { jaPack, koPack, zhPack } from '../language'

describe('which forms and drill types a build offers', () => {
  it('Chinese has a dataset and no word forms: every form but the two word forms, every preset object and every drill type is as it was', () => {
    for (const form of FORMS) expect(isFormOffered(form, zhPack)).toBe(!WORD_FORMS.includes(form))
    for (const preset of BUILTIN_PRESETS) expect(offeredPreset(preset, zhPack)).toBe(preset)
    expect(DRILL_TYPES.every(entry => drillTypeOffered(entry, zhPack))).toBe(true)
  })
  it('Japanese and Korean have none: the dataset forms are taken out of every stage of every preset', () => {
    for (const pack of [jaPack, koPack]) {
      for (const form of DATASET_FORMS) expect(isFormOffered(form, pack)).toBe(false)
      for (const preset of BUILTIN_PRESETS) {
        const offered = offeredPreset(preset, pack)
        expect(Object.values(offered.forms).flat().filter(form => DATASET_FORMS.includes(form!))).toEqual([])
        expect(offered.rounds).toEqual(preset.rounds)
      }
    }
  })
  it('Japanese offers the two word forms, Chinese does not: they are planned, listed and counted only for a pack that has them', () => {
    expect(WORD_FORMS).toEqual(['conjugate', 'form-pick'])
    for (const form of WORD_FORMS) { expect(isFormOffered(form, jaPack)).toBe(true); expect(isFormOffered(form, zhPack)).toBe(false) }
    expect(zhPack.wordForms.offered).toBe(false)
    expect(jaPack.wordForms.offered).toBe(true)
    for (const preset of BUILTIN_PRESETS) {
      expect(Object.values(offeredPreset(preset, zhPack).forms).flat().filter(form => WORD_FORMS.includes(form!))).toEqual([])
      expect(offeredPreset(preset, jaPack).rounds).toEqual(preset.rounds)
    }
    // The built-in sets carry them as `wordForms` stages, not in their form lists; the planner asks takesWordForms.
    expect(takesWordForms(BUILTIN_PRESETS[0], 'produce', jaPack)).toBe(true)
    expect(takesWordForms(BUILTIN_PRESETS[0], 'recognise', jaPack)).toBe(true)
    expect(takesWordForms(BUILTIN_PRESETS[0], 'recall', jaPack)).toBe(false)
    expect(takesWordForms(BUILTIN_PRESETS[0], 'produce', zhPack)).toBe(false)
    expect(takesWordForms({ ...BUILTIN_PRESETS[0], wordForms: undefined, forms: { produce: ['conjugate'] } }, 'produce', jaPack)).toBe(true)
    expect(takesWordForms({ ...BUILTIN_PRESETS[0], wordForms: undefined, forms: { produce: ['conjugate'] } }, 'produce', zhPack)).toBe(false)
  })
  it('without the model the conversation types are not offered; Japanese has the writing area, so Learn to write / Write it are', () => {
    const offered = DRILL_TYPES.filter(entry => drillTypeOffered(entry, jaPack)).map(entry => entry.id)
    expect(offered).toEqual(['meanings', 'match', 'learn', 'write', 'pinyin', 'translate', 'repeat'])
  })
  it('Korean has the writing area on, so Learn to write / Write it are offered', () => {
    const offered = DRILL_TYPES.filter(entry => drillTypeOffered(entry, koPack)).map(entry => entry.id)
    expect(offered).toEqual(['meanings', 'match', 'learn', 'write', 'pinyin', 'translate', 'repeat'])
  })
})
