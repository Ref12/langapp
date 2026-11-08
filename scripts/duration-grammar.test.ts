// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FALLBACK_TARGET, addPhrase, applyGrammar, buildCurriculum, createIO, emptyState, passReport, phrasesForWord, selectWords, strictHistogram, targetOf, wordsInScope, parseArgs, runPipeline, readyAtOf,
} from './build-phrase-bank.mjs'
import { DURATION_LE_REF, DURATION_REF, durationRefs, withDurationGrammar } from './duration-grammar.mjs'
import { retagPhrases, retagPractice } from './retag-durations.mjs'

const word = (lb: string, ch: string, pr: string, ds: string) => ({ id: lb, ch, pr, ds, lb })
const unit = (ref: string) => ({ kind: 'vocabulary', ref })
const gunit = (ref: string) => ({ kind: 'grammar', ref })
const example = (id: string, words: string[], translation: string, grammar: string[] = []) => ({ id, segments: [...words.map(ref => ({ word: ref })), { punctuation: '。' }], translation, grammar })
const VOCAB = [
  word('wo', '我', 'wǒ', 'I; me'), word('xx', '休息', 'xiū xi', 'to rest'), word('wu', '五', 'wǔ', 'five'), word('fz', '分钟', 'fēn zhōng', 'minute'),
  word('zhu', '住', 'zhù', 'to live; reside'), word('san', '三', 'sān', 'three'), word('tian', '天', 'tiān', 'day'), word('wan', '玩', 'wán', 'to play'),
  word('you', '有', 'yǒu', 'to have'), word('nian', '年', 'nián', 'year'), word('le', '了', 'le', 'particle'), word('hou', '后', 'hòu', 'after'), word('di', '第', 'dì', 'ordinal'),
]
const grammarRecord = (lb: string) => ({ id: lb, pt: lb, pr: lb, ds: lb, lb, ex: { segments: [{ word: 'wo' }], translation: 'x', grammar: [lb] } })
const FIXTURE = [{
  schemaVersion: 1, band: '1', alignment: 'hsk-1', vocabulary: VOCAB, grammar: [grammarRecord(DURATION_REF), grammarRecord('s-vp')],
  groups: [
    { id: 'g1', units: [unit('wo'), unit('xx'), unit('wu'), unit('fz'), gunit('s-vp')], examples: [example('e1', ['wo', 'xx'], 'I rest.')] },
    { id: 'g2', units: [gunit(DURATION_REF), unit('zhu'), unit('san'), unit('tian')], examples: [example('e2', ['wo', 'zhu', 'san', 'tian'], 'I stay three days.', [DURATION_REF])] },
    { id: 'g3', units: [unit('wan'), unit('you'), unit('nian'), unit('le'), unit('hou'), unit('di')], examples: [example('e3', ['wo', 'wan', 'le'], 'I played.')] },
  ],
}, ...['2', '3', '4', '5', '6'].map(name => ({ schemaVersion: 1, band: name, alignment: 'hsk-' + name, vocabulary: [], grammar: [], groups: [] }))]
const c = () => buildCurriculum(FIXTURE)

describe('duration tagger', () => {
  it('tags a verb followed by a length of time, and adds the 了 point when 了 sits between them', () => {
    const cur = c()
    expect(durationRefs(cur, '我休息五分钟。')).toEqual([DURATION_REF])
    expect(durationRefs(cur, '我住三天。')).toEqual([DURATION_REF])
    expect(durationRefs(cur, '我玩了三天。')).toEqual([DURATION_REF, DURATION_LE_REF])
    expect(durationRefs(cur, '我休息一会儿。')).toEqual([DURATION_REF])
    expect(durationRefs(cur, '我住两个小时。')).toEqual([DURATION_REF])
    expect(durationRefs(cur, '我住半年。')).toEqual([DURATION_REF])
  })
  it('does not tag a point in time, an ordinal, a noun phrase or a time word before the verb', () => {
    const cur = c()
    expect(durationRefs(cur, '五点休息。')).toEqual([])
    expect(durationRefs(cur, '三天后我休息。')).toEqual([])
    expect(durationRefs(cur, '我有三天。')).toEqual([]) // 有 is possession, not an action lasting three days
    expect(durationRefs(cur, '五分钟我休息。')).toEqual([])
    expect(durationRefs(cur, '我是第三天。')).toEqual([])
    expect(durationRefs(cur, '我休息。')).toEqual([])
  })
  it('replaces whatever duration tags the model gave with the ones code finds, keeping the other tags', () => {
    const cur = c()
    expect(withDurationGrammar(cur, '我休息五分钟。', ['s-vp'])).toEqual(['s-vp', DURATION_REF])
    expect(withDurationGrammar(cur, '我休息。', ['s-vp', DURATION_REF])).toEqual(['s-vp'])
    expect(withDurationGrammar(cur, '我玩了三天。', [])).toEqual([DURATION_REF]) // the 了 point is not in this catalog, so it is not added
  })
  it('gates a phrase on the duration point through applyGrammar and readyAt', () => {
    const cur = c()
    const allowed = { grammar: { has: () => true } }
    const phrase = applyGrammar(cur, { zh: '我休息五分钟。', words: ['wo', 'xx', 'wu', 'fz'] }, ['s-vp'], allowed)
    expect(phrase.grammar).toEqual(['s-vp', DURATION_REF])
    expect(phrase.readyAt).toBe(1) // the duration point is introduced in lesson index 1; the words are by index 0
    expect(applyGrammar(cur, { zh: '我休息。', words: ['wo', 'xx'] }, [], allowed).readyAt).toBe(0)
  })
})

describe('strict target', () => {
  const options = (extra: object = {}) => ({ ...parseArgs(['--target', '2'], {}), lookahead: [0, 2], batchSize: 20, ...extra })
  it('uses --target at pass 0 and only --fallback-target after it', () => {
    expect(targetOf({ target: 6 }, 0)).toBe(6)
    expect(targetOf({ target: 6 }, 2)).toBe(DEFAULT_FALLBACK_TARGET)
    expect(targetOf({ target: 6, fallbackTarget: 0 }, 4)).toBe(0)
    expect(parseArgs(['--target', '6', '--fallback-target', '0'], {}).fallbackTarget).toBe(0)
  })
  it('does not count a phrase that needs a later lesson towards a word target', () => {
    const cur = c(), state = emptyState()
    const wuWord = cur.words.get('wu')
    addPhrase(cur, state, { zh: '我五', py: 'wǒ wǔ', en: 'x', words: ['wo', 'wu'], grammar: [], source: 'ai', checked: true, lookahead: 0 })
    addPhrase(cur, state, { zh: '五我休息', py: 'wǔ wǒ', en: 'y', words: ['wo', 'wu', 'zhu', 'san'], grammar: [], source: 'ai', checked: true, lookahead: 2 })
    expect(phrasesForWord(cur, state, wuWord, 0).map(phrase => phrase.zh)).toEqual(['我五'])
    expect(phrasesForWord(cur, state, wuWord, 2).length).toBe(2)
    // pass 0 counts only the strict phrase: the later-lesson phrase does not reduce the need
    const pass0 = selectWords({ curriculum: cur, state, options: options({ target: 3 }), lookahead: 0 }).find(entry => entry.word.lb === 'wu')
    expect(pass0?.need).toBe(3 - (pass0?.catalogCount ?? 0) - 1)
    // at look-ahead 2 the target is the fallback (1): both phrases are ready, so the word is done and not selected again
    expect(selectWords({ curriculum: cur, state, options: options(), lookahead: 2 }).some(entry => entry.word.lb === 'wu')).toBe(false)
  })
  it('revisits a done word at pass 0 when --target is raised', () => {
    const cur = c(), state = emptyState()
    for (const target of wordsInScope(cur, {})) state.words[target.lb] = { status: 'done', attempts: 1, lookahead: 16, target: 1 }
    expect(selectWords({ curriculum: cur, state, options: options({ target: 1 }), lookahead: 0 })).toEqual([])
    expect(selectWords({ curriculum: cur, state, options: options({ target: 9 }), lookahead: 0 }).length).toBeGreaterThan(0)
  })
})

describe('strict readability report', () => {
  it('lists, per band, how many words and grammar points have 0, 1, 2 ... strict phrases', () => {
    const cur = c(), state = emptyState()
    addPhrase(cur, state, { zh: '我休息', py: 'wǒ xiū xi', en: 'x', words: ['wo', 'xx'], grammar: [], source: 'ai', checked: true, lookahead: 0 })
    const histogram = strictHistogram(cur, state, wordsInScope(cur, {}), [])
    expect(Object.keys(histogram)).toEqual(['1'])
    const words = histogram['1'].words
    expect(Object.keys(words)).toEqual(['0', '1', '2', '3', '4', '5', '6+'])
    expect(Object.values(words).reduce((sum: number, count) => sum + (count as number), 0)).toBe(wordsInScope(cur, {}).length)
    const report = passReport(cur, state, { target: 3, lookahead: [0, 2] })
    expect(report.strictReadable['1'].words).toEqual(words)
    expect(report.fallbackTarget).toBe(DEFAULT_FALLBACK_TARGET)
  })
})

describe('writer prompt', () => {
  it('tells the writer to use only the listed sentence patterns, and a length of time after a verb only with a duration pattern in the list', async () => {
    const cur = c(), state = emptyState()
    const prompts: string[] = []
    const fetchImpl = async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      const text = body.messages.map((m: { content: string }) => m.content).join('\n')
      prompts.push(text)
      const content = JSON.stringify(text.includes('"phrases"') && !text.includes('natural') ? { phrases: [] } : { results: [] })
      return { ok: true, status: 200, text: async () => content, json: async () => ({ choices: [{ message: { content } }] }) }
    }
    const options = { ...parseArgs(['--base-url', 'http://gateway/v1', '--writer-model', 'w', '--checker-model', 'k', '--writer-api', 'chat', '--checker-api', 'chat', '--target', '5', '--lookahead', '0', '--words', 'xx'], {}), batchSize: 20 }
    await runPipeline({ curriculum: cur, state, io: createIO(options, fetchImpl as never), options })
    // the word has no phrase yet, so the writer is asked for one
    const written = prompts.find(text => text.includes('Use ONLY the sentence patterns'))
    expect(prompts.length).toBeGreaterThan(0)
    expect(written, prompts.map(text => text.slice(0, 80)).join(' | ')).toBeDefined()
    expect(written).toContain('Use ONLY the sentence patterns in that list')
    expect(written).toContain('length of time after a verb')
    expect(written).toContain('a point in time')
  })
})

describe('retagging the shipped data', () => {
  it('moves only phrases whose duration tags change, and their practice items', () => {
    const cur = c()
    const files = [{ band: '1', phrases: [
      { id: 1, zh: '我休息五分钟。', py: '', en: 'x', words: ['wo', 'xx', 'wu', 'fz'], grammar: [], source: 'ai', checked: true, readyAt: 0 },
      { id: 2, zh: '我休息。', py: '', en: 'y', words: ['wo', 'xx'], grammar: [], source: 'ai', checked: true, readyAt: 7 },
    ] }]
    const changed = retagPhrases(cur, files)
    expect(changed.map(row => [row.id, row.from, row.to])).toEqual([[1, 0, 1]])
    expect(files[0].phrases[0].grammar).toEqual([DURATION_REF])
    expect(files[0].phrases[1].readyAt).toBe(7) // untouched without --all
    expect(retagPhrases(cur, files, { all: true }).map(row => row.id)).toEqual([2])
    const ready = new Map([['我休息五分钟', 1]])
    const accepted = [{ key: '我休息五分钟', zh: '我休息五分钟。', en: 'x', zhAlt: [], enAlt: [], optional: [], readyAt: 0 }]
    expect(retagPractice(cur, 'accepted', accepted, ready).length).toBe(1)
    expect(accepted[0].readyAt).toBe(1)
    const exchange = [{ id: 'x1', q: { zh: '你休息吗？' }, a: { zh: '我休息五分钟。' }, words: ['wo', 'xx'], grammar: [], readyAt: 0 }]
    expect(retagPractice(cur, 'exchanges', exchange, ready).map(row => row.to)).toEqual([1])
    expect(exchange[0].grammar).toEqual([DURATION_REF])
    expect(readyAtOf(cur, ['wo'], [])).toBe(0)
  })
})
