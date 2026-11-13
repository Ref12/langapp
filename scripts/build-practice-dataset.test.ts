import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  allowedAt, buildOutputs, createSaver, emptyState, hydrate, KIND_SPECS, loadState, main, parseArgs, planReport, pool, runKind, spread,
  validateAccepted, validateConversation, speakerNameOk, blindReplies, NAME_POOL, namesFor, validateExchange, validateGrammarPoint, readBank,
} from './build-practice-dataset.mjs'
import { buildCurriculum } from './build-phrase-bank.mjs'
import { acceptedFileSchema, conversationsFileSchema, createPracticeData, exchangesFileSchema, grammarFileSchema, practiceIndexSchema } from '../src/core/practice-data'

const word = (lb: string, ch: string, pr: string) => ({ id: lb, ch, pr, ds: 'meaning of ' + lb, lb })
const unit = (ref: string) => ({ kind: 'vocabulary', ref })
const g = (id: string, ...refs: string[]) => ({ id, units: refs.map(unit), examples: [] })
const WORDS = [word('wo', '我', 'wǒ'), word('ni', '你', 'nǐ'), word('shi', '是', 'shì'), word('ma', '吗', 'ma'), word('xs', '学生', 'xué sheng'), word('ls', '老师', 'lǎo shī'),
  word('hao', '好', 'hǎo'), word('xx', '学习', 'xué xí'), word('hy', '汉语', 'hàn yǔ'), word('jiao', '叫', 'jiào'), word('mz', '名字', 'míng zi'), word('sm', '什么', 'shén me'), word('xm', '小明', 'xiǎo míng'), word('dou', '都', 'dōu'), word('hen', '很', 'hěn'), word('fc', '非常', 'fēi cháng')]
const point = { id: 'g-shi', lb: 'g-shi', pt: '是', pr: '是', ds: 'identity with shi', ex: { segments: [{ word: 'wo' }], translation: '', grammar: ['g-shi'] } }
const FIXTURE = [
  { schemaVersion: 1, band: '1', alignment: 'hsk-1', vocabulary: WORDS, grammar: [point],
    groups: [{ id: 'g1', units: [unit('wo'), unit('ni'), unit('shi'), { kind: 'grammar', ref: 'g-shi' }], examples: [] }, g('g2', 'ma', 'xs'), g('g3', 'ls', 'hao'), g('g4', 'xx', 'hy', 'dou', 'hen', 'fc'), g('g5', 'jiao', 'mz', 'sm', 'xm')] },
  ...['2', '3', '4', '5', '6'].map(band => ({ schemaVersion: 1, band, alignment: 'hsk-' + band, vocabulary: [], grammar: [], groups: [] })),
]
const curriculum = () => buildCurriculum(FIXTURE)
const phrase = (id: number, zh: string, en: string, words: string[], readyAt: number, grammar: string[] = []) => ({ id, zh, py: 'x', en, words, grammar, source: 'ai', checked: true, lookahead: 0, readyAt })
const BANK = [phrase(1, '我是学生。', 'I am a student.', ['wo', 'shi', 'xs'], 1, ['g-shi']), phrase(2, '你是老师吗？', 'Are you a teacher?', ['ni', 'shi', 'ls', 'ma'], 2, ['g-shi']), phrase(3, '我学习汉语。', 'I study Chinese.', ['wo', 'xx', 'hy'], 3)]

const dirs: string[] = []
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), 'practice-dataset-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const bankDir = () => { const dir = tmp(); writeFileSync(join(dir, 'hsk-1.json'), JSON.stringify({ schemaVersion: 2, band: '1', phrases: BANK })); return dir }

const options = (extra = {}) => ({ ...parseArgs([], {}), concurrency: 4, perLesson: 6, convPerLesson: 2, perPoint: 6, minVocab: 3, batchSize: { accepted: 2, grammar: 2 }, saveInterval: 0, ...extra })
const idsIn = (user: string) => [...user.matchAll(/"id":"([^"]+)"/g)].map(match => match[1])

/** A blind checker for exchanges: it sees each question with its replies in the order given and says which replies a native speaker could give (the zh texts in 'valid'). */
const blindVerdict = (user: string, valid: string[], extra: Record<string, unknown> = {}) => ({ items: user.split('\n').filter(entry => entry.startsWith('{"id"')).map(entry => { const row = JSON.parse(entry); return { id: row.id, questionNatural: true, natural: true, validReplies: row.replies.flatMap((reply: { zh: string }, at: number) => valid.includes(reply.zh) ? [at] : []), ...extra } }) })
const exchange = (extra = {}) => ({ q: { zh: '你是学生吗？', en: 'Are you a student?', speaker: 'female' }, a: { zh: '我是学生。', en: 'I am a student.', speaker: 'male' }, wrong: [{ zh: '我是老师。', en: 'I am a teacher.' }, { zh: '你好。', en: 'Hello.' }], grammar: ['g-shi', 'not-a-ref'], ...extra })
const line = (name: string, speaker: string, zh: string, en: string) => ({ name, speaker, zh, en })
const conversation = (extra = {}) => ({
  speakers: [{ name: '王老师', py: 'wáng lǎo shī', en: 'Teacher Wang' }, { name: '小明', py: 'xiǎo míng', en: 'Xiao Ming' }],
  lines: [line('王老师', 'female', '你是学生吗？', 'Are you a student?'), line('小明', 'male', '我是学生。', 'I am a student.'), line('王老师', 'female', '你叫什么名字？', 'What is your name?'), line('小明', 'male', '我叫小明。', 'I am called Xiao Ming.')],
  questions: [{ q: 'What is Xiao Ming?', options: ['A student', 'A teacher', 'A doctor'], answer: 0 }, { q: 'What does the teacher ask?', options: ['His name', 'His age', 'His school'], answer: 0 }], grammar: [], ...extra,
})

describe('validators', () => {
  it('keeps only accepted answers that use words the phrase\'s lesson allows, once each', () => {
    const c = curriculum()
    const { item, dropped } = validateAccepted(c, { key: '', ...BANK[0], zh: '我是学生。' }, { zhAlt: ['学生是我。', '我是学生', '我是老师。', '我是学习。', '我是汉语。'], enAlt: ['I\'m a student.', 'I am a student', '我是学生', 'A student am I.'], optional: ['是', '汉', '学生', ''] })
    // 老师 comes in lesson 3, 汉语 in lesson 4: not allowed at readyAt 1
    expect(item.zhAlt).toEqual(['学生是我。'])
    expect(item.enAlt).toEqual(["I'm a student.", 'A student am I.'])
    expect(item.optional).toEqual(['是', '学生'])
    expect(item.key).toBe('我是学生')
    expect(dropped.join('|')).toContain('uses a word not yet learned')
    expect(dropped.join('|')).toContain('duplicate')
  })

  it('refuses an alternative whose meaning words differ: no added or dropped 都, 很 versus 非常, 吗; only listed optional words and synonym swaps', () => {
    const c = curriculum()
    const ok = (zh: string, raw: object) => validateAccepted(c, { key: '', id: 1, zh, py: '', en: 'x', words: [], grammar: [], readyAt: 3 }, raw)
    const adds = ok('汉语很好。', { zhAlt: ['汉语都很好。', '汉语非常好。', '好很汉语。', '汉语很好', '很好，汉语。'] })
    expect(adds.item.zhAlt).toEqual(['好很汉语。', '很好，汉语。'])   // only reorderings stay
    expect(adds.dropped.join('|')).toContain('adds 都')
    expect(adds.dropped.join('|')).toMatch(/汉语非常好。: changes the meaning words \(drops 很, adds 非常\)/)
    expect(ok('你是学生吗？', { zhAlt: ['你是学生。', '你是学生吗？', '你学生是吗？'] }).item.zhAlt).toEqual(['你学生是吗？'])   // dropping 吗 changes the meaning
    expect(ok('汉语不好。', { zhAlt: ['汉语好。'] }).item.zhAlt).toEqual([])
    // a listed synonym swap is accepted (the checker confirms it is a true synonym); a swap that does not match the texts is not
    const swapped = ok('汉语很好。', { zhAlt: [{ zh: '汉语非常好。', swaps: [['很', '非常']] }, { zh: '汉语非常好吧。', swaps: [['很', '非常']] }, { zh: '汉语非常好。', swaps: [['好', '非常']] }] })
    expect(swapped.item.zhAlt).toEqual(['汉语非常好。'])
    expect(swapped.zhSwaps).toEqual([[['很', '非常']]])
    // a listed optional word may be added or dropped
    expect(ok('我是学生。', { zhAlt: ['我学生。'], optional: ['是'] }).item.zhAlt).toEqual(['我学生。'])
    expect(ok('我是学生。', { zhAlt: ['我学生。'] }).item.zhAlt).toEqual([])
  })

  it('validates an exchange: words, voices, 2-3 distinct wrong replies, grammar tags', () => {
    const c = curriculum(), allowed = allowedAt(c, 2)
    const { item } = validateExchange(c, allowed, exchange(), 2)
    expect(item.q.py).toBe('nǐ shì xué sheng ma')
    expect(item.grammar).toEqual(['g-shi'])
    expect(item.readyAt).toBe(2)
    expect(item.wrong).toHaveLength(2)
    expect(item.words).toContain('ls')
    expect(validateExchange(c, allowed, exchange({ wrong: [{ zh: '我是老师。', en: 'x' }] }), 2).reason).toMatch(/fewer than 2/)
    expect(validateExchange(c, allowed, exchange({ wrong: [{ zh: '我是学生。', en: 'x' }, { zh: '我是老师。', en: 'x' }, { zh: '我是老师。', en: 'x' }] }), 2).reason).toMatch(/fewer than 2/)
    expect(validateExchange(c, allowed, exchange({ q: { zh: '你是学生吗？', en: 'Q', speaker: 'child' } }), 2).reason).toMatch(/speaker/)
    expect(validateExchange(c, allowed, exchange({ a: { zh: '我学习汉语。', en: 'A', speaker: 'male' } }), 2).reason).toMatch(/not yet learned/)
    expect(validateExchange(c, allowedAt(c, 1), exchange(), 1).reason).toMatch(/not yet learned|fewer/)
    expect(validateExchange(c, allowed, exchange({ a: { zh: '你是学生吗', en: 'A', speaker: 'male' } }), 2).reason).toMatch(/repeats/)
  })

  it('validates a conversation: 4-8 lines, 2-3 voiced speakers, two questions with exactly one right option', () => {
    const c = curriculum(), allowed = allowedAt(c, 4)
    const ok = validateConversation(c, allowed, conversation(), 4).item
    expect(ok.speakers).toEqual([{ name: '王老师', speaker: 'female' }, { name: '小明', speaker: 'male' }])
    expect(ok.lines).toHaveLength(4)
    const reason = (extra: object) => validateConversation(c, allowed, conversation(extra), 4).reason
    expect(reason({ lines: conversation().lines.slice(0, 3) })).toMatch(/4 to 8/)
    expect(reason({ lines: [...conversation().lines, ...conversation().lines, line('a', 'male', '好。', 'ok')] })).toMatch(/4 to 8/)
    expect(reason({ lines: conversation().lines.map(entry => ({ ...entry, name: '王老师', speaker: 'female' })) })).toMatch(/2 or 3 speakers/)
    expect(reason({ lines: conversation().lines.map((entry, at) => at === 3 ? { ...entry, speaker: 'female' } : entry) })).toMatch(/both female and male/)
    expect(reason({ questions: [conversation().questions[0]] })).toMatch(/2 or 3/)
    expect(reason({ questions: [...conversation().questions, ...conversation().questions] })).toMatch(/2 or 3/)
    expect(validateConversation(c, allowed, conversation({ questions: [...conversation().questions, { q: "What is the student's name?", options: ['Xiao Ming', 'Xiao Hong', 'Xiao Hua'], answer: 0 }] }), 4).item.questions).toHaveLength(3)
    for (const name of ['Xiaoming', '同学', '老师', 'Ming', '小', '小明小明小', '王 老师']) expect(reason({ lines: conversation().lines.map((entry, at) => at % 2 ? entry : { ...entry, name }) })).toMatch(/Chinese person name|both female/)
    expect(speakerNameOk('小红')).toBe(true); expect(speakerNameOk('李老师')).toBe(true); expect(speakerNameOk('同学')).toBe(false)

    expect(reason({ questions: [{ ...conversation().questions[0], answer: 3 }, conversation().questions[1]] })).toMatch(/exactly one option/)
    expect(reason({ questions: [{ ...conversation().questions[0], answer: [0, 1] }, conversation().questions[1]] })).toMatch(/exactly one option/)
    expect(reason({ questions: [{ ...conversation().questions[0], options: ['A student', 'a  student!', 'A doctor'] }, conversation().questions[1]] })).toMatch(/different options/)
    expect(reason({ questions: [{ ...conversation().questions[0], options: ['学生', 'B', 'C'] }, conversation().questions[1]] })).toMatch(/English/)
    expect(reason({ questions: [conversation().questions[0], conversation().questions[0]] })).toMatch(/same/)
    expect(validateConversation(c, allowedAt(c, 1), conversation(), 1).reason).toMatch(/not yet learned/)
  })

  it('speaker names are known for their own conversation: in lines (addressing 小明) and, as the English form, in questions and options', () => {
    const c = curriculum(), allowed = allowedAt(c, 5)
    const lines = [...conversation().lines.slice(0, 3), line('小明', 'male', '王老师，我叫小明。', 'Teacher Wang, I am Xiao Ming.')]
    const found = validateConversation(c, allowed, conversation({ lines, questions: [{ q: 'What does 小明 say?', options: ['He is called 小明', 'He is a doctor', 'He is 王老师'], answer: 0 }, conversation().questions[1]] }), 5)
    expect(found.reason).toBeUndefined()
    expect(found.item.questions[0]).toEqual({ q: 'What does Xiao Ming say?', options: ['He is called Xiao Ming', 'He is a doctor', 'He is Teacher Wang'], answer: 0 })
    expect(found.item.lines[3]).toMatchObject({ zh: '王老师，我叫小明。', py: 'wáng lǎo shī wǒ jiào xiǎo míng' })
    // a name that is not listed, or listed without pinyin of the right length, is refused; other unknown words still are
    expect(validateConversation(c, allowed, conversation({ lines: [...lines.slice(0, 3), line('小明', 'male', '小红，你好。', 'x')] }), 5).reason).toMatch(/not yet learned/)
    expect(validateConversation(c, allowed, conversation({ speakers: [{ name: '王老师', py: 'wang', en: 'Teacher Wang' }, { name: '小明', py: 'xiǎo míng', en: 'Xiao Ming' }] }), 5).reason).toMatch(/one syllable per character/)
    expect(validateConversation(c, allowed, conversation({ speakers: undefined }), 5).reason).toMatch(/not listed/)
  })

  it('counts the reasons of invalid items and checker rejections per kind and logs them', async () => {
    const ctx = ctxOf({ lessons: { from: 3, to: 3 } })
    const logs: string[] = []
    const io = fakeIO({ write: () => ({ items: [exchange({ wrong: [{ zh: '我是老师。', en: 'x' }] }), exchange({ a: { zh: '我学习汉语。', en: 'A', speaker: 'male' } })] }), check: () => ({ items: [] }) })
    const stats = await runKind({ kind: 'exchanges', ctx, io, log: message => logs.push(message) })
    expect(stats.reasons).toMatchObject({ 'fewer than 2 usable wrong replies': 1 })
    expect(Object.values(stats.reasons).reduce((sum: number, n) => sum + (n as number), 0)).toBe(stats.invalid + stats.rejected)
    expect(logs.join('\n')).toContain('fewer than 2 usable wrong replies')
  })

  it('exchanges: the writer is shown the earlier questions and the lesson\'s new words', async () => {
    const ctx = ctxOf({ lessons: { from: 2, to: 2 } })
    ctx.state.exchanges.old = { band: '1', id: 'old', lesson: 1, q: { zh: '你叫什么名字？' }, a: { zh: '我叫小明。' }, wrong: [] }
    let prompt = ''
    await runKind({ kind: 'exchanges', ctx, io: fakeIO({ write: user => { prompt = user; return { items: [] } }, check: () => ({ items: [] }) }) })
    expect(prompt).toContain('你叫什么名字？')
    expect(prompt).toMatch(/introduced in lesson 2 are: .*吗/)
  })

  it('offers each conversation 2-3 names from the pool, deterministic by unit, and the prompt names them with genders', async () => {
    expect(NAME_POOL.length).toBeGreaterThanOrEqual(20)
    expect(NAME_POOL.every(([name]) => speakerNameOk(name))).toBe(true)
    expect(new Set(NAME_POOL.map(([name]) => name)).size).toBe(NAME_POOL.length)
    expect(NAME_POOL.some(([name]) => name.endsWith('老师'))).toBe(true); expect(NAME_POOL.some(([name]) => name.endsWith('医生'))).toBe(true)
    expect(new Set(NAME_POOL.map(item => item[3]))).toEqual(new Set(['female', 'male']))
    const used = new Set<string>()
    for (let lesson = 1; lesson <= 40; lesson++) for (const slot of [0, 1]) {
      const names = namesFor('conversations:' + lesson, slot)
      expect(names.length).toBeGreaterThanOrEqual(2); expect(names.length).toBeLessThanOrEqual(3)
      expect(new Set(names.map(item => item.name)).size).toBe(names.length)
      expect(namesFor('conversations:' + lesson, slot)).toEqual(names)
      names.forEach(item => used.add(item.name))
    }
    expect(used.size).toBeGreaterThan(12)   // not always 小明 and 小红
    // Every unit id finishes (a step sharing a factor with the pool size once cycled through 2 names forever when 3 were wanted).
    for (let lesson = 1; lesson <= 3000; lesson++) for (const slot of [0, 1, 2]) expect(new Set(namesFor('conversations:' + lesson, slot).map(item => item.name)).size).toBeGreaterThanOrEqual(2)
    const ctx = ctxOf({ lessons: { from: 5, to: 5 } })
    let prompt = ''
    await runKind({ kind: 'conversations', ctx, io: fakeIO({ write: user => { prompt = user; return { conversations: [] } }, check: () => ({ items: [] }) }) })
    for (const item of [...namesFor('conversations:5', 0), ...namesFor('conversations:5', 1)]) expect(prompt).toContain(item.name + ' (' + item.en + ', ' + item.speaker + ')')
  })

  it('validates near misses: only the given phrases, never a bank phrase, within the phrase\'s words', () => {
    const c = curriculum()
    const phrases = BANK.map((entry, at) => ({ ...entry, key: entry.zh.replace(/[^\p{Script=Han}]/gu, ''), pid: 'p' + (at + 1) })).slice(0, 2)
    const entry = { point: c.grammar.get('g-shi'), phrases }
    const bankKeys = new Set(BANK.map(item => item.zh.replace(/[^\p{Script=Han}]/gu, '')))
    const { point, dropped } = validateGrammarPoint(c, entry, {
      note: 'Use 是 between two nouns to say that one is the other; it is not used before adjectives.',
      items: [{ phrase: 'p1', wrong: '我学生是。', kind: 'order', why: '是 goes between subject and noun.' }, { phrase: 'p9', wrong: '我是。', why: 'x' }, { phrase: 'p1', wrong: '我是学生。', why: 'same' }, { phrase: 'p1', wrong: '你是老师吗？', why: 'a bank phrase' }, { phrase: 'p1', wrong: '我是汉语。', why: 'word not learned yet' }, { phrase: 'p1', wrong: '我学生是。', why: 'dup' }, { phrase: 'p2', wrong: '你老师是吗？', kind: 'bogus', why: 'order' }],
    }, { bankKeys })
    expect(point.items.map(item => item.wrong)).toEqual(['我学生是。', '你老师是吗？'])
    expect(point.items[1].kind).toBe('other')
    expect(point.items[0]).toMatchObject({ ref: 'g-shi', phrase: '我是学生', zh: '我是学生。', readyAt: 1, wrongPy: 'wǒ xué sheng shì' })
    expect(point.note).toContain('between two nouns')
    expect(dropped).toHaveLength(5)
  })

  it('spreads near-miss sources over the phrase lengths', () => {
    const phrases = Array.from({ length: 20 }, (_, at) => ({ id: at, zh: '我'.repeat(at + 1) }))
    const picked = spread(phrases, 4)
    expect(picked.map(item => item.zh.length)).toEqual([1, 6, 11, 16])
    expect(spread(phrases.slice(0, 3), 4)).toHaveLength(3)
  })
})

/** A writer and checker that answer from canned replies; the checker approves everything unless a verdict function says otherwise. */
function fakeIO({ write, check }: { write: (user: string) => unknown; check: (user: string) => unknown }) {
  const calls = { write: 0, check: 0 }
  return { calls, write: async (_s: string, user: string) => { calls.write++; return JSON.stringify(write(user)) }, check: async (_s: string, user: string) => { calls.check++; return JSON.stringify(check(user)) } }
}
const ctxOf = (extra = {}, state = emptyState()) => { const bank = BANK.map(entry => ({ band: '1', ...entry, key: entry.zh.replace(/[^\p{Script=Han}]/gu, '') })); return { curriculum: curriculum(), state, options: options(extra), bank, bankKeys: new Set(bank.map(entry => entry.key)) } }

describe('kinds', () => {
  it('accepted: batches phrases by readiness, the checker strikes bad alternatives, empty answers still count as done', async () => {
    const ctx = ctxOf()
    const io = fakeIO({
      write: user => ({ items: idsIn(user.split('Phrases:')[1]).map(id => ({ id, zhAlt: id === 'k1' ? ['学生是我。', '我学生是。'] : [], enAlt: id === 'k1' ? ['I\'m a student.'] : [], optional: [] })) }),
      check: user => ({ items: idsIn(user).map(id => ({ id, badZh: [1], badEn: [], badOptional: [] })) }),
    })
    const stats = await runKind({ kind: 'accepted', ctx, io })
    expect(stats).toMatchObject({ units: 2, failed: 0, kept: 3 })   // phrase 3's alternatives with 学生 change its meaning words: refused by code
    expect(io.calls).toEqual({ write: 2, check: 2 })
    expect(ctx.state.accepted['我是学生']).toMatchObject({ band: '1', zhAlt: ['学生是我。'], enAlt: ["I'm a student."] })
    expect(Object.keys(ctx.state.accepted)).toHaveLength(3)
    // a second run has nothing to do
    const again = fakeIO({ write: () => { throw new Error('no call expected') }, check: () => ({}) })
    expect(await runKind({ kind: 'accepted', ctx, io: again })).toMatchObject({ units: 0, failed: 0 })
    expect(again.calls.write).toBe(0)
    const output = buildOutputs(ctx.state, 'out')
    const file = JSON.parse(output.get(join('out', 'accepted-hsk-1.json')) as string)
    expect(file.items).toHaveLength(2)   // phrases with no alternatives are not shipped
    expect(acceptedFileSchema.parse(file).items[0].key).toBe('我是学生')
  })

  it('exchanges: the checker drops misfits and wrong replies that could be right; duplicates across lessons are removed', async () => {
    const ctx = ctxOf({ lessons: { from: 4, to: 5 } })
    const second = { q: { zh: '你叫什么名字？', en: 'What is your name?', speaker: 'male' }, a: { zh: '我叫小明。', en: 'I am Xiao Ming.', speaker: 'female' }, wrong: [{ zh: '我是老师。', en: 'I am a teacher.' }, { zh: '你好。', en: 'Hello.' }, { zh: '我学习汉语。', en: 'I study Chinese.' }] }
    const io = fakeIO({ write: user => ({ items: user.includes('lesson 5') ? [exchange(), second] : [exchange()] }), check: user => blindVerdict(user, ['我是学生。', '我叫小明。', '我学习汉语。']) })
    const stats = await runKind({ kind: 'exchanges', ctx, io })
    expect(stats).toMatchObject({ units: 2, failed: 0 })
    expect(Object.keys(ctx.state.exchanges)).toHaveLength(2)
    expect(stats.duplicates).toBe(1)
    const kept = Object.values(ctx.state.exchanges) as { q: { zh: string }; wrong: unknown[] }[]
    expect(kept.find(item => item.q.zh === '你叫什么名字？')?.wrong).toHaveLength(2)
    // misfit: the checker says the reply does not fit
    const bad = ctxOf({ lessons: { from: 3, to: 3 } })
    await runKind({ kind: 'exchanges', ctx: bad, io: fakeIO({ write: () => ({ items: [exchange()] }), check: user => blindVerdict(user, ['我是学生。'], { questionNatural: false }) }) })
    expect(Object.keys(bad.state.exchanges)).toHaveLength(0)
    expect(bad.state.done['exchanges:3'].status).toBe('done')
    for (const item of Object.values(ctx.state.exchanges)) expect(exchangesFileSchema.parse({ schemaVersion: 1, kind: 'exchanges', band: '1', items: [Object.fromEntries(Object.entries(item as object).filter(([key]) => key !== 'band'))] }).items).toHaveLength(1)
  })

  it('exchanges: the checker judges each reply blind; a wrong reply that is a possible answer is dropped, an unnatural question or an invalid right reply drops the exchange', async () => {
    const seen: string[] = []
    const run = async (valid: string[], extra: Record<string, unknown> = {}) => {
      const ctx = ctxOf({ lessons: { from: 3, to: 3 } })
      const stats = await runKind({ kind: 'exchanges', ctx, io: fakeIO({ write: () => ({ items: [exchange()] }), check: user => { seen.push(user); return blindVerdict(user, valid, extra) } }) })
      return { ctx, stats }
    }
    // 我是老师。 is also a possible answer to a yes/no question about being a student: dropped, and with only one wrong reply left the exchange goes
    const same = await run(['我是学生。', '我是老师。'])
    expect(Object.keys(same.ctx.state.exchanges)).toHaveLength(0)
    expect(same.stats.rejected).toBeGreaterThan(0)
    // with three wrong replies one valid answer among them is removed and two are left
    const three = ctxOf({ lessons: { from: 4, to: 4 } })
    await runKind({ kind: 'exchanges', ctx: three, io: fakeIO({ write: () => ({ items: [exchange({ wrong: [{ zh: '我是老师。', en: 'x' }, { zh: '你好。', en: 'Hello.' }, { zh: '我学习汉语。', en: 'y' }] })] }), check: user => blindVerdict(user, ['我是学生。', '我是老师。']) }) })
    const kept = Object.values(three.state.exchanges) as { wrong: { zh: string }[] }[]
    expect(kept[0].wrong.map(item => item.zh).sort()).toEqual(['你好。', '我学习汉语。'].sort())
    // the right reply is not a possible answer / the question is not natural / the text is unnatural
    expect(Object.keys((await run([])).ctx.state.exchanges)).toHaveLength(0)
    expect(Object.keys((await run(['我是学生。'], { questionNatural: false })).ctx.state.exchanges)).toHaveLength(0)
    expect(Object.keys((await run(['我是学生。'], { natural: false })).ctx.state.exchanges)).toHaveLength(0)
    expect(Object.keys((await run(['我是学生。'])).ctx.state.exchanges)).toHaveLength(1)
    // blind: the prompt shows the question and every reply in one list and never which is right; the order does not depend on the writer's order
    expect(seen[0]).not.toMatch(/"right"|"wrong"|"a":|"answer"/)
    const item = { id: 'x1', a: { zh: 'A' }, wrong: [{ zh: 'B' }, { zh: 'C' }, { zh: 'D' }] }
    expect(blindReplies(item).map((reply: { line: { zh: string } }) => reply.line.zh).sort()).toEqual(['A', 'B', 'C', 'D'])
    const zhOf = (value: typeof item) => blindReplies(value).map((reply: { line: { zh: string } }) => reply.line.zh)
    expect(zhOf(item)).toEqual(zhOf({ ...item, wrong: [...item.wrong].reverse() }))
  })

  it('grammar: note and near misses per point, the checker keeps only the really wrong ones', async () => {
    const ctx = ctxOf()
    const io = fakeIO({
      write: user => ({ points: [{ ref: 'g-shi', note: 'Use 是 between two nouns to say that one is the other; no 是 before adjectives.', items: [{ phrase: 'p1', wrong: '我学生是。', kind: 'order', why: 'Word order: 是 goes between.' }, { phrase: 'p2', wrong: '你老师是吗？', kind: 'order', why: 'Word order.' }] }], user }),
      check: () => ({ points: [{ ref: 'g-shi', noteOk: true, items: list => list }].map(row => ({ ref: row.ref, noteOk: true, items: [{ id: 'x', wrongOk: true, whyOk: true }] })) }),
    })
    // the checker names items by id: answer from the prompt
    io.check = async (_s: string, user: string) => { io.calls.check++; return JSON.stringify({ points: [{ ref: 'g-shi', noteOk: true, items: idsIn(user).map((id, at) => ({ id, wrongOk: at === 0, whyOk: true })) }] }) }
    const stats = await runKind({ kind: 'grammar', ctx, io })
    expect(stats).toMatchObject({ units: 1, kept: 1, rejected: 1 })
    expect(ctx.state.grammar['g-shi'].items).toHaveLength(1)
    const file = JSON.parse(buildOutputs(ctx.state, 'out').get(join('out', 'grammar-hsk-1.json')) as string)
    expect(grammarFileSchema.parse(file).items[0].note).toContain('between two nouns')
  })

  it('conversations: --conv-target tops each lesson up in rounds and tells the writer what already exists', async () => {
    const ctx = ctxOf({ lessons: { from: 5, to: 5 }, convTarget: 2 })
    let prompt = ''
    const io = () => fakeIO({ write: user => { prompt = user; return { conversations: [conversation()] } }, check: user => ({ items: idsIn(user).map(id => ({ id, natural: true, consistent: [[0], [0]] })) }) })
    await runKind({ kind: 'conversations', ctx, io: io() })
    expect(Object.keys(ctx.state.done)).toEqual(['conversations:5+1'])
    expect(Object.keys(ctx.state.conversations)).toHaveLength(1)
    // one ready by lesson 5 and the target is 2: another round, whose prompt names the one already written
    expect(KIND_SPECS.conversations.plan(ctx).map(unit => unit.id)).toEqual(['conversations:5+2'])
    await runKind({ kind: 'conversations', ctx, io: io() })
    expect(prompt).toContain('already exist')
    // a target that is met plans nothing
    expect(KIND_SPECS.conversations.plan({ ...ctx, options: options({ lessons: { from: 5, to: 5 }, convTarget: 1 }) })).toEqual([])
  })

  it('conversations: skipped without a call when the words cannot support one; the blind checker must find the one right answer', async () => {
    const few = ctxOf({ minVocab: 100 })
    const idle = fakeIO({ write: () => { throw new Error('no call expected') }, check: () => ({}) })
    expect(await runKind({ kind: 'conversations', ctx: few, io: idle })).toMatchObject({ units: 0, failed: 0 })
    expect(idle.calls.write).toBe(0)
    expect(few.state.done['conversations:5'].status).toBe('skipped')
    // lowering --min-vocab plans the skipped lesson again
    expect(KIND_SPECS.conversations.plan({ ...few, options: options({ minVocab: 3 }) }).length).toBe(5)

    const ctx = ctxOf({ lessons: { from: 5, to: 5 } })
    const io = fakeIO({ write: () => ({ conversations: [conversation()] }), check: user => ({ items: idsIn(user).map(id => ({ id, natural: true, consistent: [[0], [0]] })) }) })
    expect(await runKind({ kind: 'conversations', ctx, io })).toMatchObject({ units: 1, kept: 1 })
    expect(Object.keys(ctx.state.conversations)).toHaveLength(1)
    expect(conversationsFileSchema.parse(JSON.parse(buildOutputs(ctx.state, 'out').get(join('out', 'conversations-hsk-1.json')) as string)).items[0].speakers).toHaveLength(2)

    // the checker picks another option (or finds none right): the conversation is dropped
    for (const picked of [[[1], [0]], [[0], []], [[0, 1], [0]], [[0], [0, 2]]]) {
      const c2 = ctxOf({ lessons: { from: 5, to: 5 } })
      const stats = await runKind({ kind: 'conversations', ctx: c2, io: fakeIO({ write: () => ({ conversations: [conversation()] }), check: user => ({ items: idsIn(user).map(id => ({ id, natural: true, consistent: picked })) }) }) })
      expect(stats.rejected).toBeGreaterThan(0)
      expect(Object.keys(c2.state.conversations)).toHaveLength(0)
    }
    // three questions written: the one with two consistent options is dropped, the other two stay
    const three = ctxOf({ lessons: { from: 5, to: 5 } })
    const extra = { q: 'Where are they?', options: ['In the room', 'Outside', 'At school'], answer: 0 }
    await runKind({ kind: 'conversations', ctx: three, io: fakeIO({ write: () => ({ conversations: [conversation({ questions: [...conversation().questions, extra] })] }), check: user => ({ items: idsIn(user).map(id => ({ id, natural: true, consistent: [[0], [0, 1], [0]] })) }) }) })
    const stored = Object.values(three.state.conversations) as { questions: { q: string }[] }[]
    expect(stored[0].questions.map(question => question.q)).toEqual(['What is Xiao Ming?', 'Where are they?'])
    // an unnatural conversation is dropped; a pinyin speaker name never reaches the checker
    const odd = ctxOf({ lessons: { from: 5, to: 5 } })
    await runKind({ kind: 'conversations', ctx: odd, io: fakeIO({ write: () => ({ conversations: [conversation()] }), check: user => ({ items: idsIn(user).map(id => ({ id, natural: false, consistent: [[0], [0]] })) }) }) })
    expect(Object.keys(odd.state.conversations)).toHaveLength(0)
    const pinyin = ctxOf({ lessons: { from: 5, to: 5 } })
    const stats2 = await runKind({ kind: 'conversations', ctx: pinyin, io: fakeIO({ write: () => ({ conversations: [conversation({ lines: conversation().lines.map(entry => ({ ...entry, name: entry.name === '小明' ? 'Xiaoming' : entry.name })) })] }), check: () => ({ items: [] }) }) })
    expect(stats2.invalid).toBe(1)

    // "none" is a good answer: nothing kept, unit done
    const none = ctxOf({ lessons: { from: 5, to: 5 } })
    const quiet = fakeIO({ write: () => ({ conversations: [] }), check: () => { throw new Error('no check expected') } })
    expect(await runKind({ kind: 'conversations', ctx: none, io: quiet })).toMatchObject({ units: 1, kept: 0 })
    expect(none.state.done['conversations:5'].status).toBe('done')
  })

  it('a failed model call leaves the unit for the next run; a bad reply is retried once', async () => {
    const ctx = ctxOf({ lessons: { from: 3, to: 3 } })
    let writes = 0
    const io = { write: async () => { writes++; if (writes === 1) return 'not json at all'; return JSON.stringify({ items: [exchange()] }) }, check: async (_s: string, user: string) => JSON.stringify(blindVerdict(user, ['我是学生。'])) }
    expect(await runKind({ kind: 'exchanges', ctx, io })).toMatchObject({ units: 1, failed: 0, kept: 1 })
    expect(writes).toBe(2)
    const down = ctxOf({ lessons: { from: 3, to: 3 } })
    const broken = { write: async () => { throw new Error('Model call failed (responses luna): HTTP 500') }, check: async () => '{}' }
    expect(await runKind({ kind: 'exchanges', ctx: down, io: broken })).toMatchObject({ units: 0, failed: 1 })
    expect(down.state.done['exchanges:3']).toBeUndefined()
  })

  it('runs at most --concurrency units at once', async () => {
    let now = 0, peak = 0
    await pool(Array.from({ length: 20 }, (_, at) => at), 5, async () => { now++; peak = Math.max(peak, now); await new Promise(done => setTimeout(done, 2)); now-- })
    expect(peak).toBe(5)
    expect(parseArgs([], {}).concurrency).toBe(32)
    expect(parseArgs(['--concurrency', '7'], {}).concurrency).toBe(7)
  })
})

describe('the command', () => {
  const run = (dir: string, extra: string[], io: ReturnType<typeof fakeIO>) => main(['--out', join(dir, 'out'), '--state', join(dir, 'state.json'), '--phrases-dir', bankDirOf(dir), '--data-dir', dataDirOf(dir), '--save-interval', '0', '--concurrency', '3', '--min-vocab', '3', ...extra], { io: io as never, log: () => {} })
  const bankDirOf = (dir: string) => { mkdirSync(join(dir, 'bank'), { recursive: true }); writeFileSync(join(dir, 'bank', 'hsk-1.json'), JSON.stringify({ phrases: BANK })); return join(dir, 'bank') }
  const dataDirOf = (dir: string) => { mkdirSync(join(dir, 'data'), { recursive: true }); FIXTURE.forEach(band => writeFileSync(join(dir, 'data', 'hsk-' + band.band + '.generated.json'), JSON.stringify(band))); return join(dir, 'data') }
  const exchangeIO = () => fakeIO({ write: () => ({ items: [exchange()] }), check: user => blindVerdict(user, ['我是学生。']) })

  it('resumes mid-pass: only the units not done are called, from the state file or from the band files alone', async () => {
    const dir = tmp()
    const first = exchangeIO()
    await run(dir, ['--kind', 'exchanges', '--limit', '2'], first)
    expect(first.calls.write).toBe(2)
    expect(loadState(join(dir, 'state.json')).done).toMatchObject({ 'exchanges:1': { status: 'done' }, 'exchanges:2': { status: 'done' } })
    const second = exchangeIO()
    await run(dir, ['--kind', 'exchanges'], second)
    expect(second.calls.write).toBe(3)   // lessons 3-5 of 5
    const third = exchangeIO()
    await run(dir, ['--kind', 'exchanges'], third)
    expect(third.calls.write).toBe(0)
    // lost state file: the lessons that kept something are known from the band files
    rmSync(join(dir, 'state.json'))
    const lost = exchangeIO()
    await run(dir, ['--kind', 'exchanges'], lost)
    expect(lost.calls.write).toBeLessThanOrEqual(4)
    expect(lost.calls.write).toBeLessThan(5)
    // --redo ignores the markers
    const redo = exchangeIO()
    await run(dir, ['--kind', 'exchanges', '--redo', '--lessons', '3-4'], redo)
    expect(redo.calls.write).toBe(2)
  })

  it('writes the band files and an index with counts that the loaders accept; bands and kinds can be selected', async () => {
    const dir = tmp()
    await run(dir, ['--kind', 'exchanges,accepted', '--band', '1', '--lessons', '3-3'], exchangeIO())
    const names = readdirSync(join(dir, 'out')).sort()
    expect(names).toContain('index.json'); expect(names).toContain('exchanges-hsk-1.json'); expect(names).toContain('conversations-hsk-6.json')
    const index = practiceIndexSchema.parse(JSON.parse(readFileSync(join(dir, 'out', 'index.json'), 'utf8')))
    expect(index.bands['1'].exchanges).toBe(1)
    expect(index.totals.exchanges).toBe(1)
    // a band with no selection stays empty and untouched
    const none = exchangeIO()
    await run(dir, ['--kind', 'exchanges', '--band', '2'], none)
    expect(none.calls.write).toBe(0)
    const data = createPracticeData({ exchanges: exchangesFileSchema.parse(JSON.parse(readFileSync(join(dir, 'out', 'exchanges-hsk-1.json'), 'utf8'))).items })
    expect(data.exchangesForWord('vocabulary:ni', 5)).toHaveLength(1)
    expect(data.exchangesForWord('ni', 1)).toHaveLength(0)
  })

  it('reports units and model calls per kind and band without calling anything', () => {
    const report = planReport(ctxOf())
    expect(report.accepted['1']).toEqual({ units: 2, calls: 4 })
    expect(report.exchanges['1']).toEqual({ units: 5, calls: 10 })
    expect(report.grammar['1']).toEqual({ units: 1, calls: 2 })
    expect(readBank(bankDir())).toHaveLength(3)
  })

  it('hydrate and the saver write only changed files', () => {
    const state = emptyState()
    const writes: string[] = []
    const save = createSaver({ state, options: { state: join(tmp(), 's.json'), out: 'out' }, interval: 0, write: file => writes.push(file) })
    save(); const first = writes.length
    save()
    expect(writes.length).toBe(first)
    state.exchanges.x1 = { band: '1', id: 'x1', lesson: 2, readyAt: 0 }
    save()
    expect(writes.length).toBeGreaterThan(first)
    const fresh = emptyState()
    expect(hydrate(fresh, tmp())).toBeUndefined()
  })
})
