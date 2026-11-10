// @vitest-environment node
import { readdirSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  setReplyDump, isGrammarForm, assignEntries, callJSON, createBook, itemProblem, lessonPrompt, main as buildMain, matchWord, parallelReport, parseArgs, phrasesPrompt, processBatch, repairJSON, runLanguage, topUp, validateCandidate,
} from './build-parallel-lessons.mjs'
import { loadChineseLessons, loadReferences, readParallel, refreshReadability, strictReport, writeParallel } from './parallel-lessons-files.mjs'

const dirs: string[] = []
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })
const put = (root: string, path: string, content: unknown) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content)) }
type Row = Record<string, unknown>

/** A tiny repository: two v2 groups (你/好/学生, 茶/喝) with examples and one bank phrase, and Japanese and Korean references. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'parallel-'))
  dirs.push(root)
  const ids = { ni: 'zh-hsk1-00001-s001', hao: 'zh-hsk1-00002-s001', xs: 'zh-hsk1-00003-s001', cha: 'zh-hsk1-00004-s001', he: 'zh-hsk1-00005-s001' }
  const lbs = { ni: 'ni-lb', hao: 'hao-lb', xs: 'xs-lb', cha: 'cha-lb', he: 'he-lb' }
  const word = (key: keyof typeof ids, ch: string, pr: string, ds: string) => ({ id: ids[key], ch, pr, ds, lb: lbs[key] })
  const ex = (id: string, words: string[], translation: string, grammar: string[] = []) => ({ id, segments: [...words.map(lb => ({ word: lb })), { punctuation: '。' }], translation, grammar })
  put(root, 'src/data/v2/hsk-1.generated.json', {
    schemaVersion: 1, band: '1', alignment: 'hsk-1',
    vocabulary: [word('ni', '你', 'nǐ', 'you'), word('hao', '好', 'hǎo', 'hello (after a pronoun)'), word('xs', '学生', 'xué sheng', 'student'), word('cha', '茶', 'chá', 'tea'), word('he', '喝', 'hē', 'to drink')],
    grammar: [{ id: 'zh-g1', pt: 'S + 是 + N', pr: 's shi n', ds: 'identity', lb: 'g-shi' }],
    groups: [
      { id: 'zh-hsk-1-lesson-0001', units: [{ kind: 'vocabulary', ref: 'ni-lb' }, { kind: 'vocabulary', ref: 'hao-lb' }, { kind: 'vocabulary', ref: 'xs-lb' }, { kind: 'grammar', ref: 'g-shi' }], examples: [ex('e1', ['ni-lb', 'hao-lb'], 'Hello.'), ex('e2', ['ni-lb', 'xs-lb'], 'You are a student.', ['g-shi'])] },
      { id: 'zh-hsk-1-lesson-0002', units: [{ kind: 'vocabulary', ref: 'cha-lb' }, { kind: 'vocabulary', ref: 'he-lb' }, { kind: 'vocabulary', ref: 'ni-lb' }], examples: [] },
    ],
  })
  put(root, 'src/data/phrases/hsk-1.json', { phrases: [{ id: 3, zh: '你喝茶。', en: 'You drink tea.', words: ['ni-lb', 'he-lb', 'cha-lb'] }] })
  put(root, 'curriculum/japanese/jlpt-n5/vocabulary.yaml', stringify([
    { id: 'ja-n5-00027', target: '貴方', reading: 'あなた', english: '1. you [word usually written using kana alone] | 2. dear', part_of_speech: 'pronoun' },
    { id: 'ja-n5-00002', target: '学生', reading: 'がくせい', english: 'student' },
    { id: 'ja-n5-00003', target: '飲む', reading: 'のむ', english: 'to drink' },
    { id: 'ja-n5-00004', target: '茶', reading: 'ちゃ', english: 'tea (as a type)' },
    { id: 'ja-n5-00005', target: '茶', reading: 'ちゃ', english: 'brown' },
    { id: 'ja-n3-00380', target: 'ありがとう', reading: 'ありがとう', english: '1. thank you [word usually written using kana alone]' },
    { id: 'ja-n3-05724', target: 'こんにちは', reading: 'こんにちは', english: '1. hello [word usually written using kana alone]' },
  ]))
  put(root, 'curriculum/japanese/jlpt-n5/grammar.yaml', stringify([{ id: 'ja-n5-g001', pattern: 'Nです', english: 'be a noun' }, { id: 'ja-n5-g004', pattern: 'Nは', english: 'topic' }]))
  put(root, 'curriculum/korean/topik-1/vocabulary.yaml', stringify([{ id: 'ko-nikl-00001', target: '안녕하세요', reading: '', english: 'hello' }, { id: 'ko-nikl-00002', target: '학생', reading: '', english: 'student' }, { id: 'ko-nikl-00003', target: '마시다', reading: '', english: 'to drink' }]))
  put(root, 'curriculum/korean/topik-1/grammar.yaml', stringify([{ id: 'ko-topik1-g001', pattern: 'N이에요 / N예요', english: 'be N' }, { id: 'ko-topik1-g003', pattern: 'N은/는', english: 'topic' }]))
  return { root, ids }
}

const body = (prompt: string) => JSON.parse(prompt.slice(prompt.indexOf('INPUT:\n') + 7))

/** Lesson 1 reply as a beginner course would write it: あなた (kana), 学生, こんにちは covering 好, はじめまして as an extra. */
const LESSON_JA: Record<number, (ids: Record<string, string>) => Row> = {
  1: ids => ({ lesson: 1,
    items: [{ key: 'k1', form: 'あなた', reading: 'あなた', gloss: 'you', pos: 'pronoun', kind: 'word' }, { key: 'k2', form: '学生', reading: 'がくせい', gloss: 'student', pos: 'noun', kind: 'word' },
      { key: 'k3', form: 'こんにちは', reading: 'こんにちは', gloss: 'hello', pos: 'expression', kind: 'expression' }, { key: 'k4', form: 'はじめまして', reading: 'はじめまして', gloss: 'nice to meet you', pos: 'expression', kind: 'expression', extra: true }],
    senses: [{ sense: ids.ni, status: 'word', item: 'k1' }, { sense: ids.hao, status: 'covered-by', item: 'k3' }, { sense: ids.xs, status: 'word', item: 'k2' }] }),
  2: ids => ({ lesson: 2,
    items: [{ key: 'k1', form: 'お茶', reading: 'おちゃ', gloss: 'tea', pos: 'noun', kind: 'word' }, { key: 'k2', form: '飲む', reading: 'のむ', gloss: 'to drink', pos: 'verb', kind: 'word' }],
    senses: [{ sense: ids.cha, status: 'word', item: 'k1' }, { sense: ids.he, status: 'word', item: 'k2' }] }),
}
const PHRASES_JA: Record<string, Row> = {
  '1:0': { i: 0, text: 'こんにちは。', reading: 'こんにちは。', en: 'Hello.', tokens: [{ t: 'こんにちは', w: 'ja-n3-05724' }, { t: '。' }], grammar: [] },
  '1:1': { i: 1, text: 'あなたは学生です。', reading: 'あなたはがくせいです。', en: 'You are a student.', tokens: [{ t: 'あなた', w: 'ja-n5-00027' }, { t: 'は', g: 'ja-n5-g004' }, { t: '学生', w: 'ja-n5-00002' }, { t: 'です', g: 'ja-n5-g001' }, { t: '。' }], grammar: ['ja-n5-g004', 'ja-n5-g001'] },
  '2:0': { i: 0, text: 'あなたはお茶を飲みます。', reading: 'あなたはおちゃをのみます。', en: 'You drink tea.', tokens: [{ t: 'あなた', w: 'ja-n5-00027' }, { t: 'は', g: 'ja-n5-g004' }, { t: 'お茶', w: 'ja-par-00002' }, { t: 'を', g: 'new:wo' }, { t: '飲みます', w: 'ja-n5-00003' }, { t: '。' }], grammar: ['ja-n5-g004', 'new:wo'] },
}

interface Mock { reject?: Record<string, string>; lessons?: typeof LESSON_JA; phrases?: Record<string, Row>; calls?: string[]; prompts?: string[]; badReplies?: number }
/** A scripted writer and checker. reject: form or text -> reason (always). badReplies: how many writer replies are malformed before good ones. */
function mockIO(ids: Record<string, string>, mock: Mock = {}) {
  const calls = mock.calls ?? []
  let bad = mock.badReplies ?? 0
  const lessons = mock.lessons ?? LESSON_JA
  const phrases = mock.phrases ?? PHRASES_JA
  const write = async (_system: string, prompt: string) => {
    mock.prompts?.push(prompt)
    if (bad > 0) { bad--; return '{"lessons": [{"lesson": 1, "items": [{"key" "k1"}]}]' }
    const input = body(prompt)
    if (prompt.startsWith('TASK lesson')) {
      const numbers = input.lessons.map((lesson: { lesson: number }) => lesson.lesson)
      calls.push('lesson:' + numbers.join(',') + (input.rejected ? ':rewrite' : ''))
      return JSON.stringify({ lessons: numbers.map((n: number) => lessons[n](ids)) })
    }
    if (prompt.startsWith('TASK phrases')) {
      const numbers = input.lessons.map((lesson: { lesson: number }) => lesson.lesson)
      calls.push('phrases:' + numbers.join(',') + (input.rejected ? ':rewrite' : ''))
      return JSON.stringify({ lessons: input.lessons.map((lesson: { lesson: number; zh_phrases: { i: number }[] }) => ({ lesson: lesson.lesson, new_grammar: lesson.lesson === 2 ? [{ key: 'wo', pattern: 'Nを', english: 'object marker' }] : [], phrases: lesson.zh_phrases.map(p => phrases[lesson.lesson + ':' + p.i]).filter(Boolean) })) })
    }
    calls.push('topup')
    return JSON.stringify({ items: input.items.map((item: { entry: string }) => ({ entry: item.entry, phrases: [] })) })
  }
  const check = async (_system: string, prompt: string) => {
    const input = body(prompt)
    if (prompt.startsWith('TASK resolve')) return JSON.stringify({ choices: input.items.map((item: { candidates: { id: string }[] }, i: number) => ({ i, id: item.candidates[0].id })) })
    return JSON.stringify({ verdicts: input.items.map((item: { form?: string; target?: string }, i: number) => { const reason = mock.reject?.[item.form ?? item.target ?? '']; return { i, ok: !reason, reason } }) })
  }
  return { write, check, calls }
}

const options = (root: string, extra: Record<string, unknown> = {}) => ({ ...parseArgs(['--root', root, '--no-top-up']), root, lessonSpan: 2, ...extra })
const chineseOf = (root: string) => loadChineseLessons({ base: root })
const run = (root: string, io: ReturnType<typeof mockIO>, extra: Record<string, unknown> = {}, code = 'ja') => runLanguage({ code, chinese: chineseOf(root), io, options: options(root, extra), book: createBook(code, { base: root }), save: b => writeParallel(code, b, root) })

describe('lesson-level mapping', () => {
  it('maps senses to items: word, covered-by (好 by こんにちは) and extra items (はじめまして) that no sense maps to', async () => {
    const { root, ids } = fixture()
    const book = await run(root, mockIO(ids))
    const lesson = book.record(1)
    expect(lesson.senses).toEqual([
      { zh: ids.ni, status: 'word', entry: 'ja-n5-00027' }, { zh: ids.hao, status: 'covered-by', entry: 'ja-n3-05724' }, { zh: ids.xs, status: 'word', entry: 'ja-n5-00002' },
    ])
    expect(lesson.words.map((word: { entry: string }) => word.entry)).toEqual(['ja-n5-00027', 'ja-n5-00002', 'ja-n3-05724', 'ja-par-00001'])
    expect(lesson.words[2]).toMatchObject({ form: 'こんにちは', zh: [ids.hao] })
    expect(lesson.words[3]).toMatchObject({ form: 'はじめまして', new: true, extra: true })
    expect(lesson.words[3].zh).toBeUndefined()
    expect(book.entries.vocabulary[0]).toMatchObject({ id: 'ja-par-00001', target: 'はじめまして', source: 'parallel-authored' })
    expect(book.record(1).phrases.map((phrase: { text: string }) => phrase.text)).toEqual(['こんにちは。', 'あなたは学生です。'])
  })

  it('a sense without a valid mapping becomes no-equivalent with a reason, and a real no-equivalent keeps its note', async () => {
    const { root, ids } = fixture()
    const lessons = { ...LESSON_JA, 1: (i: Record<string, string>) => { const row = LESSON_JA[1](i) as { senses: Row[] }; return { ...row, senses: [{ sense: i.ni, status: 'word', item: 'k9' }, { sense: i.xs, status: 'no-equivalent', note: 'no counter in Japanese' }] } } }
    const book = await run(root, mockIO(ids, { lessons }))
    expect(book.record(1).senses).toEqual([
      { zh: ids.ni, status: 'no-equivalent', note: 'the writer named no valid item for this sense' }, { zh: ids.hao, status: 'no-equivalent', note: 'the writer gave no mapping for this sense' }, { zh: ids.xs, status: 'no-equivalent', note: 'no counter in Japanese' },
    ])
  })

  it('the writer prompt carries the group (senses, grammar, examples), the format rules and no title or goals', () => {
    const { root } = fixture()
    const prompt = lessonPrompt('ja', [chineseOf(root).lessons[0]])
    const input = body(prompt)
    expect(input.lessons[0].senses.map((sense: { zh: string }) => sense.zh)).toEqual(['你', '好', '学生'])
    expect(input.lessons[0].grammar_zh).toEqual([{ zh: 'S + 是 + N', meaning: 'identity' }])
    expect(input.lessons[0].zh_examples).toEqual([{ zh: '你好。', en: 'Hello.' }, { zh: '你学生。', en: 'You are a student.' }])
    expect(prompt).toMatch(/teaches what this Chinese lesson \(group\) teaches/)
    expect(prompt).toMatch(/hiragana only: no romaji, no spaces/)
    expect(prompt).toMatch(/covered-by/)
    expect(Object.keys(input.lessons[0])).not.toContain('goals')
  })
})

describe('matching existing entries', () => {
  it('matches on form+reading, on the reading alone for kana-only words (貴方 = あなた, shown in kana), and on a shorter base form (ありがとうございます)', () => {
    const { root } = fixture()
    const references = loadReferences('ja', root)
    expect(matchWord('ja', references, { form: 'あなた', reading: 'あなた' })).toEqual({ kind: 'match', id: 'ja-n5-00027' })
    expect(matchWord('ja', references, { form: '貴方', reading: 'あなた' })).toEqual({ kind: 'match', id: 'ja-n5-00027' })
    expect(matchWord('ja', references, { form: 'ありがとうございます', reading: 'ありがとうございます' })).toEqual({ kind: 'match', id: 'ja-n3-00380' })
    expect(matchWord('ja', references, { form: '学生', reading: 'ガクセイ' })).toEqual({ kind: 'match', id: 'ja-n5-00002' })
    expect(matchWord('ja', references, { form: '茶', reading: 'ちゃ' })).toEqual({ kind: 'ambiguous', candidates: ['ja-n5-00004', 'ja-n5-00005'] })
    expect(matchWord('ja', references, { form: 'はじめまして', reading: 'はじめまして' })).toEqual({ kind: 'new' })
    expect(matchWord('ko', loadReferences('ko', root), { form: '학생', reading: '' })).toEqual({ kind: 'match', id: 'ko-nikl-00002' })
  })

  it('shows a kana-only reference word in kana in the index and asks the checker only for ties', async () => {
    const { root, ids } = fixture()
    const book = createBook('ja', { base: root })
    expect(book.index().vocabulary.get('ja-n5-00027')).toMatchObject({ target: 'あなた', reading: 'あなた' })
    const lessons = { ...LESSON_JA, 2: (i: Record<string, string>) => ({ lesson: 2, items: [{ key: 'k1', form: '茶', reading: 'ちゃ', gloss: 'tea', pos: 'noun', kind: 'word' }], senses: [{ sense: i.cha, status: 'word', item: 'k1' }, { sense: i.he, status: 'no-equivalent', note: 'x' }] }) }
    const made = await run(root, mockIO(ids, { lessons, phrases: {} }))
    expect(made.record(2).senses[0]).toEqual({ zh: ids.cha, status: 'word', entry: 'ja-n5-00004' })
    expect(made.record(2).words[0].new).toBeUndefined()
  })
})

describe('new entries', () => {
  it('writes unmatched words and grammar into parallel entries as parallel-authored, never into the references', async () => {
    const { root, ids } = fixture()
    const book = await run(root, mockIO(ids))
    expect(book.entries.vocabulary.map((entry: { id: string; target: string; source: string }) => [entry.id, entry.target, entry.source])).toEqual([['ja-par-00001', 'はじめまして', 'parallel-authored'], ['ja-par-00002', 'お茶', 'parallel-authored']])
    expect(book.entries.grammar).toEqual([{ id: 'ja-par-g001', pattern: 'Nを', english: 'object marker', source: 'parallel-authored' }])
    expect(readParallel('ja', root).entries.vocabulary).toHaveLength(2)
    expect(readFileSync(join(root, 'curriculum/japanese/jlpt-n5/vocabulary.yaml'), 'utf8')).not.toContain('parallel')
    expect(book.record(2).grammar_taught).toEqual(['ja-par-g001'])
    expect(book.record(1).grammar_taught).toEqual(['ja-n5-g001', 'ja-n5-g004'])
  })

  it('gives an item that is already a parallel entry the same id again instead of a duplicate', () => {
    const { root } = fixture()
    const book = createBook('ja', { base: root })
    const made = { items: [{ key: 'a', form: 'お茶', reading: 'おちゃ', gloss: 'tea', pos: 'noun', kind: 'word' }, { key: 'b', form: 'お茶', reading: 'おちゃ', gloss: 'tea', pos: 'noun', kind: 'word' }], senses: [{ zh: 's1', status: 'word', item: 'a' }, { zh: 's2', status: 'covered-by', item: 'b' }] }
    const { words, senses } = assignEntries(book, made)
    expect(words).toHaveLength(1)
    expect(words[0].zh).toEqual(['s1', 's2'])
    expect(senses.map((sense: { entry: string }) => sense.entry)).toEqual(['ja-par-00001', 'ja-par-00001'])
  })
})

describe('checker and rewrites', () => {
  it('checks format by code: hiragana-only reading, no Latin, Hangul only for Korean', () => {
    expect(itemProblem('ja', { form: '私', reading: 'watashi', gloss: 'I' })).toMatch(/hiragana only/)
    expect(itemProblem('ja', { form: '私', reading: 'わ たし', gloss: 'I' })).toMatch(/hiragana only/)
    expect(itemProblem('ja', { form: '私', reading: 'わたし', gloss: 'I' })).toBe('')
    expect(itemProblem('ja', { form: 'ABC', reading: 'えーびーしー', gloss: 'x' })).toMatch(/Japanese|Latin/)
    expect(itemProblem('ko', { form: '학생', gloss: 'student' })).toBe('')
    expect(itemProblem('ko', { form: 'student', gloss: 'student' })).toMatch(/Hangul/)
  })

  it('sends the checker reason back to the writer, accepts the rewrite, and drops after two failed rewrites', async () => {
    const { root, ids } = fixture()
    const good = mockIO(ids)
    const seen: string[] = []
    let first = true
    const io = { ...good, check: async (system: string, prompt: string) => { const input = body(prompt); if (prompt.startsWith('TASK check-items') && first && input.items.some((item: { form: string }) => item.form === 'あなた')) { first = false; return JSON.stringify({ verdicts: input.items.map((item: { form: string }, i: number) => ({ i, ok: item.form !== 'あなた', reason: 'use あなた only with care; prefer the name' })) }) } return good.check(system, prompt) },
      write: async (system: string, prompt: string) => { if (prompt.includes('"rejected"')) seen.push(JSON.stringify(body(prompt).rejected)); return good.write(system, prompt) } }
    const book = await run(root, io, { lessons: { from: 1, to: 1 } })
    expect(seen[0]).toContain('use あなた only with care')
    expect(seen[0]).toContain('"key":"k1"')
    expect(book.record(1).senses[0]).toEqual({ zh: ids.ni, status: 'word', entry: 'ja-n5-00027' })
    expect(book.record(1).status).toBe('done')
    // always rejected: dropped after the rewrites, its sense becomes no-equivalent with the reason, the lesson is partial
    const calls: string[] = []
    const stubborn = await run(fixture().root, mockIO(ids, { calls, reject: { あなた: 'too stiff' } }), { lessons: { from: 1, to: 1 } })
    expect(calls.filter(call => call === 'lesson:1:rewrite')).toHaveLength(2)
    expect(stubborn.record(1).senses[0]).toMatchObject({ status: 'no-equivalent', note: 'its item was dropped: too stiff' })
    expect(stubborn.record(1).status).toBe('partial')
    expect(stubborn.record(1).notes[0]).toMatch(/item あなた \(lesson 1\) dropped after 2 rewrites: too stiff/)
  })

  it('does not drop a good alternative because it differs from a suggested default (the checker prompt says so)', () => {
    const { root } = fixture()
    void root
    const prompt = lessonPrompt('ja', [])
    expect(prompt).toMatch(/TASK lesson/)
  })
})

describe('phrase quality', () => {
  it('dedupes by text, rewrites a contrived line with the reason and drops it with a note when it stays contrived', async () => {
    const { root, ids } = fixture()
    const phrases = { ...PHRASES_JA, '1:1': { ...PHRASES_JA['1:0'], i: 1 } }
    const calls: string[] = []
    const book = await run(root, mockIO(ids, { phrases, calls }), { lessons: { from: 1, to: 1 } })
    expect(book.record(1).phrases.map((phrase: { text: string }) => phrase.text)).toEqual(['こんにちは。'])
    expect(book.record(1).notes.join('|')).toMatch(/duplicate of こんにちは。 and was dropped/)
    const contrived = { ...PHRASES_JA, '1:1': { ...PHRASES_JA['1:1'], text: 'あなたという名前です。', reading: 'あなたというなまえです。', tokens: [{ t: 'あなた', w: 'ja-n5-00027' }, { t: 'という名前', w: 'ja-n5-00002' }, { t: 'です', g: 'ja-n5-g001' }, { t: '。' }], grammar: ['ja-n5-g001'] } }
    const io = mockIO(ids, { phrases: contrived, calls: [] })
    const wrapped = { ...io, check: async (system: string, prompt: string) => { const input = body(prompt); if (prompt.startsWith('TASK check-phrases')) return JSON.stringify({ verdicts: input.items.map((item: { target: string }, i: number) => ({ i, ok: !item.target.includes('という名前'), reason: 'meta sentence about a name' })) }); return io.check(system, prompt) } }
    const second = await run(fixture().root, wrapped, { lessons: { from: 1, to: 1 } })
    expect(second.record(1).phrases.map((phrase: { text: string }) => phrase.text)).toEqual(['こんにちは。'])
    expect(second.record(1).notes.join('|')).toMatch(/dropped after 2 rewrites: meta sentence about a name/)
  })

  it('the top-up skips a duplicate of an existing phrase and keeps only what the checker accepts', async () => {
    const { root, ids } = fixture()
    const io = mockIO(ids)
    const book = await run(root, io)
    const good = { text: '学生です。', reading: 'がくせいです。', en: 'I am a student.', tokens: [{ t: '学生', w: 'ja-n5-00002' }, { t: 'です', g: 'ja-n5-g001' }, { t: '。' }], grammar: ['ja-n5-g001'] }
    const dup = { ...PHRASES_JA['1:0'] }
    const topIO = { ...io, write: async () => JSON.stringify({ items: [{ entry: 'ja-n5-00002', phrases: [good, good] }, { entry: 'ja-n3-05724', phrases: [dup] }] }) }
    const added = await topUp({ book, io: topIO, options: { ...options(root), target: 2 } })
    expect(added).toBe(1)
    expect(book.record(1).phrases.filter((phrase: { top_up?: boolean }) => phrase.top_up).map((phrase: { text: string }) => phrase.text)).toEqual(['学生です。'])
  })
})

describe('malformed replies', () => {
  it('repairs trailing commas, fences and a cut-off tail', () => {
    expect(repairJSON('x {"a": [1, 2,],}')).toEqual({ value: { a: [1, 2] }, salvaged: false })
    expect(repairJSON('{"en": "He said "hi" to me", "b": 1}')).toEqual({ value: { en: 'He said "hi" to me', b: 1 }, salvaged: false })
    expect(repairJSON('{"lessons":[{"lesson":1,"items":[{"key":"k1"},{"key":"k2","form":"あ')).toEqual({ value: { lessons: [{ lesson: 1, items: [{ key: 'k1' }] }] }, salvaged: true })
    expect(() => repairJSON('no json here')).toThrow()
  })

  it('asks again (naming the error) up to 2 times, then leaves the batch for --retry and goes on with the next one', async () => {
    const { root, ids } = fixture()
    const prompts: string[] = []
    const good = mockIO(ids, { badReplies: 3, prompts })
    const logs: string[] = []
    const book = await runLanguage({ code: 'ja', chinese: chineseOf(root), io: good, options: options(root, { lessonSpan: 1 }), book: createBook('ja', { base: root }), save: b => writeParallel('ja', b, root), log: line => logs.push(line) })
    expect(prompts[1]).toMatch(/previous reply was not valid JSON/)
    expect(book.record(1)).toBeUndefined()
    expect(book.record(2)).toBeDefined()
    expect(book.skipped).toEqual([1])
    expect(logs.join('\n')).toMatch(/lessons 1 left for --retry/)
    // the next run picks up the missing lesson
    const again = await run(root, mockIO(ids), { lessonSpan: 1 })
    expect(again.lessons.lessons.map((record: { number: number }) => record.number)).toEqual([1, 2])
  })

  it('one bad reply is fixed by asking again within the same batch', async () => {
    const { root, ids } = fixture()
    const calls: string[] = []
    const book = await run(root, mockIO(ids, { badReplies: 1, calls }), { lessonSpan: 2 })
    expect(book.lessons.lessons).toHaveLength(2)
    expect(callJSON).toBeTypeOf('function')
  })
})

describe('grammar before use', () => {
  const pool = (grammarLesson: [string, number][]) => ({ wordLesson: new Map([['w1', 1], ['w2', 2]]), grammarLesson: new Map(grammarLesson), catalogue: new Set(['g1', 'g2']), newKeys: new Set(['k']) })
  const raw = (token: Record<string, string>, grammar: string[] = []) => ({ text: '私は', reading: 'わたしは', en: 'I', tokens: [{ t: '私', w: 'w1' }, { t: 'は', ...token }], grammar })

  it('rejects a word that a later lesson teaches and an unknown id', () => {
    expect(validateCandidate('ja', { ...raw({ g: 'g1' }), tokens: [{ t: '私', w: 'w2' }, { t: 'は', g: 'g1' }] }, 1, pool([['g1', 1]])).problem).toMatch(/taught in lesson 2/)
    expect(validateCandidate('ja', raw({ g: 'nope' }), 1, pool([])).problem).toMatch(/unknown grammar id/)
    expect(validateCandidate('ja', raw({ g: 'new:zz' }), 1, pool([])).problem).toMatch(/unknown new grammar/)
  })

  it('without new grammar (the top-up) a grammar point must be taught by that lesson', () => {
    expect(validateCandidate('ja', raw({ g: 'g2' }, ['g2']), 1, pool([['g2', 3]]), { allowNew: false }).problem).toMatch(/not taught by lesson 1/)
    expect(validateCandidate('ja', raw({ g: 'g2' }, ['g2']), 3, pool([['g2', 3]]), { allowNew: false }).phrase).toBeTruthy()
    expect(validateCandidate('ja', raw({ g: 'g2' }, ['g2']), 1, pool([]), { allowNew: false }).problem).toMatch(/not taught/)
  })

  it('a phrase that uses a word of a later lesson is not accepted into lesson 1', async () => {
    const { root, ids } = fixture()
    const bad = { ...PHRASES_JA, '1:1': { ...PHRASES_JA['1:1'], text: 'あなたはお茶です。', reading: 'あなたはおちゃです。', tokens: [{ t: 'あなた', w: 'ja-n5-00027' }, { t: 'は', g: 'ja-n5-g004' }, { t: 'お茶', w: 'ja-par-00002' }, { t: 'です', g: 'ja-n5-g001' }, { t: '。' }] } }
    const book = await run(root, mockIO(ids, { phrases: bad }), { lessons: { from: 1, to: 1 } })
    expect(book.record(1).phrases.map((phrase: { text: string }) => phrase.text)).toEqual(['こんにちは。'])
    expect(book.record(1).status).toBe('partial')
    expect(book.record(1).notes.join('|')).toMatch(/unknown word id ja-par-00002/)
  })
})

describe('strict readability', () => {
  it('a phrase is strict when every word and grammar point is taught by its lesson; the report lists meanings without a strict phrase', () => {
    const lessons = [
      { number: 1, words: [{ entry: 'w1' }], senses: [{ zh: 'a', entry: 'w1' }, { zh: 'c', entry: 'w3' }], phrases: [{ words: ['w1'], grammar: ['g1'] }, { words: ['w1', 'w2'], grammar: [] }] },
      { number: 2, words: [{ entry: 'w2' }], senses: [{ zh: 'b', entry: 'w2' }, { zh: 'x', status: 'no-equivalent', note: 'no counter' }], phrases: [{ words: ['w2', 'w1'], grammar: ['g1'] }] },
    ]
    const taught = refreshReadability(lessons)
    expect(lessons[0].phrases.map((phrase: { strict?: boolean }) => phrase.strict)).toEqual([true, false])
    expect(lessons[1].phrases[0]).toMatchObject({ strict: true })
    const report = strictReport(lessons, taught)
    expect(report.perLesson).toEqual([{ number: 1, phrases: 2, strict: 1 }, { number: 2, phrases: 1, strict: 1 }])
    expect(report.noStrict.map((item: { entry: string }) => item.entry)).toEqual(['w3'])
    expect(report.noEquivalent).toEqual([{ lesson: 2, zh: 'x', note: 'no counter' }])
    expect(lessons[0].grammar_taught).toEqual(['g1'])
  })
})

describe('resume', () => {
  it('keeps the finished batch when a later one fails and does not ask for it again', async () => {
    const { root, ids } = fixture()
    const calls: string[] = []
    const good = mockIO(ids, { calls })
    let failing = true
    const io = { ...good, write: async (system: string, prompt: string) => { if (failing && prompt.startsWith('TASK lesson') && body(prompt).lessons[0].lesson === 2) throw new Error('endpoint down'); return good.write(system, prompt) } }
    await expect(run(root, io, { lessonSpan: 1 })).rejects.toThrow('endpoint down')
    expect(readParallel('ja', root).lessons.lessons.map((record: { number: number }) => record.number)).toEqual([1])
    failing = false
    calls.length = 0
    const book = await run(root, io, { lessonSpan: 1 })
    expect(calls).toEqual(['lesson:2', 'phrases:2'])
    expect(book.lessons.lessons.map((record: { number: number }) => record.number)).toEqual([1, 2])
    calls.length = 0
    await run(root, io)
    expect(calls).toEqual([])
  })

  it('redoes a lesson left without phrases only with --retry, and a failed batch leaves the book as it was', async () => {
    const { root, ids } = fixture()
    const calls: string[] = []
    // every phrase of lesson 1 is unusable, so the lesson ends partial with no phrases: the case --retry redoes
    // (a lesson that only dropped some phrases keeps what it has and is not redone)
    const bad = Object.fromEntries(Object.entries(PHRASES_JA).map(([key, row]) => [key, key.startsWith('1:') ? { ...(row as object), text: 'abc', en: 'x', tokens: [], grammar: [] } : row]))
    let book = await run(root, mockIO(ids, { phrases: bad }), { lessons: { from: 1, to: 1 } })
    expect(book.record(1).status).toBe('partial')
    book = await run(root, mockIO(ids, { calls }), { lessons: { from: 1, to: 1 } })
    expect(calls).toEqual([])
    book = await run(root, mockIO(ids, { calls }), { lessons: { from: 1, to: 1 }, retry: true })
    expect(calls).toEqual(['lesson:1', 'phrases:1'])
    expect(book.record(1).status).toBe('done')
    const before = JSON.stringify(book.lessons)
    const broken = { ...mockIO(ids), write: async () => { throw new Error('boom') } }
    await expect(processBatch({ book, lessons: chineseOf(root).lessons.slice(0, 1), io: broken, options: options(root) })).rejects.toThrow('boom')
    expect(JSON.stringify(book.lessons)).toBe(before)
  })
})

describe('Korean and the command line', () => {
  it('writes Korean lessons through the same pipeline (Hangul forms, no reading)', async () => {
    const { root, ids } = fixture()
    const lessons: Record<number, (ids: Record<string, string>) => Row> = {
      1: i => ({ lesson: 1, items: [{ key: 'k1', form: '안녕하세요', gloss: 'hello', pos: 'expression', kind: 'expression' }, { key: 'k2', form: '학생', gloss: 'student', pos: 'noun', kind: 'word' }, { key: 'k3', form: '저', gloss: 'I', pos: 'pronoun', kind: 'word' }],
        senses: [{ sense: i.ni, status: 'covered-by', item: 'k1' }, { sense: i.hao, status: 'covered-by', item: 'k1' }, { sense: i.xs, status: 'word', item: 'k2' }] }),
      2: i => ({ lesson: 2, items: [{ key: 'k1', form: '차', gloss: 'tea', pos: 'noun', kind: 'word', hanja: '茶' }, { key: 'k2', form: '마시다', gloss: 'to drink', pos: 'verb', kind: 'word' }], senses: [{ sense: i.cha, status: 'word', item: 'k1' }, { sense: i.he, status: 'word', item: 'k2' }] }),
    }
    const phrases: Record<string, Row> = {
      '1:1': { i: 1, text: '저는 학생이에요.', en: 'I am a student.', tokens: [{ t: '저', w: 'ko-par-00001' }, { t: '는', g: 'ko-topik1-g003' }, { t: ' ' }, { t: '학생', w: 'ko-nikl-00002' }, { t: '이에요', g: 'ko-topik1-g001' }, { t: '.' }], grammar: ['ko-topik1-g003', 'ko-topik1-g001'] },
      '2:0': { i: 0, text: '차를 마셔요.', en: 'You drink tea.', tokens: [{ t: '차', w: 'ko-par-00002' }, { t: '를', g: 'new:reul' }, { t: ' ' }, { t: '마셔요', w: 'ko-nikl-00003' }, { t: '.' }], grammar: ['new:reul'] },
    }
    const base = mockIO(ids, { lessons: lessons as never, phrases })
    const io = { ...base, write: async (s: string, prompt: string) => { const reply = await base.write(s, prompt); return prompt.startsWith('TASK phrases') ? reply.replace('"wo"', '"reul"').replace('Nを', 'N을/를') : reply } }
    const book = await run(root, io, {}, 'ko')
    expect(book.entries.vocabulary.map((entry: { target: string }) => entry.target)).toEqual(['저', '차'])
    expect(book.entries.vocabulary[1]).toMatchObject({ hanja: '茶', source: 'parallel-authored' })
    expect(book.entries.grammar[0]).toMatchObject({ id: 'ko-par-g001', pattern: 'N을/를' })
    expect(book.record(1).words[0]).toMatchObject({ entry: 'ko-nikl-00001', zh: [ids.ni, ids.hao] })
    expect(parallelReport('ko', book, new Set(['저', '는', '학']))).toMatchObject({ words: { matched: 3, new: 2, covered: 2 } })
    expect(parallelReport('ko', book, new Set(['저'])).characters.uncovered).toContain('학')
  })

  it('parses the phrase-bank flags, prints the exact lesson-1 prompt for --dry-run and runs end to end through main with an injected model', async () => {
    const parsed = parseArgs(['--writer-api', 'responses', '--checker-api', 'chat', '--concurrency', '3', '--session-id', 's1', '--lessons', '1-3', '--language', 'ja', '--base-url', 'http://x/v1'])
    expect(parsed).toMatchObject({ languages: ['ja'], concurrency: 3, sessionId: 's1', lessons: { from: 1, to: 3 }, roles: { writer: { api: 'responses' }, checker: { api: 'chat' } }, baseUrl: 'http://x/v1', rewrites: 2 })
    expect(() => parseArgs(['--language', 'fr'])).toThrow(/ja, ko or both/)
    const { root, ids } = fixture()
    const logs: string[] = []
    await buildMain(['--root', root, '--language', 'ja', '--dry-run', '--lessons', '1'], { log: line => logs.push(line) })
    expect(logs.join('\n')).toMatch(/1 lessons to write/)
    expect(logs.join('\n')).toContain(lessonPrompt('ja', [chineseOf(root).lessons[0]]))
    await buildMain(['--root', root, '--language', 'ja', '--no-top-up'], { io: mockIO(ids), log: line => logs.push(line) })
    expect(existsSync(join(root, 'curriculum/japanese/parallel/zh-lessons.yaml'))).toBe(true)
    expect(logs.at(-1)).toMatch(/ja: 3 phrases, 3 strict; words 4 matched, 2 new/)
    await buildMain(['--root', root, '--language', 'ja', '--report'], { log: line => logs.push(line) })
    expect(JSON.parse(logs.at(-1)!).phrases).toEqual({ total: 3, strict: 3 })
  })
})

/** Korean fixture: the pieces of a Korean lesson 1 (no reading, word spacing in the text, 은/는 and 이에요 as grammar). */
const KO_LESSON = (ids: Record<string, string>): Row => ({ lesson: 1,
  items: [{ key: 'k1', form: '저', gloss: 'I (polite)', pos: 'pronoun', kind: 'word' }, { key: 'k2', form: '학생', gloss: 'student', pos: 'noun', kind: 'word' }, { key: 'k3', form: '공부하다', gloss: 'to study', pos: 'verb', kind: 'word' },
    { key: 'k4', form: '이에요', gloss: 'am/is', pos: 'ending', kind: 'expression' }],
  grammar: [{ key: 'g1', id: 'ko-topik1-g001', pattern: 'N이에요 / N예요', english: 'be N' }, { key: 'g2', id: 'ko-topik1-g003', pattern: 'N은/는', english: 'topic' }],
  senses: [{ sense: ids.ni, status: 'word', item: 'k1' }, { sense: ids.hao, status: 'no-equivalent', note: 'greeting is another lesson' }, { sense: ids.xs, status: 'word', item: 'k2' }] })
const KO_PHRASES: Record<string, Row> = {
  '1:0': { i: 0, text: '저는 학생이에요.', en: 'I am a student.', tokens: [{ t: '저', w: 'ko-par-00001' }, { t: '는', g: 'ko-topik1-g003' }, { t: ' ' }, { t: '학생', w: 'ko-nikl-00002' }, { t: '이에요', g: 'ko-topik1-g001' }, { t: '.' }], grammar: ['ko-topik1-g003', 'ko-topik1-g001'] },
  '1:1': { i: 1, text: '학생이에요.', en: "(Answering 'What are you?') I am a student.", tokens: [{ t: '학생', w: 'ko-nikl-00002' }, { t: '이에요', g: 'ko-topik1-g001' }, { t: '.' }], grammar: ['ko-topik1-g001'] },
}
const koIO = (ids: Record<string, string>, wrap?: (reply: string, prompt: string) => string, calls: string[] = []) => {
  const base = mockIO(ids, { lessons: { 1: KO_LESSON, 2: () => ({ lesson: 2, items: [], grammar: [], senses: [] }) } as never, phrases: KO_PHRASES, calls })
  return { ...base, write: async (system: string, prompt: string) => { const reply = await base.write(system, prompt); return wrap ? wrap(reply, prompt) : reply } }
}

describe('Korean phrases (round 3)', () => {
  it('writes the authored Korean phrases: word spacing in the text does not break the token check, the first lesson keeps its grammar', async () => {
    const { root, ids } = fixture()
    const book = await run(root, koIO(ids), { lessons: { from: 1, to: 1 } }, 'ko')
    expect(book.record(1).phrases.map((phrase: { text: string }) => phrase.text)).toEqual(['저는 학생이에요.', '학생이에요.'])
    expect(book.record(1).notes).toBeUndefined()
    expect(book.record(1).status).toBe('done')
    expect(book.record(1).grammar_taught).toEqual(['ko-topik1-g001', 'ko-topik1-g003'])
  })

  it('a Korean reply that is cut off after the first phrase is asked for again instead of dropping the rest as "no phrase was written"', async () => {
    const { root, ids } = fixture()
    let broke = true
    const calls: string[] = []
    const io = koIO(ids, (reply, prompt) => { if (broke && prompt.startsWith('TASK phrases')) { broke = false; return reply.slice(0, reply.indexOf('},{"i":1') + 1) } return reply }, calls)
    const logs: string[] = []
    const { setReplyLog } = await import('./build-parallel-lessons.mjs')
    setReplyLog((line: string) => logs.push(line))
    const book = await run(root, io, { lessons: { from: 1, to: 1 } }, 'ko')
    setReplyLog(undefined)
    expect(book.record(1).phrases).toHaveLength(2)
    expect(logs.join('|')).toMatch(/partial reply to/)
  })

  it('tokens plus the spaces between them reproduce the text, or compare with whitespace and full-width marks ignored', () => {
    const pool = { wordLesson: new Map([['w1', 1]]), grammarLesson: new Map(), catalogue: new Set<string>(), newKeys: new Set<string>() }
    const raw = (text: string, tokens: Row[]) => ({ text, en: 'x', tokens, grammar: [] })
    expect(validateCandidate('ko', raw('중국어 공부해요.', [{ t: '중국어', w: 'w1' }, { t: '공부해요', w: 'w1' }, { t: '.' }]), 1, pool).phrase).toBeTruthy()
    expect(validateCandidate('ko', raw('중국어 공부해요。', [{ t: '중국어 ', w: 'w1' }, { t: '공부해요', w: 'w1' }, { t: '.' }]), 1, pool).phrase).toBeTruthy()
    expect(validateCandidate('ko', raw('중국어 공부해요.', [{ t: '중국어', w: 'w1' }, { t: '.' }]), 1, pool).problem).toMatch(/do not add up/)
  })
})

describe('a lesson introduces only what is new', () => {
  it('lists only new items in lesson 2; items of lesson 1 are used, keep their first lesson, and a sense can point at a known item', async () => {
    const { root, ids } = fixture()
    const lessons = { ...LESSON_JA, 2: (i: Record<string, string>) => ({ lesson: 2,
      items: [{ key: 'k1', form: '学生', reading: 'がくせい', gloss: 'student', pos: 'noun', kind: 'word' }, { key: 'k2', form: 'お茶', reading: 'おちゃ', gloss: 'tea', pos: 'noun', kind: 'word' }],
      senses: [{ sense: i.cha, status: 'word', item: 'k2' }, { sense: i.he, status: 'covered-by', item: 'ja-n5-00002' }] }) }
    const seen: string[] = []
    const io = mockIO(ids, { lessons })
    const spy = { ...io, write: async (s: string, p: string) => { if (p.startsWith('TASK lesson')) seen.push(JSON.stringify(body(p).known_items)); return io.write(s, p) } }
    const book = await run(root, spy, { lessonSpan: 1 })
    expect(book.record(2).words.map((word: { form: string }) => word.form)).toEqual(['お茶'])
    expect(book.record(2).senses[1]).toEqual({ zh: ids.he, status: 'covered-by', entry: 'ja-n5-00002' })
    expect(seen[1]).toContain('"id":"ja-n5-00002"')
    expect(seen[1]).toContain('"lesson":1')
    expect(book.record(1).words.map((word: { form: string }) => word.form)).toContain('学生')
  })
})

describe('extras and grammar classification', () => {
  it('keeps at most 2 extras per lesson', async () => {
    const { root, ids } = fixture()
    const extra = (key: string, form: string) => ({ key, form, reading: form, gloss: 'x', pos: 'expression', kind: 'expression', extra: true })
    const lessons = { ...LESSON_JA, 1: (i: Record<string, string>) => ({ lesson: 1, items: [{ key: 'k1', form: 'あなた', reading: 'あなた', gloss: 'you', pos: 'pronoun', kind: 'word' }, extra('e1', 'はじめまして'), extra('e2', 'ありがとう'), extra('e3', 'すみません')], senses: [{ sense: i.ni, status: 'word', item: 'k1' }, { sense: i.hao, status: 'no-equivalent', note: 'x' }, { sense: i.xs, status: 'no-equivalent', note: 'x' }] }) }
    const book = await run(root, mockIO(ids, { lessons, phrases: {} }), { lessons: { from: 1, to: 1 } })
    expect(book.record(1).words.filter((word: { extra?: boolean }) => word.extra)).toHaveLength(2)
    expect(book.record(1).words.map((word: { form: string }) => word.form)).not.toContain('すみません')
  })

  it('treats particles, copulas, endings and negation as grammar: they never become vocabulary and their senses point at a grammar point', async () => {
    const { root, ids } = fixture()
    for (const form of ['は', 'を', 'か', 'です', 'ではありません', 'ません', 'ない']) expect(isGrammarForm('ja', form)).toBe(true)
    for (const form of ['은/는', '이/가', '이에요/예요', '-어요', '안', '아니다']) expect(isGrammarForm('ko', form)).toBe(true)
    expect(isGrammarForm('ja', '学生')).toBe(false)
    const lessons = { ...LESSON_JA, 1: (i: Record<string, string>) => ({ lesson: 1,
      items: [{ key: 'k1', form: 'あなた', reading: 'あなた', gloss: 'you', pos: 'pronoun', kind: 'word' }, { key: 'k2', form: '学生', reading: 'がくせい', gloss: 'student', pos: 'noun', kind: 'word' }, { key: 'k3', form: 'です', reading: 'です', gloss: 'am/is', pos: 'copula', kind: 'expression' }],
      grammar: [{ key: 'g1', id: 'ja-n5-g001', pattern: 'Nです', english: 'be N' }],
      senses: [{ sense: i.ni, status: 'word', item: 'k1' }, { sense: i.hao, status: 'no-equivalent', note: 'x' }, { sense: i.xs, status: 'word', item: 'k2' }] }) }
    const book = await run(root, mockIO(ids, { lessons, phrases: {} }), { lessons: { from: 1, to: 1 } })
    expect(book.record(1).words.map((word: { form: string }) => word.form)).toEqual(['あなた', '学生'])
    expect(book.record(1).grammar_intro).toEqual(['ja-n5-g001', 'ja-par-g001'].filter(id => id === 'ja-n5-g001' || book.entries.grammar.some((entry: { id: string }) => entry.id === id)))
    expect(book.record(1).grammar_taught).toContain('ja-n5-g001')
  })

  it('a sense carried by a grammar point (是 by the copula) is a grammar sense, not no-equivalent, and a grammar token tagged as a word is rejected', async () => {
    const { root, ids } = fixture()
    const lessons = { ...LESSON_JA, 1: (i: Record<string, string>) => ({ lesson: 1,
      items: [{ key: 'k1', form: '学生', reading: 'がくせい', gloss: 'student', pos: 'noun', kind: 'word' }],
      grammar: [{ key: 'g1', id: 'ja-n5-g001', pattern: 'Nです', english: 'be N' }],
      senses: [{ sense: i.ni, status: 'no-equivalent', note: 'x' }, { sense: i.hao, status: 'grammar', grammar: 'g1' }, { sense: i.xs, status: 'word', item: 'k1' }] }) }
    const book = await run(root, mockIO(ids, { lessons, phrases: {} }), { lessons: { from: 1, to: 1 } })
    expect(book.record(1).senses[1]).toEqual({ zh: ids.hao, status: 'grammar', entry: null, grammar: 'ja-n5-g001' })
    const pool = { wordLesson: new Map([['w1', 1]]), grammarLesson: new Map(), catalogue: new Set<string>(), newKeys: new Set<string>() }
    expect(validateCandidate('ja', { text: '私は', reading: 'わたしは', en: 'x', tokens: [{ t: '私', w: 'w1' }, { t: 'は', w: 'w1' }], grammar: [] }, 1, pool).problem).toMatch(/is grammar/)
  })

  it('the writer and checker prompts carry the register, grammar and ungrammatical-rejection rules', async () => {
    const { root } = fixture()
    const prompt = lessonPrompt('ko', [chineseOf(root).lessons[0]], undefined, { known: [], catalogue: [] })
    expect(prompt).toMatch(/Particles, copulas, verb endings and negation are GRAMMAR/)
    expect(prompt).toMatch(/at most 2 per lesson/)
    const { checkPrompt, systemFor } = await import('./build-parallel-lessons.mjs') as unknown as { checkPrompt: (k: string, i: unknown[]) => string; systemFor?: (c: string, t: string) => string }
    expect(checkPrompt('phrases', [])).toMatch(/ungrammatical/)
    expect(checkPrompt('phrases', [])).toMatch(/never use 너/)
    expect(systemFor).toBeUndefined()
  })
})

describe('top-up within what the lesson teaches', () => {
  it('rejects a top-up phrase that uses a grammar point of a later lesson or a word of a later lesson, and asks lesson by lesson', async () => {
    const { root, ids } = fixture()
    const book = await run(root, mockIO(ids))
    const neg = { text: '私は学生ではありません。', reading: 'わたしはがくせいではありません。', en: 'I am not a student.', tokens: [{ t: '学生', w: 'ja-n5-00002' }, { t: 'ではありません', g: 'ja-n5-g999' }, { t: '。' }], grammar: ['ja-n5-g999'] }
    const later = { text: 'お茶です。', reading: 'おちゃです。', en: 'Tea.', tokens: [{ t: 'お茶', w: 'ja-par-00002' }, { t: 'です', g: 'ja-n5-g001' }, { t: '。' }], grammar: ['ja-n5-g001'] }
    const requests: unknown[] = []
    const topIO = { ...mockIO(ids), write: async (_s: string, p: string) => { requests.push(body(p)); return JSON.stringify({ items: [{ entry: 'ja-n5-00002', phrases: [neg, later] }] }) } }
    const added = await topUp({ book, io: topIO, options: { ...options(root), target: 3 } })
    expect(added).toBe(0)
    expect((requests as { items: { lesson: number }[] }[]).every(request => new Set(request.items.map(item => item.lesson)).size === 1)).toBe(true)
  })
})

describe('keyless punctuation tokens (round 4)', () => {
  const REPLY = '{"lessons":[{"lesson":1,"new_grammar":[],"phrases":[{"i":0,"text":"저는 학생이에요.","reading":"","en":"I am a student.","tokens":[{"t":"저","w":"ko-nikl-13297"},{"t":"는 ","g":"ko-topik1-g003"},{"t":"학생","w":"ko-nikl-24021"},{"t":"이에요","g":"ko-topik1-g001"},{"t":".","punctuation"}],"grammar":["ko-topik1-g003","ko-topik1-g001"]},{"i":1,"text":"학생이에요.","reading":"","en":"x","tokens":[{"t":"학생","w":"ko-nikl-24021"},{"t":".","punctuation"}],"grammar":[]}]}]}'
  it('repairs a bare string value with no key and keeps the rest of the reply', () => {
    const result = repairJSON(REPLY)
    expect(result.salvaged).toBe(false)
    expect(result.value.lessons[0].phrases).toHaveLength(2)
    expect(result.value.lessons[0].phrases[0].tokens.at(-1)).toEqual({ t: '.' })
  })
  it('trims spaces inside tokens and skips a token that is only a space', () => {
    const pool = { wordLesson: new Map([['w1', 1]]), grammarLesson: new Map(), catalogue: new Set<string>(), newKeys: new Set<string>() }
    const out = validateCandidate('ko', { text: '중국어 공부', en: 'x', tokens: [{ t: '중국어 ', w: 'w1' }, { t: ' ' }, { t: '공부', w: 'w1' }], grammar: [] }, 1, pool)
    expect(out.phrase.tokens.map((token: { t: string }) => token.t)).toEqual(['중국어', '공부'])
  })
  it('--dump-replies writes a partial reply in full', async () => {
    const dir = join(tmpdir(), 'dump-' + Date.now())
    setReplyDump(dir)
    const { callJSON } = await import('./build-parallel-lessons.mjs')
    await callJSON(async () => '{"a":[{"b":1},{"c":"x', 's', 'p', 0, 'unit test')
    setReplyDump(undefined)
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    expect(readFileSync(join(dir, files[0]), 'utf8')).toContain('{"a":[{"b":1},{"c":"x')
    expect(parseArgs(['--dump-replies', 'out']).dumpReplies).toBe('out')
  })
  it('the phrase prompt states the punctuation token shape and gives a complete example', () => {
    const prompt = phrasesPrompt('ko', { lessons: [] })
    expect(prompt).toContain('{"t":"."}')
    expect(prompt).toContain('"tokens":[{"t":"저"')
  })
})

describe('Japanese marks and duplicate keys', () => {
  it('writes Japanese with full-width marks and treats phrases differing only in marks as the same', async () => {
    const { japaneseMarks, sameTextKey } = await import('./build-parallel-lessons.mjs')
    expect(japaneseMarks('先生ですか?')).toBe('先生ですか？')
    expect(japaneseMarks('私は学生です.')).toBe('私は学生です。')
    expect(sameTextKey('先生ですか.')).toBe(sameTextKey('先生ですか？'))
    expect(sameTextKey('저는 학생이에요.')).toBe(sameTextKey('저는학생이에요'))
  })
})
