// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { lessonSequenceSchema, validateLessonCurriculum, validateLessonSequence } from './v2-lesson-schema.mjs'
import { curriculumFixture, fixtureExample, fixtureWord, lessonFixture } from './v2-curriculum-fixtures.mjs'
import { usageExampleId } from './v2-example-schema.mjs'

function withSecondBand() {
  const input = curriculumFixture()
  const first = input.bands[0]
  const second = input.bands[1]
  second.vocabulary = ['a', 'b', 'c', 'd'].map(name => fixtureWord(`second-${name}`))
  second.examples = second.vocabulary.map(word => fixtureExample(word.id,
    [first.vocabulary[0].lb, first.vocabulary[1].lb, word.lb], [first.grammar[0].lb]))
  return input
}

describe('v3 examples-first lexical-unit lessons', () => {
  it('accepts only ordered units and structured examples, with complete band coverage', () => {
    const input = curriculumFixture()
    const sequences = validateLessonCurriculum(lessonFixture(input), input)
    expect(sequences).toHaveLength(7)
    expect(sequences[0].lessons[0].units).toHaveLength(5)
    expect(Object.keys(sequences[0])).toEqual(['schemaVersion', 'language', 'alignment', 'status', 'lessons'])
    expect(Object.keys(sequences[0].lessons[0])).toEqual(['id', 'units', 'examples'])
    expect(Object.keys(sequences[0].lessons[0].units[0])).toEqual(['kind', 'ref'])
    expect(Object.keys(sequences[0].lessons[0].examples[0])).toEqual(['id', 'segments', 'translation', 'grammar'])
  })

  it('carries actual taught knowledge across bands, not an arbitrary pre-known vocabulary list', () => {
    const input = withSecondBand()
    const sequences = lessonFixture(input)
    expect(validateLessonCurriculum(sequences, input)[1].lessons).toHaveLength(1)
    expect(validateLessonSequence(sequences[1], input, [sequences[0]])).toEqual(sequences[1])
    expect(() => validateLessonSequence(sequences[1], input)).toThrow(/cumulative order/)
    expect(() => validateLessonCurriculum(sequences.slice(0, 1), input)).toThrow(/all seven/)
    expect(() => validateLessonCurriculum([...sequences].reverse(), input)).toThrow(/cumulative order/)
  })

  it.each(['title', 'objectives', 'introduction', 'pronunciation', 'coverage', 'source'])(
    'rejects legacy root prose/metadata: %s', field => {
      const first = lessonFixture()[0]
      expect(() => lessonSequenceSchema.parse({ ...first, [field]: 'Legacy prose.' })).toThrow()
    })

  it('rejects titles/objectives/unit notes and v2 rather than silently stripping them', () => {
    const first = lessonFixture()[0]
    expect(() => lessonSequenceSchema.parse({ ...first, schemaVersion: 2 })).toThrow()
    for (const extra of [{ title: 'Title' }, { objectives: ['Goal'] }]) {
      expect(() => lessonSequenceSchema.parse({
        ...first, lessons: [{ ...first.lessons[0], ...extra }],
      })).toThrow()
    }
    expect(() => lessonSequenceSchema.parse({
      ...first, lessons: [{ ...first.lessons[0], units: first.lessons[0].units.map(unit => ({ ...unit, note: 'Prose.' })) }],
    })).toThrow()
  })

  it('rejects unknown, duplicate, wrong-band and reintroduced units', () => {
    const input = withSecondBand()
    let sequences = lessonFixture(input)
    sequences[0].lessons[0].units[0].ref = 'unknown--sense'
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/unknown vocabulary/)
    sequences = lessonFixture(input)
    sequences[0].lessons[0].units[0] = sequences[0].lessons[0].units[1]
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/Duplicate lexical unit/)
    sequences = lessonFixture(input)
    sequences[1].lessons[0].units[0].ref = input.bands[0].vocabulary[0].lb
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/canonical band/)
    sequences = lessonFixture(input)
    sequences[0].lessons.push({ ...sequences[0].lessons[0], id: 'another-lesson' })
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/already introduced/)
  })

  it('requires every canonical unit exactly once, not a partial introductory sequence', () => {
    const input = curriculumFixture()
    const sequences = lessonFixture(input)
    sequences[0].lessons = []
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/missing 4 vocabulary units/)
  })

  it('rejects under-sized and giant bootstrap lessons', () => {
    const first = lessonFixture()[0]
    for (const size of [3, 7]) {
      expect(() => lessonSequenceSchema.parse({
        ...first, lessons: [{
          ...first.lessons[0],
          units: Array.from({ length: size }, (_, i) => ({ kind: 'vocabulary', ref: `ren2--word-${i}` })),
        }],
      })).toThrow()
    }
  })

  it('requires actual authored examples, not generated definitions or altered references', () => {
    const input = curriculumFixture()
    const sequences = lessonFixture(input)
    sequences[0].lessons[0].examples[0] = {
      ...sequences[0].lessons[0].examples[0], translation: 'A fabricated replacement.',
    }
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/must match an authored candidate/)
  })

  it('requires the canonical grammar example at introduction, even if another example cites the grammar', () => {
    const input = curriculumFixture()
    const sequences = lessonFixture(input)
    sequences[0].lessons[0].examples.shift()
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/needs its authored example/)
  })

  it('requires each new exact sense to be evidenced, not just present in the source pool', () => {
    const input = curriculumFixture()
    const sequences = lessonFixture(input)
    sequences[0].lessons[0].examples.pop()
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/introduced vocabulary:ni3--you has no example/)
  })

  it('requires every fixed-form alternative even when the example uses just one alternative', () => {
    const input = curriculumFixture()
    const first = input.bands[0]
    const alternative = fixtureWord('alternative', '为', 'wéi', 'wei2')
    first.vocabulary.push(alternative)
    first.grammar[0].pt = '<subject> + (是 / 为) + <noun>'
    first.grammar[0].pr = '<subject> + (shì / wéi) + <noun>'
    first.examples.push(fixtureExample('alternative-example', [first.vocabulary[0].lb, alternative.lb]))
    const sequences = lessonFixture(input)
    sequences[0].lessons[0].units = sequences[0].lessons[0].units.filter(unit => unit.ref !== alternative.lb)
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/requires vocabulary.*wei2--alternative/)
  })

  it('honors the manually pinned sense rather than a same-spelling automatic match', () => {
    const base = curriculumFixture()
    const input = { ...base, requirements: [{ grammar: base.bands[0].grammar[0].lb, vocabulary: ['shi4--emphasis'] }] }
    input.bands[0].vocabulary.push(fixtureWord('emphasis', '是', 'shì', 'shi4'))
    input.bands[0].examples.push(fixtureExample('emphasis-example', ['wo3--me', 'shi4--emphasis', 'ren2--person']))
    const sequences = lessonFixture(input)
    sequences[0].lessons[0].units = sequences[0].lessons[0].units.filter(unit => unit.ref !== 'shi4--emphasis')
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/requires vocabulary.*shi4--emphasis/)
  })

  it('rejects future vocabulary even within a band and duplicate example identities across lessons', () => {
    const input = withSecondBand()
    const second = input.bands[1]
    const extra = ['e', 'f', 'g', 'h'].map(name => fixtureWord(`second-${name}`))
    second.vocabulary.push(...extra)
    second.examples.push(...extra.map(word => fixtureExample(word.id, ['wo3--me', word.lb])))
    const sequences = lessonFixture(input)
    const lesson = sequences[1].lessons[0]
    sequences[1].lessons = [
      { ...lesson, units: lesson.units.slice(0, 4), examples: lesson.examples.slice(0, 4) },
      { ...lesson, id: 'second-later', units: lesson.units.slice(4), examples: lesson.examples.slice(4) },
    ]
    expect(() => validateLessonCurriculum(sequences, input)).not.toThrow()
    sequences[1].lessons[0].examples.push({ ...second.examples[4], id: usageExampleId('2', second.examples[4]) })
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/before introduction/)
    sequences[1].lessons[0].examples.pop()
    sequences[1].lessons[1].examples.push({ ...second.examples[0], id: usageExampleId('2', second.examples[0]) })
    expect(() => validateLessonCurriculum(sequences, input)).toThrow(/Duplicate lesson example/)
  })

  it('keeps HSK1 components complete and never demands nonexistent higher-band bindings', () => {
    const input = withSecondBand()
    input.bands[1].vocabulary[0].ch = '人人'
    input.bands[1].vocabulary[0].pr = 'rén rén'
    input.bands[1].vocabulary[0].lb = 'ren2-ren2--second-a'
    input.bands[1].examples[0].segments[2] = { word: 'ren2-ren2--second-a' }
    expect(() => validateLessonCurriculum(lessonFixture(input), input)).not.toThrow()
    input.bands[0].vocabulary[2].ch = '人人'
    input.bands[0].vocabulary[2].pr = 'rén rén'
    input.bands[0].vocabulary[2].lb = 'ren2-ren2--person'
    for (const example of [input.bands[0].grammar[0].ex, ...input.bands[0].examples]) {
      for (const segment of example.segments) {
        if ('word' in segment && segment.word === 'ren2--person') segment.word = 'ren2-ren2--person'
      }
    }
    expect(() => validateLessonCurriculum(lessonFixture(input), input)).toThrow(/Missing vocabulary component bindings/)
  })
})
