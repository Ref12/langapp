import { describe, expect, it } from 'vitest'
import { buildCatalog, requireUnit, type BandData } from './catalog'
import { buildGenerationPrompt, checkAnswer, createSegmenter, validateProposal, type GenerationInput } from './exercises'

const band: BandData = {
  schemaVersion: 1, band: '1', alignment: 'hsk-1',
  vocabulary: [
    { id: 'v1', ch: '我', pr: 'wǒ', ds: 'I, me', lb: 'wo3--me' },
    { id: 'v2', ch: '是', pr: 'shì', ds: 'am; is; are', lb: 'shi4--identity' },
    { id: 'v3', ch: '学生', pr: 'xué sheng', ds: 'student', lb: 'xue2-sheng5--student' },
    { id: 'v4', ch: '学习', pr: 'xué xí', ds: 'study', lb: 'xue2-xi2--study' },
    { id: 'v5', ch: '老师', pr: 'lǎo shī', ds: 'teacher', lb: 'lao3-shi1--teacher' },
  ],
  grammar: [{
    id: 'g1', pt: '<subject> + 是 + <noun>', pr: '<subject> + shì + <noun>', ds: 'Identify with a noun.', lb: 's-shi4-n--identity',
    ex: { segments: [{ word: 'wo3--me' }, { word: 'shi4--identity' }, { word: 'xue2-sheng5--student' }, { punctuation: '。' }], translation: 'I am a student.', grammar: ['s-shi4-n--identity'] },
  }],
  groups: [{
    id: 'zh-hsk-1-lesson-0001',
    units: [{ kind: 'vocabulary', ref: 'wo3--me' }, { kind: 'vocabulary', ref: 'shi4--identity' }, { kind: 'vocabulary', ref: 'xue2-sheng5--student' }, { kind: 'grammar', ref: 's-shi4-n--identity' }],
    examples: [{ id: 'grammar-g1', segments: [{ word: 'wo3--me' }, { word: 'shi4--identity' }, { word: 'xue2-sheng5--student' }, { punctuation: '。' }], translation: 'I am a student.', grammar: ['s-shi4-n--identity'] }],
  }],
}
const catalog = buildCatalog([band])
const unit = (ref: string) => requireUnit(catalog, ref)
const input: GenerationInput = {
  mode: 'new',
  targets: ['vocabulary:wo3--me', 'vocabulary:shi4--identity', 'vocabulary:xue2-sheng5--student', 'grammar:s-shi4-n--identity'].map(unit),
  review: [unit('vocabulary:xue2-xi2--study')],
  allowed: [...catalog.units.values()].filter(item => item.ref !== 'vocabulary:lao3-shi1--teacher'),
  catalog,
}

describe('segmenter', () => {
  it('accepts text built from known forms and rejects anything else', () => {
    const segmenter = createSegmenter(['我', '是', '学生', '学习'])
    expect(segmenter.covers('我是学生。')).toBe(true)
    expect(segmenter.covers('我学习，我是学生！')).toBe(true)
    expect(segmenter.covers('我是老师。')).toBe(false)
    expect(segmenter.covers('学')).toBe(false)
    expect(segmenter.covers('I am a student.')).toBe(true)
  })
})

describe('exercise validation', () => {
  it('keeps exercises within the known set and drops the rest with reasons', () => {
    const result = validateProposal({ exercises: [
      { id: 'c1', type: 'choice', targets: ['vocabulary:xue2-sheng5--student'], direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I am a teacher.'], answer: 0, explanation: '学生 means student.' },
      { id: 'c2', type: 'choice', targets: ['vocabulary:wo3--me'], direction: 'en-to-zh', question: 'I study.', options: ['我学习。', '我是老师。'], answer: 0, explanation: 'Uses an unknown word.' },
      { id: 't1', type: 'tiles', targets: ['grammar:s-shi4-n--identity'], translation: 'I am a student.', tiles: ['我', '是', '学生'], distractors: ['学习'], explanation: 'Subject, 是, noun.' },
      { id: 't1', type: 'tiles', targets: ['grammar:s-shi4-n--identity'], translation: 'Duplicate id.', tiles: ['我', '学习'], distractors: [], explanation: 'x' },
      { id: 'c3', type: 'choice', targets: ['vocabulary:lao3-shi1--teacher'], direction: 'zh-to-en', question: '我', options: ['I', 'you'], answer: 0, explanation: 'Outside session.' },
      { id: 'c4', type: 'choice', targets: ['vocabulary:wo3--me'], direction: 'zh-to-en', question: '我', options: ['I', 'I'], answer: 0, explanation: 'Duplicate options.' },
      { id: 'c5', type: 'choice', targets: ['vocabulary:wo3--me'], direction: 'zh-to-en', question: '我', options: ['I', 'you'], answer: 2, explanation: 'Bad index.' },
    ] }, input)
    expect(result.exercises.map(exercise => exercise.id)).toEqual(['c1', 't1'])
    expect(result.rejected).toHaveLength(5)
    expect(result.rejected.join('\n')).toContain('c2: uses vocabulary outside the known set')
    expect(result.rejected.join('\n')).toContain('c3: targets an item outside this session')
    const tiles = result.exercises[1]
    if (tiles.type !== 'tiles') throw new Error('expected tiles')
    expect([...tiles.shuffled].sort()).toEqual([0, 1, 2, 3])
    expect(tiles.shuffled).not.toEqual([0, 1, 2, 3])
  })

  it('rejects an unsupported shape instead of repairing it', () => {
    expect(() => validateProposal({ items: [] }, input)).toThrow(/unsupported shape/)
  })

  it('builds a bounded prompt that lists targets, review items and other known words', () => {
    const prompt = buildGenerationPrompt(input)
    const request = JSON.parse(prompt.user)
    expect(request.targets).toHaveLength(4)
    expect(request.targets[3].example.chinese).toBe('我是学生。')
    expect(request.alsoReview[0].ref).toBe('vocabulary:xue2-xi2--study')
    expect(request.otherKnownVocabulary).toEqual([])
    expect(prompt.system).toContain('{"exercises":[...]}')
    expect(prompt.user.length).toBeLessThan(100_000)
  })

  it('checks answers for both exercise types', () => {
    const { exercises } = validateProposal({ exercises: [
      { id: 'c1', type: 'choice', targets: ['vocabulary:wo3--me'], direction: 'zh-to-en', question: '我', options: ['I', 'you'], answer: 0, explanation: 'x' },
      { id: 't1', type: 'tiles', targets: ['vocabulary:wo3--me'], translation: 'I am a student.', tiles: ['我', '是', '学生'], distractors: [], explanation: 'x' },
    ] }, input)
    expect(checkAnswer(exercises[0], 0)).toEqual({ correct: true, response: '0' })
    expect(checkAnswer(exercises[0], 1).correct).toBe(false)
    expect(() => checkAnswer(exercises[0], 5)).toThrow()
    expect(checkAnswer(exercises[1], ['我', '是', '学生']).correct).toBe(true)
    expect(checkAnswer(exercises[1], ['是', '我', '学生']).correct).toBe(false)
    expect(checkAnswer(exercises[1], ['我', '是']).correct).toBe(false)
  })
})
