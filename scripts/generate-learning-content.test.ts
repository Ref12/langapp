// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import generated from '../src/data/learning-content.generated.json'
import curriculum from '../src/data/curriculum.generated.json'
import { labelRegistrySource, learningContentSource, modelUtterances, validateLearningContent } from './generate-learning-content.mjs'
import { numberedPinyin } from './readable-labels.mjs'
import { buildAudioScript, buildLessonAudioScript, resolveUtterance, spokenProse } from '../src/core/learning-content'
import { learningDocumentSchema, lessonRouteId } from '../src/core/learning-content-schema.mjs'

const fresh = () => learningDocumentSchema.parse(structuredClone(generated))
const validate = (doc: ReturnType<typeof fresh>) => {
  const { labels, ...source } = doc
  return validateLearningContent(source, curriculum, labels)
}
const doc = fresh()
const words = new Map(doc.labels.words.map(entry => [entry.label, {
  ...curriculum.words.find(word => word.id === entry.id)!, label: entry.label,
}]))
const grammar = new Map(doc.labels.grammar.map(entry => [entry.label, {
  ...curriculum.grammar.find(item => item.id === entry.id)!, label: entry.label,
}]))
const models = new Map(doc.models.map(model => [model.label, model]))
const wordLabel = (id: string) => doc.labels.words.find(entry => entry.id === id)!.label
const grammarLabel = (id: string) => doc.labels.grammar.find(entry => entry.id === id)!.label

describe('whole-lesson definitions and readable reference registry', () => {
  it('reproduces YAML without opaque references and describes every level-one lesson', async () => {
    const text = await readFile(learningContentSource, 'utf8')
    const source = parse(text)
    const registry = parse(await readFile(labelRegistrySource, 'utf8'))
    expect(validateLearningContent(source, curriculum, registry)).toEqual(generated)
    expect(text).not.toMatch(/zh-hsk|wordId:|grammarIds:|lessonId:/)
    expect(doc.lessons).toHaveLength(13)
    expect(doc.models).toHaveLength(30)
    expect(doc.lessons.map(lesson => lessonRouteId(doc.level, lesson)))
      .toEqual(curriculum.lessons.filter(lesson => lesson.levelId === 'zh-level-01').map(lesson => lesson.id))
    for (const unit of curriculum.phases[0].levels[0].modules) {
      const lessons = new Set(doc.lessons.filter(lesson => lesson.unit === unit.id).map(lesson => lesson.label))
      expect(new Set(doc.models.filter(model => lessons.has(model.lesson)).map(model => model.kind)))
        .toEqual(new Set(['concept', 'phrase', 'conversation', 'exercise']))
    }
  })

  it.each([
    ['nǐ', 'ni3'], ['xué sheng', 'xue2-sheng5'], ['Hàn yǔ', 'han4-yu3'],
    ['nǚ', 'nv3'], ['lǜ', 'lv4'], ['duì bu qǐ', 'dui4-bu5-qi3'],
    ['nà r', 'na4-r5'], ['hòu mian', 'hou4-mian5'], ['gè', 'ge4'],
  ])('uses canonical tones for %s -> %s', (pinyin, expected) => {
    expect(numberedPinyin(pinyin)).toBe(expected)
    expect(numberedPinyin(pinyin.normalize('NFD'))).toBe(expected)
  })

  it('keeps homographic senses distinct and internal IDs unchanged', () => {
    expect(wordLabel('zh-hsk1-00140-s009')).toBe('hao3--greeting')
    expect(wordLabel('zh-hsk1-00140-s003')).toBe('hao3--acceptance')
    expect(wordLabel('zh-hsk1-00423-s001')).toBe('xue2-sheng5--student')
    const expected = curriculum.words.filter(word => word.levelId === 'zh-level-01').map(word => word.id).sort()
    expect(doc.labels.words.map(entry => entry.id).sort()).toEqual(expected)
  })

  it('rejects duplicate aliases, duplicate canonical mappings, unknown IDs and tone drift', () => {
    for (const change of ['duplicate-alias', 'duplicate-id', 'unknown-id', 'tone-drift'] as const) {
      const current = fresh()
      if (change === 'duplicate-alias') current.labels.words[1].label = current.labels.words[0].label
      if (change === 'duplicate-id') current.labels.words[1].id = current.labels.words[0].id
      if (change === 'unknown-id') current.labels.words[0].id = 'zh-hsk1-99999-s001'
      if (change === 'tone-drift') current.labels.words[0].label = current.labels.words[0].label.replace(/[1-5]/, tone => tone === '1' ? '2' : '1')
      expect(() => validate(current)).toThrow(/Duplicate|Unknown canonical|does not match canonical/)
    }
  })

  it('rejects missing/reordered lesson knowledge rather than silently losing vocabulary', () => {
    const current = fresh()
    const vocabulary = current.lessons[0].sections.find(section => section.kind === 'vocabulary' && section.role === 'new')!
    vocabulary.words.pop()
    expect(() => validate(current)).toThrow(/existing lesson inventory/)
    const other = fresh()
    other.lessons.reverse()
    expect(() => validate(other)).toThrow(/curriculum order/)
  })

  it('rejects future and unknown vocabulary in all model cues/examples/answers', () => {
    const current = fresh()
    const firstLesson = current.lessons[0].label
    for (const model of current.models.filter(model => model.lesson === firstLesson)) {
      for (const utterance of modelUtterances(model)) {
        const original = utterance.segments
        for (const word of ['wei4--unknown', wordLabel('zh-hsk1-00140-s003')]) {
          utterance.segments = [{ word }]
          expect(() => validate(current)).toThrow(/vocabulary/)
        }
        utterance.segments = original
      }
    }
  })

  it('applies the same cutoffs to authored grammar examples and review vocabulary', () => {
    const current = fresh()
    const section = current.lessons[0].sections.find(section => section.kind === 'grammar')!
    section.examples = [{ segments: [{ word: wordLabel('zh-hsk1-00140-s003') }], translation: 'All right.' }]
    expect(() => validate(current)).toThrow(/after the lesson cutoff/)
    const other = fresh()
    other.lessons[0].sections.push({
      kind: 'vocabulary', title: 'Invalid review', description: 'Not known yet.', role: 'review',
      words: [wordLabel('zh-hsk1-00384-s001')],
    })
    expect(() => validate(other)).toThrow(/review vocabulary/)
  })

  it('rejects future grammar/concepts and ungrounded free text', () => {
    const current = fresh()
    current.models[0].requires.grammar = [grammarLabel('zh-hsk1-g019')]
    expect(() => validate(current)).toThrow(/grammar/)
    current.models[0].requires.grammar = []
    current.models[0].requires.concepts = [current.models[0].label]
    expect(() => validate(current)).toThrow(/concept/)
    current.models[0].requires.concepts = []
    current.models[0].description = 'Untracked \u8336'
    expect(() => validate(current)).toThrow()
    current.models[0].description = 'Pronounce the label ni3--you.'
    expect(() => validate(current)).toThrow(/structured references/)
    const other = fresh()
    modelUtterances(other.models[0])[0].segments = [{ punctuation: '!' }]
    expect(() => validate(other)).toThrow(/needs vocabulary/)
  })

  it('requires models in their actual introduction lesson and concepts before dependencies', () => {
    const current = fresh()
    const concept = current.models.find(model => model.kind === 'concept')!
    const lesson = current.lessons.find(lesson => lesson.label === concept.lesson)!
    for (const section of lesson.sections) {
      if (section.kind === 'models') section.models = section.models.filter(label => label !== concept.label)
    }
    lesson.sections = lesson.sections.filter(section => section.kind !== 'models' || section.models.length)
    expect(() => validate(current)).toThrow(/concept|missing from its introduction/)
    const other = fresh()
    other.lessons[0].sections.push({
      kind: 'models', title: 'Too soon', description: 'Future material.', models: [other.models[other.models.length - 1].label],
    })
    expect(() => validate(other)).toThrow(/future model/)
  })

  it('uses lesson section order rather than model definition order to teach prerequisites', () => {
    const current = fresh()
    current.models.reverse()
    expect(() => validate(current)).not.toThrow()
  })

  it('rejects unknown speakers rather than silently dropping a conversation role', () => {
    const current = fresh()
    current.models.find(model => model.kind === 'conversation')!.turns[0].speaker = 'missing-speaker'
    expect(() => validate(current)).toThrow(/speaker/)
  })

  it('narrates the entire lesson, including every listed vocabulary sense and grammar example', () => {
    for (const lesson of doc.lessons) {
      const script = buildLessonAudioScript(lesson, models, words, grammar)
      const narration = script.filter(step => step.kind === 'speech')
      expect(narration[0].text).toContain(lesson.title)
      for (const objective of lesson.objectives) expect(narration.some(step => step.text === spokenProse(objective))).toBe(true)
      for (const section of lesson.sections) {
        expect(narration.some(step => step.text.includes(spokenProse(section.description)))).toBe(true)
        if (section.kind === 'vocabulary') {
          for (const label of section.words) {
            const word = words.get(label)!
            expect(narration.some(step => step.text === word.ch && step.locale === 'zh-Hans')).toBe(true)
            expect(narration.some(step => step.text === word.ds && step.locale === 'en-US')).toBe(true)
          }
        }
        if (section.kind === 'grammar') {
          for (const utterance of section.examples) expect(narration.some(step => step.text === resolveUtterance(utterance, words).text)).toBe(true)
        }
      }
      expect(narration.every(step => step.text.length > 0 && step.text.length <= 8000)).toBe(true)
      expect(narration.every(step => !/zh-hsk|[a-z]+[1-5]--[a-z]/.test(step.text))).toBe(true)
      expect(narration[narration.length - 1].text).toContain('This lesson is finished')
    }
  })

  it('keeps exercises inside the lesson with a prompt, response gap, then model answer', () => {
    for (const model of doc.models.filter(model => model.kind === 'exercise')) {
      const script = buildAudioScript([model], words)
      const gap = script.findIndex(step => step.kind === 'response')
      expect(script.slice(0, gap).some(step => step.kind === 'speech' && step.text === spokenProse(model.prompt))).toBe(true)
      expect(script.slice(gap + 1).some(step => step.kind === 'speech' && step.text === resolveUtterance(model.answer, words).text)).toBe(true)
      expect(script[gap]).toMatchObject({ seconds: model.responseSeconds })
    }
  })
})
