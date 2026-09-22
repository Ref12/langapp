// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { auditGrammarVocabulary, loadGrammarVocabulary } from './v2-grammar-vocabulary.mjs'
import { lessonSequenceSchema, validateLessonSequence } from './v2-lesson-schema.mjs'

const readYaml = (path: string) => parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const allInventory = loadGrammarVocabulary()
const firstBand = allInventory.bands[0]
const grammarAudit = auditGrammarVocabulary(allInventory)
const inventory = {
  vocabulary: firstBand.vocabulary,
  grammar: firstBand.grammar,
  grammarVocabulary: grammarAudit.requiredVocabulary,
}
const fresh = () => lessonSequenceSchema.parse(readYaml('../curriculum/v2/chinese/lessons/hsk-1.yaml'))
const validate = (sequence = fresh()) => validateLessonSequence(sequence, inventory)

describe('v2 lexical-unit lesson sequence', () => {
  it('starts HSK 1 with three ordered groups of about five units', () => {
    const sequence = validate()
    expect(sequence.lessons.map(lesson => lesson.units.length)).toEqual([5, 6, 5])
    expect(sequence.lessons.flatMap(lesson => lesson.units)).toHaveLength(16)
    expect(sequence.lessons[0].units.map(unit => unit.ref)).toEqual([
      'ni3-hao3--hello', 'wo3--me', 'shi4--identity',
      'xue2-sheng5--student', 's-shi4-n--identity',
    ])
  })

  it('uses every introduced unit in one or more examples', () => {
    const sequence = validate()
    for (const lesson of sequence.lessons) {
      const usedWords = new Set(lesson.examples.flatMap(example =>
        example.segments.flatMap(segment => 'word' in segment ? [segment.word] : [])))
      const usedGrammar = new Set(lesson.examples.flatMap(example => example.grammar))
      for (const unit of lesson.units) {
        expect((unit.kind === 'vocabulary' ? usedWords : usedGrammar).has(unit.ref)).toBe(true)
      }
    }
  })

  it('uses known units in examples and permits current-lesson units', () => {
    const sequence = fresh()
    sequence.lessons[0].examples[1].segments[0] = { word: 'zai4-jian4--goodbye' }
    expect(() => validate(sequence)).toThrow(/before introduction/)
    const other = fresh()
    other.lessons[0].examples[1].grammar = ['stmt-ma5--yes-no']
    expect(() => validate(other)).toThrow(/grammar before introduction/)
  })

  it('requires each grammar unit lexical prerequisites before or in its lesson', () => {
    const sequence = fresh()
    sequence.lessons[0].units = sequence.lessons[0].units.filter(unit => unit.ref !== 'shi4--identity')
    sequence.lessons[0].units.push({ kind: 'vocabulary', ref: 'ni3--you', note: 'A replacement test unit.' })
    expect(() => validate(sequence)).toThrow(/requires vocabulary.*shi4--identity/)
  })

  it('rejects introduced units without examples and examples that teach nothing new', () => {
    const sequence = fresh()
    sequence.lessons[0].examples = sequence.lessons[0].examples.filter(example => example.id !== 'hello')
    expect(() => validate(sequence)).toThrow(/has no example: ni3-hao3--hello/)
    const other = fresh()
    other.lessons[1].examples.push({
      id: 'old-only',
      segments: [{ word: 'ni3-hao3--hello' }],
      translation: 'Hello.',
      grammar: [],
    })
    expect(() => validate(other)).toThrow(/does not demonstrate a new lexical unit/)
  })

  it('rejects too-small, too-large, repeated, unknown, and reintroduced groups', () => {
    for (const change of ['small', 'large', 'duplicate', 'unknown', 'reintroduced'] as const) {
      const sequence = fresh()
      if (change === 'small') sequence.lessons[0].units = sequence.lessons[0].units.slice(0, 3)
      if (change === 'large') sequence.lessons[0].units.push(
        { kind: 'vocabulary', ref: 'ni3--you', note: 'Test.' },
        { kind: 'vocabulary', ref: 'lao3-shi1--teacher', note: 'Test.' })
      if (change === 'duplicate') sequence.lessons[0].units[1] = sequence.lessons[0].units[0]
      if (change === 'unknown') sequence.lessons[0].units[0].ref = 'unknown--unit'
      if (change === 'reintroduced') sequence.lessons[1].units[0].ref = 'wo3--me'
      expect(() => validate(sequence)).toThrow()
    }
  })

  it('keeps vocabulary and grammar references as inventory labels rather than canonical IDs', () => {
    const sequence = fresh()
    expect(JSON.stringify(sequence)).not.toContain('zh-hsk')
    sequence.lessons[0].units[0].ref = 'zh-hsk2026-00147-s001'
    expect(() => validate(sequence)).toThrow()
  })

  it('validates the pinyin orientation without counting it as lexical knowledge', () => {
    const sequence = validate()
    expect(sequence.pronunciation.tones.examples.map(example => example.pinyin))
      .toEqual(['mā', 'má', 'mǎ', 'mà', 'ma'])
    expect(sequence.lessons.flatMap(lesson => lesson.units).some(unit => unit.ref === 'ma1-ma5--mom')).toBe(false)
    const invalid = fresh()
    invalid.pronunciation.tones.examples[1].pinyin = 'mǎ'
    expect(() => validate(invalid)).toThrow(/same syllable/)
  })

  it('rejects arbitrary behavior and target-language prose outside structured examples', () => {
    const sequence = fresh()
    expect(() => lessonSequenceSchema.parse({ ...sequence, script: 'run()' })).toThrow()
    sequence.introduction = 'Say 未教.'
    expect(() => lessonSequenceSchema.parse(sequence)).toThrow()
  })
})
