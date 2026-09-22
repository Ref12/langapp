// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { lessonSchema, pageUtterances, validateLessonSequence } from './v2-lesson-schema.mjs'

const readYaml = (path: string) => parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const inventory = {
  vocabulary: readYaml('../curriculum/v2/chinese/hsk-1/vocabulary.yaml'),
  grammar: readYaml('../curriculum/v2/chinese/hsk-1/grammar.yaml'),
}
const fresh = () => lessonSchema.parse(readYaml('../curriculum/v2/chinese/lessons/001-greetings-and-identity.yaml'))
const validate = (lesson: ReturnType<typeof fresh>) => validateLessonSequence([lesson], inventory)

describe('v2 declarative lesson pilot', () => {
  it('defines 17 explicit pages, six vocabulary senses and one construction from v2', () => {
    const [lesson] = validate(fresh())
    expect(lesson.pages).toHaveLength(17)
    expect(lesson.pages.filter(page => page.template === 'vocabulary')).toHaveLength(6)
    expect(lesson.pages.filter(page => page.template === 'grammar')).toHaveLength(1)
    expect(new Set(lesson.pages.map(page => page.template))).toEqual(
      new Set(['overview', 'concept', 'tone-comparison', 'vocabulary', 'grammar', 'dialogue', 'recall', 'summary']))
    const words = new Map<string, string>(inventory.vocabulary.map((word: { lb: string; ch: string }) => [word.lb, word.ch]))
    const answers = lesson.pages.filter(page => page.template === 'recall').flatMap(pageUtterances)
    expect(answers.map(answer => answer.segments.map(segment =>
      'word' in segment ? words.get(segment.word) : segment.punctuation).join('')))
      .toEqual(['你好！我是学生。', '你是学生。'])
  })

  it('uses inventory labels for all lesson knowledge references, not canonical IDs or a second registry', () => {
    const lesson = fresh()
    const words = lesson.pages.filter(page => page.template === 'vocabulary').map(page => page.data.word)
    expect(words).toEqual(['ni3-hao3--hello', 'wo3--me', 'ni3--you',
      'shi4--identity', 'xue2-sheng5--student', 'lao3-shi1--teacher'])
    expect(lesson.pages.find(page => page.template === 'grammar')!.data.grammar).toBe('s-shi4-n--identity')
    expect(JSON.stringify(lesson)).not.toContain('zh-hsk')
    for (const canonical of ['zh-hsk1-00384-s001', 'zh-hsk1-g001']) {
      const current = fresh()
      if (canonical.includes('-g')) current.pages.find(page => page.template === 'grammar')!.data.grammar = canonical
      else current.pages.find(page => page.template === 'vocabulary')!.data.word = canonical
      expect(() => validate(current)).toThrow()
    }
    const duplicate = structuredClone(inventory)
    duplicate.vocabulary[1].lb = duplicate.vocabulary[0].lb
    expect(() => validateLessonSequence([lesson], duplicate)).toThrow(/Duplicate vocabulary label/)
    const duplicateGrammar = structuredClone(inventory)
    duplicateGrammar.grammar[1].lb = duplicateGrammar.grammar[0].lb
    expect(() => validateLessonSequence([lesson], duplicateGrammar)).toThrow(/Duplicate grammar label/)
  })

  it('introduces pinyin and tones before vocabulary with a same-syllable comparison and contextual neutral tone', () => {
    const [lesson] = validate(fresh())
    expect(lesson.pages.slice(1, 6).map(page => page.id))
      .toEqual(['pinyin-basics', 'tone-basics', 'ma-tone-comparison', 'pinyin-in-use', 'hello'])
    const comparison = lesson.pages.find(page => page.template === 'tone-comparison')!
    expect(comparison.data.examples.map(example => [example.tone, example.pinyin]))
      .toEqual([[1, 'mā'], [2, 'má'], [3, 'mǎ'], [4, 'mà'], [5, 'ma']])
    expect(comparison.data.neutralContext.syllables).toEqual(['mā', 'ma'])
    expect(comparison.data.neutralContext.focus).toBe(2)
    expect(pageUtterances(comparison)).toEqual([])
  })

  it.each(['missing-tone', 'duplicate-tone', 'wrong-mark', 'different-syllable', 'bad-focus',
    'marked-neutral', 'neutral-predecessor', 'raw-sentence'] as const)(
    'rejects malformed pronunciation comparisons: %s', change => {
      const lesson = fresh()
      const data = lesson.pages.find(page => page.template === 'tone-comparison')!.data
      if (change === 'missing-tone') data.examples.pop()
      if (change === 'duplicate-tone') data.examples[1] = { ...data.examples[0] }
      if (change === 'wrong-mark') data.examples[1].pinyin = 'mǎ'
      if (change === 'different-syllable') data.examples[1].pinyin = 'ní'
      if (change === 'bad-focus') data.neutralContext.focus = 3
      if (change === 'marked-neutral') data.neutralContext.syllables[1] = 'mā'
      if (change === 'neutral-predecessor') data.neutralContext.syllables[0] = 'ma'
      if (change === 'raw-sentence') data.examples[0].pinyin = '你好'
      expect(() => validate(lesson)).toThrow()
    })

  it('does not count pronunciation exposure as introduced vocabulary', () => {
    const lesson = fresh()
    const answer = lesson.pages.find(page => page.template === 'recall')!.data.answer
    answer.segments = [{ word: 'ma1-ma5--mom' }]
    expect(() => validate(lesson)).toThrow(/vocabulary before introduction/)
  })

  it('rejects unknown templates, extra behavior and untracked target-language prose', () => {
    const current = fresh()
    expect(() => lessonSchema.parse({ ...current, script: 'run()' })).toThrow()
    const page = current.pages[0]
    expect(() => lessonSchema.parse({ ...current, pages: [{ ...page, template: 'custom' }] })).toThrow()
    expect(() => lessonSchema.parse({ ...current, title: '<script>run()</script>' })).toThrow()
    expect(() => lessonSchema.parse({ ...current, objectives: ['Say 未教'] })).toThrow()
  })

  it.each(['duplicate-page', 'future-page', 'future-lesson', 'missing-overview', 'early-summary'] as const)(
    'rejects invalid ordering: %s', change => {
      const lesson = fresh()
      if (change === 'duplicate-page') lesson.pages[1].id = lesson.pages[0].id
      if (change === 'future-page') lesson.pages[0].requires = [lesson.pages[1].id]
      if (change === 'future-lesson') lesson.prerequisites = ['zh-v2-lesson-002']
      if (change === 'missing-overview') lesson.pages.shift()
      if (change === 'early-summary') lesson.pages.splice(1, 0, lesson.pages.pop()!)
      expect(() => validate(lesson)).toThrow()
    })

  it('rejects unknown references and review before introduction', () => {
    for (const change of ['unknown', 'review', 'duplicate'] as const) {
      const lesson = fresh()
      const page = lesson.pages.find(page => page.template === 'vocabulary')!
      if (change === 'unknown') page.data.word = 'unknown--word'
      if (change === 'review') page.data.role = 'review'
      if (change === 'duplicate') {
        lesson.pages.splice(lesson.pages.indexOf(page) + 1, 0, { ...structuredClone(page), id: 'duplicate-introduction' })
      }
      expect(() => validate(lesson)).toThrow(/unknown|first introduction/)
    }
  })

  it('checks page-level cutoffs in every example, dialogue turn and model answer', () => {
    const lesson = fresh()
    for (const page of lesson.pages) {
      for (const utterance of pageUtterances(page)) {
        const segments = utterance.segments
        utterance.segments = [{ word: 'zai4-jian4--goodbye' }]
        expect(() => validate(lesson)).toThrow(/vocabulary before introduction/)
        utterance.segments = segments
        const grammar = utterance.grammar
        utterance.grammar = ['stmt-ma5--yes-no']
        expect(() => validate(lesson)).toThrow(/grammar before introduction|must declare/)
        utterance.grammar = grammar
      }
    }
    const greeting = lesson.pages.find(page => page.id === 'greeting-tones')!
    greeting.requires = []
    lesson.pages.splice(lesson.pages.indexOf(greeting), 1)
    lesson.pages.splice(2, 0, greeting)
    expect(() => validate(lesson)).toThrow(/vocabulary before introduction/)
  })

  it('requires the taught grammar on examples and valid dialogue speakers', () => {
    const lesson = fresh()
    const grammar = lesson.pages.find(page => page.template === 'grammar')!
    grammar.data.examples[0].grammar = []
    expect(() => validate(lesson)).toThrow(/must declare/)
    const other = fresh()
    const dialogue = other.pages.find(page => page.template === 'dialogue')!
    dialogue.data.turns[0].speaker = 'unknown'
    expect(() => validate(other)).toThrow(/unknown dialogue speaker/)
    dialogue.data.speakers[1].id = dialogue.data.speakers[0].id
    expect(() => validate(other)).toThrow(/Duplicate speaker/)
  })

  it('carries introduced knowledge into later lessons without treating the full HSK inventory as known', () => {
    const first = fresh()
    const review = fresh()
    review.id = 'zh-v2-lesson-002'
    review.prerequisites = [first.id]
    for (const page of review.pages) {
      if (page.template === 'vocabulary' || page.template === 'grammar') page.data.role = 'review'
    }
    expect(validateLessonSequence([first, review], inventory)).toHaveLength(2)
    expect(() => validateLessonSequence([first, first], inventory)).toThrow(/Duplicate lesson/)
    expect(() => validateLessonSequence([review, first], inventory)).toThrow(/prerequisite/)
  })
})
