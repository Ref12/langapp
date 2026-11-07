import { describe, expect, it } from 'vitest'
import { conversationSchema, createPracticeData, exchangeSchema, grammarPointSchema, loadPracticeData, loadPracticeIndex, parsePracticeFile, acceptedItemSchema, type Conversation, type Exchange, type GrammarPoint } from '.'

const line = { zh: '你好。', py: 'nǐ hǎo', en: 'Hello.' }
const exchange = (id: string, extra: Partial<Exchange> = {}): Exchange => ({
  id, q: { zh: '你叫什么名字？', py: 'nǐ jiào shén me míng zi', en: 'What is your name?', speaker: 'female' }, a: { zh: '我叫小明。', py: 'wǒ jiào xiǎo míng', en: 'I am Xiao Ming.', speaker: 'male' },
  wrong: [line, { zh: '我是学生。', py: 'wǒ shì xué sheng', en: 'I am a student.' }], words: ['jiao4--call', 'ming2-zi5--name'], grammar: ['s-pred--statement'], readyAt: 5, ...extra,
})
const speak = (name: string, speaker: 'female' | 'male') => ({ ...line, name, speaker })
const conversation = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id, speakers: [{ name: '小明', speaker: 'male' }, { name: '王老师', speaker: 'female' }],
  lines: [speak('小明', 'male'), speak('王老师', 'female'), speak('小明', 'male'), speak('王老师', 'female')],
  questions: [{ q: 'Who speaks first?', options: ['Xiao Ming', 'Teacher Wang', 'Nobody'], answer: 0 }, { q: 'How many speakers?', options: ['One', 'Two', 'Three'], answer: 1 }], words: ['ni3--you'], grammar: [], readyAt: 9, ...extra,
})
const point: GrammarPoint = { ref: 'dou1--all', note: 'Put 都 before the verb.', readyAt: 12, items: [{ id: 'g1', ref: 'dou1--all', phrase: '我们都是学生', zh: '我们都是学生。', en: 'We are all students.', wrong: '我们是都学生。', kind: 'order', why: '都 goes before 是.', readyAt: 12 }] }

describe('practice data schemas', () => {
  it('accept the generated shapes', () => {
    expect(exchangeSchema.parse(exchange('x1')).id).toBe('x1')
    expect(conversationSchema.parse(conversation('c1')).lines).toHaveLength(4)
    expect(grammarPointSchema.parse(point).items).toHaveLength(1)
    expect(acceptedItemSchema.parse({ key: '我是学生', zh: '我是学生。', en: 'I am a student.', zhAlt: ['学生是我。'], enAlt: [], optional: [], readyAt: 1 }).zhAlt).toHaveLength(1)
  })

  it('refuse a question without exactly one right option, and other malformed items', () => {
    const questions = conversation('c1').questions
    expect(() => conversationSchema.parse(conversation('c1', { questions: [{ ...questions[0], answer: 3 }, questions[1]] }))).toThrow()
    expect(() => conversationSchema.parse(conversation('c1', { questions: [{ ...questions[0], answer: -1 }, questions[1]] }))).toThrow()
    expect(() => conversationSchema.parse(conversation('c1', { questions: [{ ...questions[0], options: ['A', 'a', 'B'] }, questions[1]] }))).toThrow()
    expect(() => conversationSchema.parse(conversation('c1', { questions: [questions[0]] }))).toThrow()
    expect(() => conversationSchema.parse(conversation('c1', { lines: conversation('c1').lines.slice(0, 3) }))).toThrow()
    expect(() => conversationSchema.parse(conversation('c1', { lines: [...conversation('c1').lines, ...conversation('c1').lines, speak('小明', 'male')] }))).toThrow()
    expect(() => conversationSchema.parse(conversation('c1', { lines: [speak('小明', 'female'), ...conversation('c1').lines.slice(1)] }))).toThrow()
    expect(() => exchangeSchema.parse(exchange('x1', { wrong: [line] }))).toThrow()
    expect(() => exchangeSchema.parse(exchange('x1', { wrong: [{ ...line, zh: '我叫小明。' }, line] }))).toThrow()
    expect(() => exchangeSchema.parse({ ...exchange('x1'), q: { ...exchange('x1').q, speaker: 'child' } })).toThrow()
    expect(() => grammarPointSchema.parse({ ...point, items: [{ ...point.items[0], wrong: point.items[0].zh }] })).toThrow()
    expect(() => parsePracticeFile('exchanges', { schemaVersion: 2, kind: 'exchanges', band: '1', items: [] })).toThrow()
    expect(() => parsePracticeFile('exchanges', { schemaVersion: 1, kind: 'grammar', band: '1', items: [] })).toThrow()
  })
})

describe('practice data lookups', () => {
  const data = createPracticeData({
    accepted: [{ key: '我是学生', zh: '我是学生。', en: 'I am a student.', zhAlt: ['学生是我。'], enAlt: ["I'm a student."], optional: [], readyAt: 1 }],
    exchanges: [exchange('x1'), exchange('x2', { words: ['ni3--you'], grammar: [], readyAt: 2 })], conversations: [conversation('c1'), conversation('c2', { words: ['jiao4--call'], readyAt: 3 })], grammar: [point],
  })

  it('finds accepted answers by phrase key or by the phrase itself', () => {
    expect(data.accepted('我是学生')?.zhAlt).toEqual(['学生是我。'])
    expect(data.accepted('我是学生。')?.enAlt).toEqual(["I'm a student."])
    expect(data.accepted('他是老师')).toBeUndefined()
  })

  it('finds exchanges and conversations by word ref (with or without the app prefix) and by grammar ref, optionally by readiness', () => {
    expect(data.exchangesForWord('vocabulary:jiao4--call').map(item => item.id)).toEqual(['x1'])
    expect(data.exchangesForWord('ni3--you', 1)).toEqual([])
    expect(data.exchangesForWord('ni3--you', 2).map(item => item.id)).toEqual(['x2'])
    expect(data.exchangesForGrammar('grammar:s-pred--statement').map(item => item.id)).toEqual(['x1'])
    expect(data.conversationsForWord('jiao4--call', 2)).toEqual([])
    expect(data.conversationsForWord('jiao4--call', 3).map(item => item.id)).toEqual(['c2'])
    expect(data.conversationsForGrammar('anything')).toEqual([])
  })

  it('finds a grammar point, its near misses and the near misses of a phrase', () => {
    expect(data.grammarPoint('grammar:dou1--all')?.note).toContain('都')
    expect(data.nearMisses('dou1--all', 11)).toEqual([])
    expect(data.nearMisses('dou1--all', 12)[0].wrong).toBe('我们是都学生。')
    expect(data.nearMissesForPhrase('我们都是学生。')).toHaveLength(1)
  })

  it('selects everything ready by a lesson, and counts', () => {
    expect(data.readyBy(3)).toMatchObject({ exchanges: [{ id: 'x2' }], conversations: [{ id: 'c2' }], nearMisses: [] })
    expect(data.readyBy(12).nearMisses).toHaveLength(1)
    expect(data.counts).toEqual({ accepted: 1, exchanges: 2, grammarPoints: 1, nearMisses: 1, conversations: 2 })
    expect(createPracticeData().counts.exchanges).toBe(0)
  })
})

describe('the shipped band files', () => {
  it('load and validate (empty until the dataset is generated)', async () => {
    const { data, problems } = await loadPracticeData()
    expect(problems).toEqual([])
    expect(data.counts.exchanges).toBeGreaterThanOrEqual(0)
    expect((await loadPracticeIndex()).schemaVersion).toBe(1)
  })
})
