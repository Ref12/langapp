// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildLessonSequences, preflightBandLessons } from './v2-generate-lessons.mjs'
import { validateLessonCurriculum } from './v2-lesson-schema.mjs'
import { grammarExampleId } from './v2-example-schema.mjs'
import { curriculumFixture, fixtureExample, fixtureGrammar, fixtureWord } from './v2-curriculum-fixtures.mjs'

function wordGroups(sizes: number[]) {
  const input = curriculumFixture()
  input.bands[0].grammar = []
  input.bands[0].vocabulary = []
  input.bands[0].examples = []
  sizes.forEach((size, index) => {
    const words = Array.from({ length: size }, (_, item) => fixtureWord(`group-${index}-word-${item}`))
    input.bands[0].vocabulary.push(...words)
    input.bands[0].examples.push(fixtureExample(`group-${index}`, words.map(word => word.lb)))
  })
  return input
}

describe('v3 dependency-aware lesson generation', () => {
  it('bootstraps usable examples with five units rather than a giant orientation lesson', () => {
    const input = curriculumFixture()
    const sequences = buildLessonSequences(input)
    expect(sequences[0].lessons).toHaveLength(1)
    expect(sequences[0].lessons[0].units).toHaveLength(5)
    expect(sequences[0].lessons[0].examples.map(example => example.id)).toContain(grammarExampleId(input.bands[0].grammar[0]))
    expect(validateLessonCurriculum(sequences, input)).toEqual(sequences)
    expect(buildLessonSequences(input)).toEqual(sequences)
  })

  it('groups small mutual construction dependencies while treating self-citation as evidence', () => {
    const input = curriculumFixture()
    const first = input.bands[0]
    const original = first.grammar[0]
    const mutual = fixtureGrammar('mutual', [first.vocabulary[0].lb, first.vocabulary[2].lb], [original.lb])
    original.ex.grammar.push(mutual.lb)
    first.grammar.push(mutual)
    const sequence = buildLessonSequences(input)[0]
    expect(sequence.lessons.map(lesson => lesson.units.length)).toEqual([6])
    expect(sequence.lessons[0].examples.map(example => example.id)).toEqual(expect.arrayContaining([
      grammarExampleId(original), grammarExampleId(mutual),
    ]))
  })

  it('keeps cumulative knowledge across all seven bands with no duplicate introductions', () => {
    const input = curriculumFixture()
    for (const band of input.bands.slice(1)) {
      band.vocabulary = ['a', 'b', 'c', 'd'].map(name => fixtureWord(`band-${band.band}-${name}`))
      band.examples = band.vocabulary.map(word =>
        fixtureExample(word.id, ['wo3--me', 'shi4--identity', word.lb], [input.bands[0].grammar[0].lb]))
    }
    const sequences = buildLessonSequences(input)
    expect(sequences.map(sequence => sequence.alignment)).toEqual(input.bands.map(band => `hsk-${band.band}`))
    expect(sequences.map(sequence => sequence.lessons[0].units.length)).toEqual([5, 4, 4, 4, 4, 4, 4])
    expect(sequences.flatMap(sequence => sequence.lessons).flatMap(lesson => lesson.units)).toHaveLength(29)
  })

  it.each([[4, 4], [6, 6], [4, 6, 4]])('packs mutually dependent clusters and rebalances the tail: %j', (...sizes) => {
    const input = wordGroups(sizes)
    const lessons = buildLessonSequences(input)[0].lessons
    expect(lessons.map(lesson => lesson.units.length).sort()).toEqual([...sizes].sort())
    expect(lessons.flatMap(lesson => lesson.units)).toHaveLength(sizes.reduce((sum, size) => sum + size, 0))
  })

  it('rebalances a one-unit final remainder into five and six instead of emitting a tiny final lesson', () => {
    const input = wordGroups([2])
    for (let index = 2; index < 11; index++) {
      const word = fixtureWord(`independent-${index}`)
      input.bands[0].vocabulary.push(word)
      input.bands[0].examples.push(fixtureExample(word.id, [input.bands[0].vocabulary[0].lb, word.lb]))
    }
    expect(buildLessonSequences(input)[0].lessons.map(lesson => lesson.units.length)).toEqual([5, 6])
  })

  it('uses legacy stable IDs as teaching hints, never canonical label sorting', () => {
    const input = curriculumFixture()
    const first = input.bands[0]
    const teachingOrder = new Map([[first.vocabulary[3].id, 0], [first.vocabulary[2].id, 1]])
    expect(buildLessonSequences(input, { teachingOrder })[0].lessons[0].units.slice(0, 2).map(unit => unit.ref))
      .toEqual([first.vocabulary[3].lb, first.vocabulary[2].lb])
    const a = buildLessonSequences(input)
    first.vocabulary.reverse()
    first.grammar.reverse()
    expect(buildLessonSequences(input)).toEqual(a)
  })

  it('introduces every fixed-pattern alternative, including a pinned sense absent from the example', () => {
    const base = curriculumFixture()
    const emphasis = fixtureWord('emphasis', '是', 'shì', 'shi4')
    const input = { ...base, requirements: [{ grammar: base.bands[0].grammar[0].lb, vocabulary: [emphasis.lb] }] }
    input.bands[0].vocabulary.push(emphasis)
    input.bands[0].examples.push(fixtureExample('emphatic', ['wo3--me', emphasis.lb, 'ren2--person']))
    const lesson = buildLessonSequences(input)[0].lessons[0]
    expect(lesson.units).toHaveLength(6)
    expect(lesson.units).toContainEqual({ kind: 'vocabulary', ref: emphasis.lb })
  })

  it('fails actionably for oversized mutual dependencies without relaxing coverage or group size', () => {
    expect(() => buildLessonSequences(wordGroups([8])))
      .toThrow(/unresolved dependencies\/lesson packing.*8 units[\s\S]*group-0 needs/)
    expect(() => buildLessonSequences(wordGroups([7])))
      .toThrow(/7 units cannot be partitioned/)
  })

  it('fails explicitly if deterministic dependency search exceeds its budget', () => {
    expect(() => buildLessonSequences(curriculumFixture(), { searchLimit: 1 }))
      .toThrow(/dependency search exceeded 1 states/)
  })

  it('never creates an example for an uncovered sense or silently accepts missing canonical ex', () => {
    const input = curriculumFixture()
    input.bands[0].examples = []
    expect(() => buildLessonSequences(input)).toThrow(/no authored example: ni3--you/)
  })

  it('preflights one complete authored band without pretending unfinished sibling bands are complete', () => {
    const input = curriculumFixture()
    const { ex, ...unfinished } = fixtureGrammar('later', ['wo3--me'])
    expect(ex.grammar).toHaveLength(1)
    const scoped = { ...input, bands: [
      input.bands[0], { ...input.bands[1], grammar: [unfinished] }, ...input.bands.slice(2),
    ] }
    const result = preflightBandLessons(scoped, '1')
    expect(result.sequence.lessons[0].units).toHaveLength(5)
    expect(result.assumption).toContain('not full-curriculum validation')
    expect(() => buildLessonSequences(scoped)).toThrow(/Missing authored grammar ex/)
    expect(() => preflightBandLessons(scoped, '2')).toThrow(/Missing authored grammar ex/)
  })
})
