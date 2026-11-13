import { beforeAll, describe, expect, it } from 'vitest'
import { loadCatalog, type Catalog } from '../study/catalog'
import { loadItems } from '../drills/items'
import type { BankPhrase } from '../phrases/contracts'
import { createPracticeData, type Conversation, type Exchange, type GrammarPoint } from '../practice-data'
import { voiceFor, PITCH } from '../assistant/speaker-voices'
import { createDatasetSource, datasetAcceptance, reachedLesson } from './dataset-source'
import { acceptedAnswers, acceptedEnglish, gradeChinese, gradeMeaning } from './grade'
import { buildTiles, buildTranslate, type FormContext } from './bank-forms'
import { planSession, type PlanItem } from './plan'
import { DEFAULT_PRESET } from './presets'
import { loadSessionBank } from './sources'
import type { ConversationItem, ExchangePickItem, SessionExercise, TextItem, TilesItem, WhichCorrectItem } from './types'

// Fixture dataset entries over real HSK 1 words (the shipped band files are empty until the full generation lands).
const V = (ref: string) => 'vocabulary:' + ref
const ME = V('wo3--me'), YOU = V('ni3--you'), BE = V('shi4--identity'), STUDENT = V('xue2-sheng5--student'), CALL = V('jiao4--call'), NAME = V('ming2-zi5--name'), WHAT = V('shen2-me5--what')
const LATE = V('ke4--class')
const GRAMMAR = 'grammar:clause-s-ye3-pred--also'
const ln = (zh: string, py: string, en: string) => ({ zh, py, en })
const exchange = (id: string, extra: Partial<Exchange> = {}): Exchange => ({
  id, q: { ...ln('你叫什么名字？', 'nǐ jiào shén me míng zi', 'What is your name?'), speaker: 'female' }, a: { ...ln('我叫小明。', 'wǒ jiào xiǎo míng', 'My name is Xiao Ming.'), speaker: 'male' },
  wrong: [ln('我是学生。', 'wǒ shì xué sheng', 'I am a student.'), ln('你好。', 'nǐ hǎo', 'Hello.')], words: [YOU, CALL, WHAT, NAME, ME], grammar: [], readyAt: 100, ...extra,
})
const speak = (name: string, speaker: 'female' | 'male', zh = '你好。') => ({ ...ln(zh, 'nǐ hǎo', 'Hello.'), name, speaker })
const conversation = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id, speakers: [{ name: '小明', speaker: 'male' }, { name: '王老师', speaker: 'female' }],
  lines: [speak('小明', 'male', '你好。'), speak('王老师', 'female', '你叫什么名字？'), speak('小明', 'male', '我叫小明。'), speak('王老师', 'female', '我是学生。')],
  questions: [{ q: 'Who speaks first?', options: ['Xiao Ming', 'Teacher Wang', 'Nobody'], answer: 0 }, { q: 'Who is the student?', options: ['Xiao Ming', 'Teacher Wang'], answer: 1 }],
  words: [YOU, CALL, WHAT, NAME, ME, BE, STUDENT], grammar: [], readyAt: 100, ...extra,
})
const point: GrammarPoint = {
  ref: GRAMMAR, note: 'Put 也 before the verb.', readyAt: 100,
  items: [{ id: 'g1', ref: GRAMMAR, phrase: '你叫什么名字', zh: '你叫什么名字？', en: 'What is your name?', wrong: '你什么叫名字？', kind: 'order', why: '什么 goes after 叫.', readyAt: 100 },
    { id: 'g2', ref: GRAMMAR, phrase: '你叫什么名字', zh: '你叫什么名字？', en: 'What is your name?', wrong: '你叫名字什么？', kind: 'order', why: '名字 comes right after 什么.', readyAt: 100 }],
}
const accepted = { key: '我是学生', zh: '我是学生。', en: 'I am a student.', zhAlt: ['学生是我。'], enAlt: ["I'm a student.", 'I am a pupil.'], optional: ['都'], synonyms: [{ from: '学生', to: '同学' }], readyAt: 1 }
const data = createPracticeData({ accepted: [accepted], exchanges: [exchange('x1')], conversations: [conversation('c1')], grammar: [point] })

let catalog: Catalog
let items: PlanItem[]
let allowed: Set<string>
let bank: BankPhrase[]
const phrase = (zh: string, py: string, en: string, words: string[]): BankPhrase => ({ zh, py, en, words, source: 'ai', checked: true })

beforeAll(async () => {
  catalog = await loadCatalog()
  const refs = [ME, YOU, BE, STUDENT, CALL, NAME, WHAT].filter(ref => catalog.units.has(ref))
  expect(refs).toHaveLength(7)
  const loaded = await loadItems(refs, catalog)
  items = [...loaded, { ref: GRAMMAR, kind: 'grammar', zh: '也', py: 'yě', en: 'also', }]
  allowed = new Set([...refs, GRAMMAR])
  bank = [phrase('你叫什么名字？', 'nǐ jiào shén me míng zi', 'What is your name?', [YOU, CALL, WHAT, NAME])]
}, 60000)

const exercises = (stage: 'recognise' | 'use', form: string[], over: { allowed?: Set<string>; items?: PlanItem[]; readyAt?: number; data?: typeof data; taken?: (zh: string) => boolean } = {}) => {
  const source = createDatasetSource({ data: over.data ?? data, catalog, seed: 3, bank, readyAt: over.readyAt ?? 100 })
  return source.exercises({ stage, forms: form as never, items: over.items ?? items, allowed: over.allowed ?? allowed, taken: over.taken ?? (() => false), take: () => true })
}

describe('accepted alternatives in the grading', () => {
  const ctx = (): FormContext => ({ catalog, knownUnits: [], bank: [], seed: 1, forms: new Set(['我', '是', '学生', '同学', '都']), ...datasetAcceptance(data) })
  const model = phrase('我是学生。', 'wǒ shì xué sheng', 'I am a student.', [ME, BE, STUDENT])
  it('counts the dataset zhAlt and a synonym swap as right for English to Chinese', () => {
    const built = buildTranslate({ id: 't', stage: 'produce', refs: [], round: 0 }, 'translate-en-zh', model, ctx()) as TextItem
    expect(built.accepted).toEqual(expect.arrayContaining(['我是学生。', '学生是我。', '我是同学。']))
    for (const answer of ['学生是我', '我是同学']) expect(gradeChinese(answer, built.accepted, ctx().forms, built.optional).verdict).toBe('correct')
    expect(gradeChinese('我是老师', built.accepted, ctx().forms, built.optional).verdict).toBe('diff')
  })
  it('treats the dataset optional words as optional, and only for that phrase', () => {
    const built = buildTranslate({ id: 't', stage: 'produce', refs: [], round: 0 }, 'translate-en-zh', model, ctx()) as TextItem
    expect(built.optional).toEqual(['都'])
    const grade = gradeChinese('我都是学生', built.accepted, ctx().forms, built.optional)
    expect(grade.verdict).toBe('correct'); expect(grade.ignored).toEqual(['都'])
    expect(gradeChinese('我都是学生', built.accepted, ctx().forms).verdict).toBe('diff')
  })
  it('carries the alternatives and optional words into a tiles exercise', () => {
    const tiles = buildTiles({ id: 'ti', stage: 'produce', refs: [], round: 0 }, model, { ...ctx(), knownUnits: [] }) as TilesItem
    expect(tiles.accepted).toContain('学生是我。'); expect(tiles.optional).toEqual(['都'])
  })
  it('adds enAlt to the Chinese to English meaning grading', () => {
    const built = buildTranslate({ id: 't', stage: 'use', refs: [], round: 0 }, 'translate-zh-en', model, ctx()) as TextItem
    expect(built.accepted).toEqual(expect.arrayContaining(['I am a student.', "I'm a student.", 'I am a pupil.']))
    expect(gradeMeaning('I am a pupil', built.accepted).verdict).toBe('correct')
    expect(gradeMeaning('I am a pupil', acceptedEnglish(model, [])).verdict).not.toBe('correct')
    expect(acceptedAnswers(model, [])).toEqual(['我是学生。'])
  })
})

describe('exchange exercises', () => {
  it('builds a pick-the-reply exercise: the reply and its wrong replies, the right one marked', () => {
    const [pick] = exercises('recognise', ['exchange-pick']) as ExchangePickItem[]
    expect(pick.form).toBe('exchange-pick')
    expect(pick.options.map(option => option.zh).sort()).toEqual(['你好。', '我叫小明。', '我是学生。'].sort())
    expect(pick.options[pick.answer].zh).toBe('我叫小明。')
    expect(pick.question.zh).toBe('你叫什么名字？')
    expect(pick.refs.length).toBeGreaterThan(0)
    expect(pick.refs.every(ref => items.some(item => item.ref === ref))).toBe(true)
  })
  it('builds a reply exercise for Use, graded like Translate with the dataset alternatives', () => {
    const withAlt = createPracticeData({ exchanges: [exchange('x1')], accepted: [{ key: '我叫小明', zh: '我叫小明。', en: 'My name is Xiao Ming.', zhAlt: ['我的名字是小明。'], enAlt: [], optional: [], readyAt: 1 }] })
    const [reply] = exercises('use', ['exchange-reply'], { data: withAlt }) as TextItem[]
    expect(reply.form).toBe('exchange-reply'); expect(reply.answerLang).toBe('zh'); expect(reply.hearText).toBe('你叫什么名字？')
    expect(reply.accepted).toEqual(['我叫小明。', '我的名字是小明。'])
    expect(gradeChinese('我叫小明', reply.accepted, new Set(['我', '叫', '小明'])).verdict).toBe('correct')
  })
  it('is offered only in the stage and form the preset lists', () => {
    expect(exercises('use', ['exchange-pick'])).toHaveLength(0)
    expect(exercises('recognise', ['choice'])).toHaveLength(0)
  })
  it('is gated on the knowledge set, readyAt and the session items', () => {
    const missing = new Set([...allowed].filter(ref => ref !== NAME))
    expect(exercises('recognise', ['exchange-pick'], { allowed: missing })).toHaveLength(0)
    expect(exercises('recognise', ['exchange-pick'], { readyAt: 50 })).toHaveLength(0)
    const other = createPracticeData({ exchanges: [exchange('x9', { words: [V('shu1--book')] })] })
    expect(exercises('recognise', ['exchange-pick'], { data: other, allowed: new Set([...allowed, V('shu1--book')]) })).toHaveLength(0)
    expect(exercises('recognise', ['exchange-pick'], { taken: zh => zh === '我叫小明。' })).toHaveLength(0)
  })
})

describe('grammar near-miss exercises', () => {
  it('builds Which is correct? with the phrase against one or two near misses, whys and the pattern note', () => {
    const [which] = exercises('recognise', ['which-correct']) as WhichCorrectItem[]
    expect(which.form).toBe('which-correct')
    expect(which.options).toHaveLength(3)
    expect(which.options[which.answer].zh).toBe('你叫什么名字？')
    expect(which.whys.filter(Boolean).sort()).toEqual(['什么 goes after 叫.', '名字 comes right after 什么.'])
    expect(which.whys[which.answer]).toBeUndefined()
    expect(which.note).toBe('Put 也 before the verb.'); expect(which.refs).toEqual([GRAMMAR])
  })
  it('is only for grammar items whose real phrase and grammar are known and ready', () => {
    expect(exercises('recognise', ['which-correct'], { items: items.filter(item => item.kind !== 'grammar') })).toHaveLength(0)
    expect(exercises('recognise', ['which-correct'], { allowed: new Set([...allowed].filter(ref => ref !== GRAMMAR)) })).toHaveLength(1)
    expect(exercises('recognise', ['which-correct'], { readyAt: 50 })).toHaveLength(0)
  })
})

describe('conversations in Use', () => {
  it('offers a conversation that fits, with named speakers, two questions and the voices', () => {
    const [talk] = exercises('use', ['conversation']) as ConversationItem[]
    expect(talk.form).toBe('conversation')
    expect(talk.speakers.map(speaker => speaker.name)).toEqual(['小明', '王老师'])
    expect(talk.lines.map(line => line.speaker)).toEqual(['male', 'female', 'male', 'female'])
    expect(talk.questions).toHaveLength(2)
    // Options are shuffled, but the answer still points at the same option text.
    expect(talk.questions.map(question => question.options[question.answer])).toEqual(['Xiao Ming', 'Teacher Wang'])
    expect([...talk.questions[0].options].sort()).toEqual(['Nobody', 'Teacher Wang', 'Xiao Ming'])
  })
  it('does not keep the right answer first: over many seeds the right option moves', () => {
    const firsts = new Set<number>()
    for (let seed = 1; seed <= 20; seed++) {
      const source = createDatasetSource({ data, catalog, seed, bank, readyAt: 100 })
      const [talk] = source.exercises({ stage: 'use', forms: ['conversation'] as never, items, allowed, taken: () => false, take: () => true }) as ConversationItem[]
      firsts.add(talk.questions[0].answer)
    }
    expect(firsts.size).toBeGreaterThan(1)
  })
  it('never forces one: not when a word is unknown, readyAt is not reached, or no session item is touched', () => {
    expect(exercises('use', ['conversation'], { allowed: new Set([...allowed].filter(ref => ref !== STUDENT)) })).toHaveLength(0)
    expect(exercises('use', ['conversation'], { readyAt: 10 })).toHaveLength(0)
    expect(exercises('use', ['conversation'], { items: items.filter(item => item.ref === LATE) })).toHaveLength(0)
    expect(exercises('use', ['conversation'], { data: createPracticeData({}) })).toHaveLength(0)
  })
  it('is not offered in the recognise stage', () => { expect(exercises('recognise', ['conversation'])).toHaveLength(0) })
})

describe('speaker voices', () => {
  const voice = (name: string) => ({ name, voiceURI: name, lang: 'zh-CN', localService: true })
  it('uses a different Chinese voice per gender when the device has both', () => {
    const voices = [voice('Microsoft Huihui'), voice('Microsoft Kangkang')]
    expect(voiceFor('female', voices).voice).toMatchObject({ name: 'Microsoft Huihui' })
    expect(voiceFor('male', voices).voice).toMatchObject({ name: 'Microsoft Kangkang' })
  })
  it('falls back to a different pitch when it does not', () => {
    for (const voices of [[], [voice('Microsoft Huihui')], [voice('Generic Chinese')]]) {
      const female = voiceFor('female', voices), male = voiceFor('male', voices)
      expect(female.pitch).toBe(PITCH.female); expect(male.pitch).toBe(PITCH.male); expect(female.pitch).toBeGreaterThan(male.pitch!)
    }
  })
  it('uses the Edge voice of each gender when an Edge voice is selected', () => {
    const edge = { provider: 'edge' as const, voice: 'zh-CN-XiaoxiaoNeural' }
    expect(voiceFor('female', [], edge).voice).not.toEqual(voiceFor('male', [], edge).voice)
  })
})

describe('the planner with the dataset (real HSK 1 items)', () => {
  it('puts dataset exercises in the recognise and use stages and the rest of the plan stays valid', async () => {
    const refs = [ME, YOU, BE, STUDENT, CALL, NAME, WHAT]
    const real = await loadItems(refs, catalog)
    const known = new Set([...catalog.units.values()].filter(unit => unit.kind === 'vocabulary' && unit.band === '1').map(unit => unit.ref).filter(ref => !refs.includes(ref)))
    const set = new Set([...known, ...refs])
    expect(reachedLesson(catalog, set)).toBeGreaterThan(0)
    const sessionBank = await loadSessionBank(catalog, real, set)
    const fixture = createPracticeData({ exchanges: [exchange('x1')], conversations: [conversation('c1', { lines: [speak('小明', 'male', '你好。'), speak('王老师', 'female', '你叫什么名字？'), speak('小明', 'male', '我叫小明，你呢？'), speak('王老师', 'female', '我叫王老师。')] })], accepted: [accepted] })
    const plan = planSession({ intent: 'practice-set', items: real, length: 'standard', preset: DEFAULT_PRESET, seed: 5, catalog, known, bank: sessionBank.byItem, allBank: sessionBank.all,
      ...datasetAcceptance(fixture), dataset: createDatasetSource({ data: fixture, catalog, seed: 5, bank: sessionBank.all, readyAt: 1000 }) })
    const by = (stage: string) => plan.stages.find(entry => entry.stage === stage)?.exercises ?? []
    expect(by('recognise').some((exercise: SessionExercise) => exercise.form === 'exchange-pick')).toBe(true)
    expect(by('use').some((exercise: SessionExercise) => exercise.form === 'conversation')).toBe(true)
    expect(plan.total).toBeGreaterThan(0)
    const sentences = plan.stages.flatMap(entry => entry.exercises).flatMap(exercise => exercise.form === 'exchange-pick' ? [exercise.options[exercise.answer].zh] : [])
    expect(new Set(sentences).size).toBe(sentences.length)
  }, 60000)
  it('plans exactly as before with the empty shipped dataset', async () => {
    const refs = [ME, YOU]
    const real = await loadItems(refs, catalog)
    const known = new Set([...catalog.units.values()].filter(unit => unit.kind === 'vocabulary' && unit.band === '1').map(unit => unit.ref))
    const sessionBank = await loadSessionBank(catalog, real, known)
    const input = { intent: 'practice-set' as const, items: real, length: 'standard' as const, preset: DEFAULT_PRESET, seed: 5, catalog, known, bank: sessionBank.byItem, allBank: sessionBank.all }
    const empty = createPracticeData({})
    const plain = planSession(input)
    const withEmpty = planSession({ ...input, ...datasetAcceptance(empty), dataset: createDatasetSource({ data: empty, catalog, seed: 5, bank: sessionBank.all }) })
    expect(withEmpty).toEqual(plain)
  }, 60000)
})
