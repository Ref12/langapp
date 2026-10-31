import { describe, expect, it } from 'vitest'
import { buildCatalog, type BandData, type Unit } from './catalog'
import { exerciseSchema } from './contracts'
import { buildChoice, buildMatch, fillLocalExercises, localVocabularyExercises, matchGroups, shortMeaning, vocabularyInPhrases, type VocabularyUnit } from './local-exercises'
import { checkAnswer } from './exercises'

const words: [string, string, string][] = [
  ['妈', 'mā', 'mother'], ['马', 'mǎ', 'horse'], ['麻', 'má', 'hemp; numb'], ['骂', 'mà', 'to scold'], ['吗', 'ma', 'question particle'],
  ['爱好', 'ài hào', 'to enjoy; be fond of an activity'], ['爱好', 'ài hào', 'hobby; interest'], ['水', 'shuǐ', 'water'], ['茶', 'chá', 'tea'], ['书', 'shū', 'book'],
  ['我', 'wǒ', 'I, me'], ['你', 'nǐ', 'you'], ['学生', 'xué sheng', 'student'], ['同学', 'tóng xué', 'student'],
]
const band: BandData = {
  schemaVersion: 1, band: '1', alignment: 'hsk-1',
  vocabulary: words.map(([ch, pr, ds], index) => ({ id: `v${index}`, ch, pr, ds, lb: `w${index}--${ds.replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}` })),
  grammar: [], groups: [],
}
const catalog = buildCatalog([band])
const vocab = [...catalog.units.values()].filter((unit): unit is VocabularyUnit => unit.kind === 'vocabulary')
const by = (ch: string, ds?: string) => vocab.find(unit => unit.record.ch === ch && (!ds || unit.record.ds.startsWith(ds)))!

describe('shortMeaning', () => {
  it('keeps the first sense only and never the whole gloss', () => {
    expect(shortMeaning('to enjoy; be fond of an activity')).toBe('to enjoy')
    expect(shortMeaning('hemp; numb')).toBe('hemp')
    expect(shortMeaning('a very long first sense that keeps going and going and going without any stop at all')).toMatch(/…$/)
    expect(shortMeaning('a very long first sense that keeps going and going and going without any stop at all').length).toBeLessThanOrEqual(41)
  })
})

describe('buildChoice', () => {
  const pool = vocab
  it('builds a valid zh-to-en choice with the short meaning', () => {
    const choice = buildChoice(by('爱好', 'to enjoy'), 'zh-to-en', { pool, seed: 1, id: 'c' })!
    expect(exerciseSchema.safeParse(choice).success).toBe(true)
    expect(choice.question).toBe('爱好')
    expect(choice.options[choice.answer]).toBe('to enjoy')
    expect(choice.options.some(option => option.includes(';'))).toBe(false)
  })
  it('never offers the same characters or the same meaning as a wrong option, in either direction', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const direction of ['zh-to-en', 'en-to-zh'] as const) {
        const target = by('学生')
        const choice = buildChoice(target, direction, { pool, seed, id: 'c' })!
        expect(new Set(choice.options).size).toBe(choice.options.length)
        const wrong = choice.options.filter((_, index) => index !== choice.answer)
        // 同学 also means "student": it is never a distractor for 学生.
        expect(wrong).not.toContain(direction === 'zh-to-en' ? 'student' : '同学')
        expect(wrong).not.toContain(direction === 'zh-to-en' ? 'student' : '学生')
      }
    }
    const homograph = buildChoice(by('爱好', 'hobby'), 'en-to-zh', { pool, seed: 3, id: 'c' })!
    expect(homograph.options.filter(option => option === '爱好')).toHaveLength(1)
  })
  it('is deterministic for a seed and varies across seeds', () => {
    const a = buildChoice(by('水'), 'zh-to-en', { pool, seed: 42, id: 'c' })
    expect(buildChoice(by('水'), 'zh-to-en', { pool, seed: 42, id: 'c' })).toEqual(a)
    const seen = new Set([1, 2, 3, 4, 5, 6].map(seed => JSON.stringify(buildChoice(by('水'), 'zh-to-en', { pool, seed, id: 'c' })!.options)))
    expect(seen.size).toBeGreaterThan(1)
  })
  it('prefers known items and the same level', () => {
    const known = new Set([by('茶').ref, by('书').ref, by('马').ref])
    const choice = buildChoice(by('水'), 'zh-to-en', { pool, known, seed: 9, id: 'c' })!
    expect(choice.options.filter(option => ['tea', 'book', 'horse'].includes(option))).toHaveLength(3)
  })
  it('grades with checkAnswer like any choice', () => {
    const choice = buildChoice(by('水'), 'zh-to-en', { pool, seed: 5, id: 'c' })!
    expect(checkAnswer(choice, choice.answer).correct).toBe(true)
    expect(checkAnswer(choice, (choice.answer + 1) % choice.options.length).correct).toBe(false)
  })
})

describe('buildMatch', () => {
  it('keeps tone-marked pinyin apart: mā and má may share a column, identical pinyin may not', () => {
    const focus = [by('妈'), by('马'), by('麻'), by('骂'), by('爱好', 'hobby'), by('爱好', 'to enjoy')]
    const match = buildMatch({ focus, pool: vocab, mode: 'zh-py', seed: 3, id: 'm' })!
    const rights = match.pairs.map(pair => pair.right)
    expect(new Set(rights).size).toBe(rights.length)
    expect(new Set(match.pairs.map(pair => pair.left)).size).toBe(match.pairs.length)
    const tones = buildMatch({ focus: [by('妈'), by('马'), by('麻'), by('骂')], pool: vocab, mode: 'zh-py', seed: 1, id: 'm' })!
    expect(tones.pairs.map(pair => pair.right).sort()).toEqual(['mǎ', 'má', 'mā', 'mà'].sort())
  })
  it('drops a same-pinyin partner (吗 is "ma", 妈 is "mā": different; two "ài hào" entries are the same)', () => {
    const match = buildMatch({ focus: [by('爱好', 'hobby'), by('爱好', 'to enjoy'), by('水'), by('茶'), by('书')], pool: [], mode: 'py-en', seed: 2, id: 'm' })!
    expect(match.pairs.filter(pair => pair.left === 'ài hào')).toHaveLength(1)
  })
  it('keeps English meanings distinct', () => {
    const match = buildMatch({ focus: [by('学生'), by('同学'), by('水'), by('茶'), by('书')], pool: vocab, mode: 'zh-en', seed: 4, id: 'm' })!
    expect(match.pairs.map(pair => pair.right).filter(right => right === 'student')).toHaveLength(1)
  })
  it('has 4 or 5 pairs, a valid order that is not the identity, and is deterministic', () => {
    const options = { focus: vocab.slice(0, 5), pool: vocab, mode: 'zh-en' as const, seed: 11, id: 'm' }
    const match = buildMatch(options)!
    expect(match.pairs.length).toBeGreaterThanOrEqual(4)
    expect(match.pairs.length).toBeLessThanOrEqual(5)
    expect(exerciseSchema.safeParse(match).success).toBe(true)
    expect(match.order.every((value, index) => value === index)).toBe(false)
    expect(buildMatch(options)).toEqual(match)
  })
  it('needs four compatible words', () => {
    expect(buildMatch({ focus: [by('水'), by('茶')], pool: [by('水'), by('茶')], mode: 'zh-en', seed: 1, id: 'm' })).toBeUndefined()
  })
  it('grades a match by misses', () => {
    const match = buildMatch({ focus: vocab.slice(0, 4), pool: vocab, mode: 'zh-en', seed: 1, id: 'm' })!
    expect(checkAnswer(match, [])).toEqual({ correct: true, response: '[]' })
    expect(checkAnswer(match, [match.pairs[0].ref]).correct).toBe(false)
    expect(() => checkAnswer(match, ['vocabulary:other'])).toThrow()
    expect(() => checkAnswer(match, 'x')).toThrow()
  })
})

describe('lesson sets', () => {
  const targets: Unit[] = [by('水'), by('茶'), by('书'), by('我'), by('你')]
  it('splits words into groups of four or five', () => {
    expect(matchGroups([1, 2, 3]).length).toBe(0)
    expect(matchGroups([1, 2, 3, 4, 5, 6, 7, 8, 9]).map(group => group.length)).toEqual([5, 4])
    expect(matchGroups([1, 2, 3, 4, 5, 6, 7, 8]).map(group => group.length)).toEqual([4, 4])
  })
  it('opens with a choice per word and at least one match when there are four or more words', () => {
    const set = localVocabularyExercises({ targets, pool: vocab, seed: 7 })
    expect(set.filter(exercise => exercise.type === 'choice')).toHaveLength(5)
    expect(set.some(exercise => exercise.type === 'match')).toBe(true)
    expect(set[0].type).toBe('choice')
    expect(new Set(set.map(exercise => exercise.id)).size).toBe(set.length)
    for (const exercise of set) expect(exerciseSchema.safeParse(exercise).success).toBe(true)
  })
  it('has no match under four words', () => {
    expect(localVocabularyExercises({ targets: targets.slice(0, 3), pool: vocab, seed: 7 }).some(exercise => exercise.type === 'match')).toBe(false)
  })
  it('fills with other forms: the other direction and other match modes, with fresh ids', () => {
    const opening = localVocabularyExercises({ targets, pool: vocab, seed: 7 })
    const fill = fillLocalExercises({ targets, pool: vocab, seed: 7 }, 8)
    expect(fill).toHaveLength(8)
    const ids = new Set(opening.map(exercise => exercise.id))
    expect(fill.every(exercise => !ids.has(exercise.id))).toBe(true)
    const first = opening.find(exercise => exercise.type === 'choice' && exercise.targets[0] === targets[0].ref)!
    const flipped = fill.find(exercise => exercise.type === 'choice' && exercise.targets[0] === targets[0].ref)!
    expect(flipped.type === 'choice' && first.type === 'choice' && flipped.direction !== first.direction).toBe(true)
    expect(fillLocalExercises({ targets, pool: vocab, seed: 7 }, 0)).toEqual([])
  })
  it('finds known vocabulary inside phrases with the segmenter', () => {
    const found = vocabularyInPhrases([{ text: '我喝水，你喝茶。' }, { text: '没有' }], vocab)
    expect(found.map(unit => unit.record.ch).sort()).toEqual(['你', '我', '水', '茶'].sort())
    expect(vocabularyInPhrases([{ text: 'hello' }], vocab)).toEqual([])
  })
})
