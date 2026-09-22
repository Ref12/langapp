// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  exampleBodySchema, exampleSchema, grammarExampleId, grammarSchema,
  validateBandExamples, validateCurriculumExamples,
} from './v2-example-schema.mjs'
import { curriculumFixture, fixtureExample, fixtureGrammar, fixtureWord } from './v2-curriculum-fixtures.mjs'

describe('v2 authored example contract', () => {
  it('synthesizes stable grammar example IDs and covers exact vocabulary senses', () => {
    const input = curriculumFixture()
    const result = validateCurriculumExamples(input.bands)
    expect(result.candidates[0][0].id).toBe(grammarExampleId(input.bands[0].grammar[0]))
    expect(result.candidates[0]).toHaveLength(2)
    expect(result.vocabulary.size).toBe(4)
  })

  it('requires ex on every canonical grammar record, without a five-field bypass', () => {
    const input = curriculumFixture()
    const { ex, ...legacy } = input.bands[0].grammar[0]
    expect(ex.grammar).toHaveLength(1)
    expect(() => grammarSchema.parse(legacy)).toThrow()
    expect(() => validateCurriculumExamples([
      { ...input.bands[0], grammar: [legacy] }, ...input.bands.slice(1),
    ])).toThrow(/Missing authored grammar ex: 1.*records/s)
  })

  it('requires the target construction and rejects IDs and explanatory fields inside ex', () => {
    const record = curriculumFixture().bands[0].grammar[0]
    expect(() => grammarSchema.parse({ ...record, ex: { ...record.ex, grammar: [] } })).toThrow(/cite itself/)
    expect(() => grammarSchema.parse({ ...record, ex: { ...record.ex, id: 'no-id' } })).toThrow()
    expect(() => exampleBodySchema.parse({ ...record.ex, note: 'An explanation.' })).toThrow()
  })

  it.each([
    { literal: '你好' }, { word: 'wo3--me', literal: '我' }, { placeholder: 'name' },
    { external: 'new-word' }, { punctuation: 'hello' }, { punctuation: '?' },
  ])('rejects unstructured escapes and unsupported punctuation: %j', segment => {
    const example = fixtureExample('test', ['wo3--me'])
    expect(() => exampleSchema.parse({ ...example, segments: [...example.segments, segment] })).toThrow()
  })

  it('supports Chinese quotations, dialogue, dashes, ellipses and multiple sentences', () => {
    const example = fixtureExample('dialogue', ['wo3--me'])
    expect(exampleSchema.parse({
      ...example, segments: [...example.segments, { punctuation: '：“”‘’（）《》〈〉「」『』——……，；？！、·' }],
    })).toBeDefined()
  })

  it('rejects empty/punctuation-only examples, duplicate annotations and placeholders in translations', () => {
    const record = curriculumFixture().bands[0].grammar[0]
    expect(() => exampleBodySchema.parse({ ...record.ex, segments: [{ punctuation: '。' }] })).toThrow()
    expect(() => exampleBodySchema.parse({ ...record.ex, grammar: [record.lb, record.lb] })).toThrow(/Duplicate/)
    expect(() => exampleBodySchema.parse({ ...record.ex, translation: '<subject> is a person.' })).toThrow()
    expect(() => exampleBodySchema.parse({ ...record.ex, translation: '   ' })).toThrow()
  })

  it('rejects unknown or later-band words and supporting constructions', () => {
    const input = curriculumFixture()
    const laterWord = fixtureWord('later')
    const laterGrammar = fixtureGrammar('later', [laterWord.lb])
    input.bands[1].vocabulary.push(laterWord)
    input.bands[1].grammar.push(laterGrammar)
    input.bands[0].grammar[0].ex.segments.push({ word: laterWord.lb })
    expect(() => validateCurriculumExamples(input.bands)).toThrow(/later-band vocabulary/)
    input.bands[0].grammar[0].ex.segments.pop()
    input.bands[0].grammar[0].ex.grammar.push(laterGrammar.lb)
    expect(() => validateCurriculumExamples(input.bands)).toThrow(/later-band grammar/)
    input.bands[0].grammar[0].ex.grammar.pop()
    input.bands[0].grammar[0].ex.segments.push({ word: 'unknown--word' })
    expect(() => validateCurriculumExamples(input.bands)).toThrow(/unknown vocabulary/)
  })

  it('namespaces supplemental IDs by band and keeps canonical grammar identities separate', () => {
    const input = curriculumFixture()
    input.bands[0].examples[0].id = grammarExampleId(input.bands[0].grammar[0])
    input.bands[1].examples.push(input.bands[0].examples[0])
    expect(() => validateCurriculumExamples(input.bands)).not.toThrow()
    input.bands[0].examples.push(input.bands[0].examples[0])
    expect(() => validateCurriculumExamples(input.bands)).toThrow(/Duplicate example ID/)
  })

  it('checks inventory identities and sense labels globally', () => {
    const input = curriculumFixture()
    input.bands[1].vocabulary.push(input.bands[0].vocabulary[0])
    expect(() => validateCurriculumExamples(input.bands)).toThrow(/Duplicate inventory ID/)
    input.bands[1].vocabulary[0] = { ...input.bands[0].vocabulary[0], id: 'unique-word' }
    expect(() => validateCurriculumExamples(input.bands)).toThrow(/Duplicate vocabulary label/)
  })

  it('does not equate spellings or component previews with vocabulary-sense coverage', () => {
    const input = curriculumFixture()
    input.bands[0].vocabulary.push(fixtureWord('different-person'))
    expect(() => validateCurriculumExamples(input.bands)).toThrow(/no authored example: ren2--different-person/)
  })

  it('audits one authored band without claiming absent sibling examples are complete', () => {
    const input = curriculumFixture()
    const { ex, ...later } = fixtureGrammar('later', ['ren2--person'])
    expect(ex.grammar).toHaveLength(1)
    const bands = [input.bands[0], { ...input.bands[1], grammar: [later] }, ...input.bands.slice(2)]
    expect(validateBandExamples(bands, '1').candidates[0]).toHaveLength(2)
    expect(() => validateBandExamples(bands, '2')).toThrow(/Missing authored grammar ex/)
    expect(() => validateCurriculumExamples(bands)).toThrow(/Missing authored grammar ex/)
  })
})
