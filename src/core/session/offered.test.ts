import { describe, expect, it } from 'vitest'
import { BUILTIN_PRESETS } from './presets'
import { isFormOffered, offeredPreset } from './offered'
import { DATASET_FORMS, FORMS } from './types'
import { drillTypeOffered } from '../drills/offered'
import { DRILL_TYPES } from '../drills/contracts'
import { jaPack, koPack, zhPack } from '../language'

describe('which forms and drill types a build offers', () => {
  it('Chinese has a dataset: every form, every preset object and every drill type is as it was', () => {
    for (const form of FORMS) expect(isFormOffered(form, zhPack)).toBe(true)
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
  it('without the model the conversation types are not offered; Japanese has the writing area, so Learn to write / Write it are', () => {
    const offered = DRILL_TYPES.filter(entry => drillTypeOffered(entry, jaPack)).map(entry => entry.id)
    expect(offered).toEqual(['meanings', 'match', 'learn', 'write', 'pinyin', 'translate', 'repeat'])
  })
  it('Korean keeps the writing area off: no Learn to write / Write it', () => {
    const offered = DRILL_TYPES.filter(entry => drillTypeOffered(entry, koPack)).map(entry => entry.id)
    expect(offered).toEqual(['meanings', 'match', 'pinyin', 'translate', 'repeat'])
  })
})
