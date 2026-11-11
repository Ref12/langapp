// @vitest-environment node
// What the pack hands the speech engine (speech-text.ts): Japanese words and sentence pieces from their kana reading, whole sentences as written, Chinese and Korean unchanged.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getPack, packFor, spokenText } from '.'
import { loadDictionary } from './dictionary-file'
import { kanaSentence, noteJapaneseReadings, resetJapaneseReadings, SENTENCE_STYLE } from './speech-text'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache } from '../study/catalog'
import { shippedPhrases } from '../phrases/bank'
import type { SentenceToken } from './speech-text'

type Phrase = { zh: string; tokens?: SentenceToken[] }
let phrases: Phrase[] = []
const speak = (text: string, hint?: Parameters<ReturnType<typeof getPack>['speechText']>[1]) => getPack().speechText(text, hint)
const dictionaryReading = async (form: string, reading: string) => (await loadDictionary('ja')).words.find(word => word.form === form && word.reading === reading)?.reading

beforeAll(async () => {
  setBuildLanguageForTests('ja')
  await loadCatalog()
  await loadDictionary('ja')
  const byWord = await shippedPhrases('1')
  phrases = [...new Map(Object.values(byWord).flat().map(phrase => [phrase.zh, phrase as unknown as Phrase])).values()]
})
afterEach(() => { setBuildLanguageForTests('ja') })

describe('Japanese speechText: words', () => {
  it('speaks the catalog words with an ambiguous reading from their catalog reading', () => {
    expect(speak('今日')).toBe('きょう')
    expect(speak('一日')).toBe('いちにち')
    expect(speak('何')).toBe('なん')
    expect(speak('勉強する', { kind: 'word' })).toBe('べんきょうする')
  })
  it('speaks a word the catalog lacks from the reading the caller holds (the dictionary entry)', async () => {
    for (const [form, reading] of [['上手', 'じょうず'], ['人', 'ひと'], ['方', 'かた']] as const) {
      expect(await dictionaryReading(form, reading)).toBe(reading)
      expect(speak(form, { reading, kind: 'word' })).toBe(reading)
    }
  })
  it('does not guess between two dictionary readings (上手 is じょうず or うわて)', () => {
    expect(speak('上手')).toBe('上手')
    expect(speak('人')).toBe('人')
    expect(speak('方')).toBe('方')
  })
  it('a hint beats what is known, and a hint that is not kana is ignored', () => {
    expect(speak('今日', { reading: 'こんにち' })).toBe('こんにち')
    expect(speak('今日', { reading: 'kyou' })).toBe('きょう')
  })
  it('falls back to the text as written when no reading is known (free text)', () => {
    expect(speak('鬱蒼')).toBe('鬱蒼')
    expect(speak('東京タワー')).toBe('東京タワー')
    expect(speak('hello')).toBe('hello')
    expect(speak('')).toBe('')
  })
  it('leaves kana as it is', () => {
    expect(speak('ありがとう')).toBe('ありがとう')
    expect(speak('コーヒー', { reading: 'こーひー' })).toBe('コーヒー')
  })
})

describe('Japanese speechText: pieces of a sentence', () => {
  it('speaks every kanji token of a lesson sentence from its token reading', () => {
    const tokens = phrases.flatMap(phrase => phrase.tokens ?? []).filter(token => token.text && /\p{Script=Han}/u.test(token.text) && token.reading)
    expect(tokens.length).toBeGreaterThan(100)
    const readings = new Map<string, Set<string>>()
    for (const token of tokens) (readings.get(token.text!) ?? readings.set(token.text!, new Set()).get(token.text!)!).add(token.reading!)
    for (const [text, set] of readings) if (set.size === 1) expect(speak(text, { kind: 'fragment' }), text).toBe([...set][0])
    expect(speak('勉強します', { kind: 'fragment' })).toBe('べんきょうします')
  })
  it('speaks the particles は and へ as わ and え', () => {
    expect(speak('は', { kind: 'fragment' })).toBe('わ')
    expect(speak('へ', { kind: 'fragment' })).toBe('え')
    expect(speak('は')).toBe('わ')
    expect(speak('が', { kind: 'fragment' })).toBe('が')
    expect(speak('ははは')).toBe('ははは')
  })
  it('takes the caller\'s reading for a piece', () => {
    expect(speak('学生', { reading: 'がくせい', kind: 'fragment' })).toBe('がくせい')
  })
})

describe('Japanese speechText: whole sentences', () => {
  it('keeps the decision in one constant: sentences as written', () => {
    expect(SENTENCE_STYLE).toBe('written')
  })
  it('speaks a sentence as written', () => {
    const phrase = phrases.find(item => item.zh === '私は学生です。')!
    expect(phrase).toBeDefined()
    expect(speak(phrase.zh)).toBe(phrase.zh)
    expect(speak('今日は天気がいいです', { kind: 'sentence', reading: 'きょうは' })).toBe('今日は天気がいいです')
    for (const item of phrases.slice(0, 40)) expect(speak(item.zh)).toBe(item.zh)
  })
  it('can build the kana of a sentence from its authored tokens, with and without spaces (the alternatives behind the constant)', () => {
    const phrase = phrases.find(item => item.zh === '私は勉強します。')!
    expect(kanaSentence(phrase.tokens!, false)).toBe('わたしわべんきょうします。')
    expect(kanaSentence(phrase.tokens!, true)).toBe('わたしわ べんきょうします。')
    const school: SentenceToken[] = [{ text: '私', reading: 'わたし' }, { text: 'は', reading: 'は', grammar: 'wa' }, { text: '学校', reading: 'がっこう' }, { text: 'に', reading: 'に', grammar: 'ni' }, { text: '行きます', reading: 'いきます' }, { punctuation: '。' }]
    expect(kanaSentence(school, true)).toBe('わたしわ がっこうに いきます。')
    expect(kanaSentence(school, false)).toBe('わたしわがっこうにいきます。')
    expect(kanaSentence([{ text: '謎', reading: undefined }], true)).toBeUndefined()
  })
})

describe('the readings the pack is told', () => {
  it('ranks catalog above phrase tokens above the dictionary, and drops a form two sources disagree on', () => {
    resetJapaneseReadings()
    noteJapaneseReadings('dictionary', [['雨雲', 'あまぐも'], ['雨雲', 'うん']])
    expect(speak('雨雲')).toBe('雨雲')
    noteJapaneseReadings('phrase', [['雨雲', 'あまぐも']])
    expect(speak('雨雲')).toBe('雨雲') // the dictionary has two and says nothing: a sentence's token does not settle a word spoken alone
    expect(speak('雨雲', { kind: 'fragment' })).toBe('あまぐも')
    noteJapaneseReadings('catalog', [['雨雲', 'あまくも']])
    expect(speak('雨雲')).toBe('あまくも')
    expect(speak('雨雲', { kind: 'fragment' })).toBe('あまぐも')
    noteJapaneseReadings('piece', [['三人', 'さんにん']])
    expect(speak('三人', { kind: 'fragment' })).toBe('さんにん')
    expect(speak('三人')).toBe('三人')
    noteJapaneseReadings('phrase', [['人', 'たり'], ['人', 'とり']])
    expect(speak('人', { kind: 'fragment' })).toBe('人')
    resetJapaneseReadings()
  })
})

describe('Chinese and Korean', () => {
  it('return the text unchanged', () => {
    for (const id of ['zh', 'ko'] as const) {
      const pack = packFor(id)
      for (const text of ['今天', '你好。', '는', '공부해요', '今日', 'は', 'へ']) expect(pack.speechText(text, { reading: 'きょう', kind: 'word' })).toBe(text)
    }
  })
  it('spokenText leaves other locales (English) alone and asks the pack of the build for its own', () => {
    expect(spokenText('en-US', '今日')).toBe('今日')
    expect(spokenText('ja-JP', 'は')).toBe('わ')
    expect(spokenText('zh-Hans', 'は')).toBe('は')
    setBuildLanguageForTests('ko')
    expect(spokenText('ko-KR', '공부해요')).toBe('공부해요')
    expect(spokenText('ja-JP', '今日')).toBe('今日')
    resetCatalogCache()
  })
})
