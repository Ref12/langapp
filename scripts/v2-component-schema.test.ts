// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  componentBindingSchema,
  componentSenseSchema,
  validateVocabularyComponents,
} from './v2-component-schema.mjs'
import { lessonComponentIntroductions } from './v2-lesson-schema.mjs'

const brain = {
  id: 'test-brain', ch: '脑', pr: 'nǎo', ds: 'brain', lb: 'nao3--brain', usage: 'free',
}
const electricity = {
  id: 'test-electricity', ch: '电', pr: 'diàn', ds: 'electricity', lb: 'dian4--electricity',
}
const computer = {
  id: 'test-computer', ch: '电脑', pr: 'diàn nǎo', ds: 'computer', lb: 'dian4-nao3--computer',
}
const thing = {
  id: 'test-thing', ch: '东西', pr: 'dōng xi', ds: 'thing', lb: 'dong1-xi5--thing',
}
const sofa = {
  id: 'test-sofa', ch: '沙发', pr: 'shā fā', ds: 'sofa', lb: 'sha1-fa1--sofa',
}
const computerBinding = () => componentBindingSchema.parse({
  vocabulary: computer.lb,
  formation: 'lexicalized',
  note: 'An electric-brain metaphor; learn the conventional word for computer.',
  components: [
    { kind: 'vocabulary', ref: electricity.lb },
    { kind: 'morpheme', ref: brain.lb, note: 'The brain is metaphorical here.' },
  ],
})
const opaqueBinding = () => componentBindingSchema.parse({
  vocabulary: thing.lb,
  formation: 'opaque',
  note: 'East and west do not explain the modern meaning thing.',
  components: [{ kind: 'opaque', ch: '东', pr: 'dōng' }, { kind: 'opaque', ch: '西', pr: 'xi' }],
})
const phoneticBinding = () => componentBindingSchema.parse({
  vocabulary: sofa.lb,
  formation: 'phonetic',
  note: 'A sound-based borrowing of sofa, not a sum of character meanings.',
  components: [{ kind: 'phonetic', ch: '沙', pr: 'shā' }, { kind: 'phonetic', ch: '发', pr: 'fā' }],
})
const inventory = {
  vocabulary: [computer, thing, sofa],
  componentVocabulary: [electricity],
  morphemes: [brain],
}

describe('v2 reusable component meanings and word formations', () => {
  it('separates the reusable sense from contextual and whole-word notes', () => {
    const result = validateVocabularyComponents([computerBinding()], inventory)
    const positions = result.resolved.get(computer.lb)!
    expect(positions[1].sense.ds).toBe('brain')
    expect(positions[1].sense.usage).toBe('free')
    expect(result.byVocabulary.get(computer.lb)?.note).toContain('electric-brain')
    expect(positions[1].component.note).toBe('The brain is metaphorical here.')
  })

  it.each(['free', 'bound', 'grammatical'])('accepts the explicit %s usage class', usage => {
    expect(componentSenseSchema.parse({ ...brain, usage }).usage).toBe(usage)
  })

  it('requires a usage class and keeps compound examples out of sense descriptions', () => {
    expect(() => componentSenseSchema.parse({ ...brain, usage: undefined })).toThrow()
    expect(() => componentSenseSchema.parse({ ...brain, usage: 'opaque' })).toThrow()
    expect(() => componentSenseSchema.parse({ ...brain, ds: 'brain element in 电脑' })).toThrow()
    expect(() => componentSenseSchema.parse({ ...brain, note: 'word-specific note' })).toThrow()
  })

  it('represents opaque and phonetic positions without fabricated senses', () => {
    const result = validateVocabularyComponents([opaqueBinding(), phoneticBinding()], inventory)
    expect(result.resolved.get(thing.lb)?.map(position => position.sense)).toEqual([null, null])
    expect(result.resolved.get(sofa.lb)?.map(position => position.sense)).toEqual([null, null])
    expect(() => componentBindingSchema.parse({
      ...opaqueBinding(),
      components: [{ kind: 'opaque', ch: '东', pr: 'dōng', ref: 'dong1--east' },
        { kind: 'opaque', ch: '西', pr: 'xi' }],
    })).toThrow()
  })

  it.each(['lexicalized', 'opaque', 'phonetic'])('requires an explanation for %s formations', formation => {
    expect(() => componentBindingSchema.parse({
      ...computerBinding(), formation, note: undefined,
    })).toThrow(/needs a word-level explanation/)
  })

  it('rejects mismatched formation and component roles', () => {
    expect(() => componentBindingSchema.parse({
      ...opaqueBinding(), formation: 'transparent',
    })).toThrow(/cannot assign nonsemantic/)
    expect(() => componentBindingSchema.parse({
      ...phoneticBinding(), formation: 'lexicalized',
    })).toThrow(/cannot assign nonsemantic/)
    expect(() => componentBindingSchema.parse({
      ...computerBinding(), formation: 'opaque',
    })).toThrow(/needs matching nonsemantic/)
    expect(() => componentBindingSchema.parse({
      ...opaqueBinding(), formation: 'phonetic',
    })).toThrow(/needs matching nonsemantic/)
  })

  it('requires every position to align even when it carries no independent meaning', () => {
    const wrongCharacter = opaqueBinding()
    wrongCharacter.components[1] = { kind: 'opaque', ch: '东', pr: 'xi' }
    expect(() => validateVocabularyComponents([wrongCharacter], inventory)).toThrow(/do not align/)
    const wrongReading = phoneticBinding()
    wrongReading.components[1] = { kind: 'phonetic', ch: '发', pr: 'fà' }
    expect(() => validateVocabularyComponents([wrongReading], inventory)).toThrow(/do not align/)
    const extraSyllable = opaqueBinding()
    extraSyllable.components[1] = { kind: 'opaque', ch: '西', pr: 'xi xi' }
    expect(() => validateVocabularyComponents([extraSyllable], inventory)).toThrow(/one pinyin syllable/)
  })

  it('rejects unknown senses, invalid kinds, duplicate bindings and missing coverage', () => {
    const missingSense = computerBinding()
    missingSense.components[1] = { kind: 'morpheme', ref: 'nao3--unknown' }
    expect(() => validateVocabularyComponents([missingSense], inventory)).toThrow(/unknown morpheme/)
    expect(() => componentBindingSchema.parse({
      ...computerBinding(), components: [{ kind: 'anything', ref: brain.lb }],
    })).toThrow()
    expect(() => validateVocabularyComponents([opaqueBinding(), opaqueBinding()], inventory))
      .toThrow(/Duplicate vocabulary component binding/)
    expect(() => validateVocabularyComponents([computerBinding()], inventory, { requireComplete: true }))
      .toThrow(/Missing vocabulary component bindings/)
    expect(validateVocabularyComponents(
      [computerBinding(), opaqueBinding(), phoneticBinding()], inventory, { requireComplete: true },
    ).positionCount).toBe(6)
  })

  it('rejects duplicate sense identities and mismatched citation labels', () => {
    expect(() => validateVocabularyComponents([], { ...inventory, morphemes: [brain, brain] }))
      .toThrow(/Duplicate morpheme/)
    expect(() => validateVocabularyComponents([], {
      ...inventory, componentVocabulary: [electricity, brain],
    })).toThrow(/duplicates vocabulary identity/)
    expect(() => validateVocabularyComponents([], {
      ...inventory, morphemes: [{ ...brain, lb: 'nao4--brain' }],
    })).toThrow(/label and citation reading/)
  })

  it('keeps contextual neutral tones on occurrences without changing citation identity', () => {
    const father = { id: 'test-father', ch: '爸', pr: 'bà', ds: 'father', lb: 'ba4--father' }
    const dad = { id: 'test-dad', ch: '爸爸', pr: 'bà ba', ds: 'dad', lb: 'ba4-ba5--dad' }
    const localInventory = { vocabulary: [dad], componentVocabulary: [father], morphemes: [] }
    const binding = componentBindingSchema.parse({
      vocabulary: dad.lb, formation: 'transparent',
      components: [
        { kind: 'vocabulary', ref: father.lb },
        { kind: 'vocabulary', ref: father.lb, surface_pr: 'ba' },
      ],
    })
    const result = validateVocabularyComponents([binding], localInventory)
    expect(result.resolved.get(dad.lb)?.map(position => position.sense.pr)).toEqual(['bà', 'bà'])
    expect(result.resolved.get(dad.lb)?.map(position => position.pr)).toEqual(['bà', 'ba'])
    const redundant = { ...binding, components: [
      { kind: 'vocabulary', ref: father.lb, surface_pr: 'Bà' }, binding.components[1],
    ] }
    expect(() => validateVocabularyComponents([redundant], localInventory)).toThrow(/unnecessary surface/)
    const wrongReading = { ...binding, components: [
      { kind: 'vocabulary', ref: father.lb, surface_pr: 'pà' }, binding.components[1],
    ] }
    expect(() => validateVocabularyComponents([wrongReading], localInventory)).toThrow(/changes lexical reading/)
  })

  it('introduces reusable identities only and preserves every word context separately', () => {
    const bindings = [computerBinding(), opaqueBinding(), phoneticBinding()]
    const sequence = { lessons: [
      { id: 'first', units: [{ kind: 'vocabulary', ref: computer.lb }, { kind: 'vocabulary', ref: thing.lb }] },
      { id: 'second', units: [{ kind: 'vocabulary', ref: sofa.lb }] },
    ] }
    const vocabulary = new Map(inventory.vocabulary.map(record => [record.lb, record]))
    const introductions = lessonComponentIntroductions(sequence, vocabulary, bindings)
    expect(introductions[0].components).toEqual([
      { kind: 'vocabulary', ref: electricity.lb }, { kind: 'morpheme', ref: brain.lb },
    ])
    expect(introductions[0].words).toEqual(bindings.slice(0, 2))
    expect(introductions[1].components).toEqual([])
    expect(introductions[1].words).toEqual([bindings[2]])
  })

  it('preserves later context for already previewed senses', () => {
    const humanBrain = { ...computer, id: 'test-human-brain', ch: '人脑', pr: 'rén nǎo', lb: 'ren2-nao3--brain' }
    const laterBinding = componentBindingSchema.parse({
      vocabulary: humanBrain.lb, formation: 'transparent',
      components: [
        { kind: 'vocabulary', ref: 'ren2--person' },
        { kind: 'morpheme', ref: brain.lb, note: 'The literal anatomical meaning.' },
      ],
    })
    const sequence = { lessons: [
      { id: 'first', units: [{ kind: 'vocabulary', ref: computer.lb }] },
      { id: 'second', units: [{ kind: 'vocabulary', ref: humanBrain.lb }] },
    ] }
    const vocabulary = new Map([computer, humanBrain].map(record => [record.lb, record]))
    const introductions = lessonComponentIntroductions(sequence, vocabulary, [computerBinding(), laterBinding])
    expect(introductions[1].components).toEqual([{ kind: 'vocabulary', ref: 'ren2--person' }])
    expect(introductions[1].words[0].components[1].note).toBe('The literal anatomical meaning.')
  })

  it('does not leak an occurrence pronunciation into the reusable introduction', () => {
    const thanks = { id: 'test-thanks', ch: '谢谢', pr: 'xiè xie', ds: 'thanks', lb: 'xie4-xie5--thanks' }
    const binding = componentBindingSchema.parse({
      vocabulary: thanks.lb, formation: 'transparent',
      components: [
        { kind: 'morpheme', ref: 'xie4--thank' },
        { kind: 'morpheme', ref: 'xie4--thank', surface_pr: 'xie' },
      ],
    })
    const sequence = { lessons: [{ id: 'thanks', units: [{ kind: 'vocabulary', ref: thanks.lb }] }] }
    const introductions = lessonComponentIntroductions(sequence, new Map([[thanks.lb, thanks]]), [binding])
    expect(introductions[0].components).toEqual([{ kind: 'morpheme', ref: 'xie4--thank' }])
    expect(introductions[0].words[0].components[1]).toEqual({
      kind: 'morpheme', ref: 'xie4--thank', surface_pr: 'xie',
    })
  })
})
