// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPack } from '../language'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { shippedPhrases } from '../phrases/bank'
import type { BankPhrase } from '../phrases/contracts'
import { isVocabulary } from '../study/local-exercises'
import { buildDictation, buildGap, buildTiles, buildTranslate, type FormContext } from './bank-forms'
import { gradeMeaning, segmentWords } from './grade'
import type { GapItem, TextItem, TilesItem } from './types'

// Word order, Fill the gap, Dictation and English to Japanese in a Japanese build: every form asks the pack (sentence-forms.ts, japanese-sentence.ts).
let catalog: Catalog
let bank: BankPhrase[]
const slot = { id: 's', stage: 'produce' as const, refs: [], round: 0 }
const find = (zh: string) => bank.find(phrase => phrase.zh === zh)!
const context = (readyAt: number): FormContext => {
  const knownUnits = [...catalog.units.values()].filter(isVocabulary).filter(unit => bank.some(phrase => (phrase.readyAt ?? 999) <= readyAt && phrase.words.includes(unit.ref)))
  return { catalog, forms: new Set(), knownUnits, bank, seed: 3 }
}
const grade = (item: TextItem | TilesItem, text: string, placed?: string[]) => getPack().gradeSentence({ text, placed, accepted: item.accepted, spelled: item.spelled, forms: new Set() })
const dictation = (zh: string): TextItem => buildDictation(slot, find(zh), context(99))

beforeAll(async () => {
  setBuildLanguageForTests('ja')
  resetCatalogCache()
  catalog = await loadCatalog()
  const all = new Map<string, BankPhrase>()
  for (const band of Object.keys(getPack().phrases.bands)) for (const list of Object.values(await shippedPhrases(band))) for (const phrase of list) all.set(String(phrase.id), phrase)
  bank = [...all.values()]
}, 60000)
afterAll(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('Word order', () => {
  it('lesson 1: the right order is right; a swapped particle is wrong, with the particle feedback; the wrong tile is a swapped particle', () => {
    const item = buildTiles(slot, find('私は学生です。'), context(1))!
    expect(item.tiles).toEqual(['私', 'は', '学生', 'です'])
    expect(item.distractors).toEqual(['が'])
    expect(grade(item, '', ['私', 'は', '学生', 'です']).verdict).toBe('correct')
    const wrong = grade(item, '', ['私', 'が', '学生', 'です'])
    expect(wrong.verdict).toBe('diff')
    expect(wrong.messages.join(' ')).toContain('が marks the subject, often new information, but here the sentence needs は, which marks the topic.')
    expect(grade(item, '', ['学生', 'は', '私', 'です']).verdict).toBe('diff')
  })
  it('lesson 40: a conjugated word is one tile and the order is marked', () => {
    const item = buildTiles(slot, find('今は遅すぎます。'), context(40))!
    expect(item.tiles).toEqual(['今', 'は', '遅すぎます'])
    expect(grade(item, '', ['今', 'は', '遅すぎます']).verdict).toBe('correct')
    const order = grade(item, '', ['は', '今', '遅すぎます'])
    expect(order.verdict).toBe('diff')
    expect(order.messages.length).toBeGreaterThan(0)
  })
  it('a sentence with the same word twice is right whichever of the two tiles is placed first', () => {
    const twice = bank.map(phrase => ({ phrase, item: buildTiles(slot, phrase, context(99)) })).filter(({ item }) => item && new Set(item.tiles).size < item.tiles.length)
    expect(twice.length).toBeGreaterThan(0)
    for (const { item } of twice) {
      const all = [...item!.tiles, ...item!.distractors]
      const dup = all.findIndex((tile, index) => all.indexOf(tile) !== index)
      const first = all.indexOf(all[dup])
      const place = (order: number[]) => order.map(index => all[index])
      const model = item!.tiles.map((_, index) => index)
      const swapped = model.map(index => index === first ? dup : index === dup ? first : index)
      expect(grade(item!, '', place(model)).verdict).toBe('correct')
      expect(grade(item!, '', place(swapped)).verdict).toBe('correct')
    }
  })
})

describe('Fill the gap', () => {
  it('finds a conjugated verb through the sentence tokens and blanks it whole; the options are verbs in the same form', () => {
    const item = buildGap(slot, find('私は勉強します。'), 'vocabulary:benkyousuru--study', context(99)) as GapItem
    expect(item).toBeDefined()
    expect(item.gapped).toBe('私は＿＿。')
    expect(item.options[item.answer]).toBe('勉強します')
    expect(item.options.length).toBeGreaterThanOrEqual(3)
    for (const option of item.options) expect(option, option).toMatch(/ます$/)
    expect(new Set(item.options).size).toBe(item.options.length)
  })
  it('a noun is among nouns, the data cannot say more than "no conjugation class"', () => {
    const item = buildGap(slot, find('私は学生です。'), 'vocabulary:gakusei--student', context(99)) as GapItem
    expect(item.gapped).toBe('私は＿＿です。')
    const classes = new Map([...catalog.units.values()].filter(isVocabulary).map(unit => [unit.record.ch, unit.record.cl]))
    for (const option of item.options) expect(classes.get(option), option).toBeUndefined()
  })
  it('an adjective is among adjectives, in the form of the token', () => {
    const phrase = bank.find(item => item.tokens?.some(token => token.form === 'adj-sugi'))!
    const label = phrase.tokens!.find(token => token.form === 'adj-sugi')!.word!
    const item = buildGap(slot, phrase, 'vocabulary:' + label, context(99)) as GapItem
    expect(item).toBeDefined()
    for (const option of item.options) expect(option, option).toMatch(/すぎます$/)
  })
})

describe('Word order: why it is wrong', () => {
  const model = ['私', 'は', '学生', 'です']
  const item = () => buildTiles(slot, find('私は学生です。'), context(1))!
  const notes = (placed: string[]) => grade(item(), '', placed).messages.join(' ')
  it('a fully reversed order with every tile used says the order is different, not that a particle is wrong', () => {
    const text = notes([...model].reverse())
    expect(text).toBe('All the words are there, but the order is different.')
    expect(text).not.toMatch(/particle/)
  })
  it('the same tiles in any other order get that note', () => {
    expect(notes(['学生', 'は', '私', 'です'])).toBe('All the words are there, but the order is different.')
  })
  it('a particle swapped for another (は for が) names the particle, not the order', () => {
    const text = notes(['私', 'が', '学生', 'です'])
    expect(text).toContain('が marks the subject, often new information, but here the sentence needs は, which marks the topic.')
    expect(text).not.toMatch(/order is different/)
  })
  it('a missing particle says a particle is missing, extra or in the wrong place', () => {
    expect(notes(['私', '学生', 'です'])).toBe('A particle is missing, extra or in the wrong place.')
  })
})

describe('Fill the gap: options of one kind (lessons 1 to 4)', () => {
  const gap = (zh: string, word: string, readyAt: number) => buildGap(slot, find(zh), 'vocabulary:' + word, context(readyAt)) as GapItem
  const SET_PHRASES = ['大丈夫です', 'ありがとう', 'すみません', 'さようなら', 'どういたしまして']
  it('＿＿は先生ですか: the wrong options are nouns and pronouns, not a set phrase', () => {
    const item = gap('あなたは先生ですか。', 'anata--you', 4)
    expect(item.gapped).toBe('＿＿は先生ですか。')
    expect(item.options[item.answer]).toBe('あなた')
    for (const option of item.options) expect(SET_PHRASES).not.toContain(option)
    expect(new Set(item.options).size).toBe(4)
  })
  it('私は＿＿の先生です: the wrong options are nouns and pronouns, not a set phrase', () => {
    const item = gap('私は中国語の先生です。', 'chuugokugo--chinese', 4)
    expect(item.gapped).toBe('私は＿＿の先生です。')
    expect(item.options[item.answer]).toBe('中国語')
    for (const option of item.options) expect(SET_PHRASES).not.toContain(option)
  })
  it('the same on every shuffle seed of lessons 1 to 4', () => {
    for (let seed = 1; seed < 12; seed++) {
      const ctx = { ...context(4), seed }
      const item = buildGap(slot, find('私は中国語の先生です。'), 'vocabulary:chuugokugo--chinese', ctx) as GapItem
      for (const option of item.options) expect(SET_PHRASES).not.toContain(option)
    }
  })
  it('a set-phrase gap takes set phrases for its wrong options first', () => {
    const phrase = bank.find(item => item.tokens?.filter(token => token.punctuation === undefined).length === 1 && item.words.includes('arigatou--thank'))
    if (!phrase) return
    const item = buildGap(slot, phrase, 'vocabulary:arigatou--thank', context(99))
    if (item) for (const option of item.options) expect([...SET_PHRASES, ...(option === item.options[item.answer] ? [option] : [])]).toContain(option)
  })
})

describe('a typed Japanese sentence', () => {
  let item: TextItem
  beforeAll(() => { item = dictation('私は勉強します。') })
  it('is right as written, and spaces, punctuation and width do not count', () => {
    for (const text of ['私は勉強します。', '私は勉強します', '　私は 勉強します！', '私は勉強します.']) { const result = grade(item, text); expect(result.verdict, text).toBe('correct'); expect(result.note, text).toBeUndefined() }
    expect(grade(buildDictation(slot, find('私は学生です。'), context(99)), '私は学生です').verdict).toBe('correct')
  })
  it('accepts kana for a kanji word, with the sentence as written under it', () => {
    for (const text of ['わたしはべんきょうします', '私はべんきょうします。', 'わたしは勉強します', 'ワタシハベンキョウシマス']) {
      const result = grade(item, text)
      expect(result.verdict, text).toBe('correct')
      expect(result.written, text).toBe('私は勉強します。')
    }
  })
  it('accepts hiragana for a katakana word and the reverse', () => {
    const phrase = bank.find(item => /[ァ-ヶ]/.test(item.zh) && item.tokens)!
    const built = buildDictation(slot, phrase, context(99))
    const hira = phrase.zh.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    const result = grade(built, hira)
    expect(result.verdict, hira).toBe('correct')
    expect(result.written).toBe(phrase.zh)
  })
  it('a wrong particle, a missing word and a wrong order are told apart', () => {
    const particle = grade(item, '私が勉強します')
    expect(particle.verdict).toBe('diff')
    expect(particle.messages.join(' ')).toContain('needs は')
    const missing = grade(item, '勉強します')
    expect(missing.verdict).toBe('diff')
    expect(missing.messages.join(' ')).toContain('missing')
    const order = grade(item, '勉強します私は')
    expect(order.verdict).toBe('diff')
    expect(order.messages.length).toBeGreaterThan(0)
    expect(grade(item, '私は先生です').verdict).toBe('diff')
  })
  it('reads an answer wholly in Latin letters as romaji, particles as they are said', () => {
    for (const text of ['watashi wa benkyou shimasu', 'watashi ha benkyou shimasu', 'Watashi wa benkyō shimasu.', 'watashiwabenkyoushimasu']) expect(grade(item, text).verdict, text).toBe('correct')
    expect(grade(item, 'watashi wa gakusei desu').verdict).toBe('diff')
    const o = grade(buildDictation(slot, find('私は学生です。'), context(99)), 'watashi wa gakusei desu')
    expect(o.verdict).toBe('correct')
  })
  it('English to Japanese marks the same way', () => {
    const built = buildTranslate(slot, 'translate-en-zh', find('私は勉強します。'), context(99)) as TextItem
    expect(built.spelled).toBeDefined()
    expect(grade(built, 'わたしはべんきょうします').verdict).toBe('correct')
  })
})

describe('a typed meaning', () => {
  it('stays wrong for a Japanese answer, with the note from the pack', () => {
    expect(gradeMeaning('学生', ['student'])).toEqual({ verdict: 'wrong', note: 'The answer should be in English, not Japanese.' })
    expect(gradeMeaning('がくせい', ['student']).verdict).toBe('wrong')
    expect(gradeMeaning('student', ['student']).verdict).toBe('correct')
  })
})

describe('every shipped Japanese sentence', () => {
  it('has tiles that can be put in an order the marker calls right, and is right typed as written and typed wholly in kana', () => {
    expect(bank).toHaveLength(822)
    const unbuildable: string[] = [], unmarkable: string[] = []
    for (const phrase of bank) {
      const ctx = context(99)
      const tiles = buildTiles(slot, phrase, ctx)
      if (!tiles) { const words = segmentWords(phrase.zh, new Set(), phrase.tokens, label => { const unit = catalog.units.get('vocabulary:' + label); return unit?.kind === 'vocabulary' ? unit.record.ch : undefined }) ; unbuildable.push(phrase.zh + (words.length < 2 ? ' (one word)' : ' (a tile over 12 characters)')) }
      else if (grade(tiles, '', tiles.tiles).verdict !== 'correct') unmarkable.push('tiles ' + phrase.zh)
      const typed = buildDictation(slot, phrase, ctx)
      const as = grade(typed, phrase.zh)
      if (as.verdict !== 'correct' || as.note) unmarkable.push('as written ' + phrase.zh)
      const kana = grade(typed, phrase.py)
      if (kana.verdict !== 'correct') unmarkable.push('kana ' + phrase.zh + ' / ' + phrase.py)
    }
    expect(unmarkable).toEqual([])
    expect([...unbuildable].sort()).toEqual([...KNOWN_UNBUILDABLE].sort())
  })
})
/** Sentences that cannot be a Word order question, as for Chinese: a sentence of one word has no order, and a tile over 12 characters (a written-out date) is not a tile. They are still marked typed (above). */
const KNOWN_UNBUILDABLE: string[] = [
  '勉強します。 (one word)',
  'すみません！ (one word)',
  'ありがとう。 (one word)',
  '大丈夫です。 (one word)',
  'さようなら。 (one word)',
  '休みましょう。 (one word)',
  '休んでください。 (one word)',
  '休みたいです。 (one word)',
  'どういたしまして。 (one word)',
  '今日は二千二十六年九月二十二日です。 (a tile over 12 characters)',
  '料理したいです。 (one word)',
  '二千二十六年三月十三日は雪があります。 (a tile over 12 characters)',
  '寝ないでください。 (one word)',
  'こんにちは。 (one word)',
  '座ってください。 (one word)',
  '降りないでください。 (one word)',
  '歌わないでください。 (one word)',
  'もしもし？ (one word)',
  '会いたいです。 (one word)',
  '見てください。 (one word)',
  '聞こえませんでした。 (one word)'
]
