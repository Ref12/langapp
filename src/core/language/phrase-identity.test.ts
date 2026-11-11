// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { shippedPhrases } from '../phrases/bank'
import type { BankPhrase } from '../phrases/contracts'
import { phraseKey } from '../phrases/key'
import { segmentWords } from '../session/grade'
import { unitRef } from '../study/contracts'
import { catalogBankPhrases } from '../phrases/bank'
import { getPack, packFor } from '.'
import { lettersPhraseKey } from './phrase-identity'
import { isParticle, normaliseTile, PARTICLES } from './particles'

afterEach(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

/** The key and the segmenter as they were before the pack owned them (phrases/key.ts and session/grade.ts at bdafc6f), kept here verbatim as the reference for the Chinese proof. */
const oldKey = (zh: string): string => zh.replace(/[^\p{Script=Han}]/gu, '')
function oldSegment(text: string, forms: ReadonlySet<string>): string[] {
  const longest = Math.max(1, ...[...forms].map(form => form.length))
  const out: string[] = []
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    let start = 0
    while (start < run.length) {
      let length = Math.min(longest, run.length - start)
      while (length > 1 && !forms.has(run.slice(start, start + length))) length--
      out.push(run.slice(start, start + length)); start += length
    }
  }
  return out
}

async function shippedBank(): Promise<BankPhrase[]> {
  const out = new Map<string, BankPhrase>()
  for (const band of Object.keys(getPack().phrases.bands)) for (const list of Object.values(await shippedPhrases(band))) for (const phrase of list) out.set(String(phrase.id), phrase)
  return [...out.values()]
}
const surfaceOf = (catalog: Catalog) => (label: string) => { const unit = catalog.units.get(unitRef('vocabulary', label)); return unit?.kind === 'vocabulary' ? unit.record.ch : undefined }

describe('Chinese phrase identity is what it was', () => {
  it('gives every shipped phrase the same key and the same tiles as before', async () => {
    const catalog = await loadCatalog()
    const bank = await shippedBank()
    expect(bank.length).toBeGreaterThan(1000)
    const all = new Set([...catalog.units.values()].flatMap(unit => unit.kind === 'vocabulary' ? [unit.record.ch] : []))
    for (const phrase of bank) {
      expect(phraseKey(phrase.zh), phrase.zh).toBe(oldKey(phrase.zh))
      const own = new Set(all)
      for (const ref of phrase.words) { const form = surfaceOf(catalog)(ref); if (form) own.add(form) }
      expect(segmentWords(phrase.zh, own), phrase.zh).toEqual(oldSegment(phrase.zh, own))
      expect(segmentWords(phrase.zh, own, phrase.tokens, surfaceOf(catalog)), phrase.zh).toEqual(oldSegment(phrase.zh, own))
    }
  })
  it('keeps the Han-only key', () => {
    expect(phraseKey('现在太晚了！')).toBe('现在太晚了')
    expect(phraseKey('a 你好, 世界.')).toBe('你好世界')
    expect(phraseKey('')).toBe('')
  })
})

describe('the Japanese key', () => {
  const key = packFor('ja').phraseKey
  it('keeps kana and kanji apart, so kana-only sentences differ', () => {
    expect(key('ありがとう。')).toBe('ありがとう')
    expect(key('すみません。')).not.toBe(key('ありがとう。'))
    expect(key('私は学生です。')).not.toBe(key('私は先生です。'))
  })
  it('does not fold katakana into hiragana', () => { expect(key('ケーキ')).not.toBe(key('けーき')) })
  it('drops spaces and punctuation, Japanese and Latin', () => {
    expect(key('私は 学生です！')).toBe(key('私は学生です。'))
    expect(key('「ありがとう」、 \u3000ね?')).toBe(key('ありがとうね'))
    expect(key('A, b.')).toBe('ab')
  })
  it('folds full-width and half-width forms', () => {
    expect(key('ＡＢＣ１２３')).toBe(key('abc123'))
    expect(key('ｶﾞｲﾄﾞ')).toBe(key('ガイド'))
  })
  it('is not the reading: the same reading with other kanji is another sentence', () => { expect(key('橋')).not.toBe(key('箸')) })
  it('is the same key for the Korean pack rule', () => { expect(packFor('ko').phraseKey('안녕하세요!')).toBe(lettersPhraseKey('안녕 하세요')) })
})

describe('the Korean key and tiles', () => {
  const ko = packFor('ko')
  it('keeps a question apart from a statement: 공부해요? and 공부해요. are two sentences', () => {
    expect(ko.phraseKey('공부하세요.')).not.toBe(ko.phraseKey('공부하세요?'))
    expect(ko.phraseKey('공부하세요?')).toBe(ko.phraseKey('공부 하세요 ?'))
    expect(ko.phraseKey('날씨가 더워요?')).toBe(ko.phraseKey('날씨가 더워요？'))
    expect(ko.phraseKey('안녕하세요!')).toBe(lettersPhraseKey('안녕 하세요'))
  })
  it('cuts the tokens at their spaces, a particle on its own, and a sentence without tokens at its spaces', () => {
    const tokens = [{ word: 'jeo' }, { grammar: 'g', text: '는', reading: '는' }, { punctuation: ' ' }, { word: 'gongbu', text: '공부하지 않아요', reading: '공부하지 않아요' }, { punctuation: '.' }]
    expect(ko.segment('저는 공부하지 않아요.', { forms: new Set(), tokens, surface: label => label === 'jeo' ? '저' : undefined })).toEqual(['저', '는', '공부하지', '않아요'])
    expect(ko.segment('저는 학생이에요.', { forms: new Set() })).toEqual(['저는', '학생이에요.'])
    expect(packFor('ja').segment('', { forms: new Set(), tokens: [{ text: 'a b', reading: 'a b' }] })).toEqual(['a b'])
  })
})

describe('the particles moved behind the pack', () => {
  it('tells a particle and normalises tiles as the parallel screens did', () => {
    expect(isParticle('ja', 'は')).toBe(true)
    expect(isParticle('ja', '学生')).toBe(false)
    expect(PARTICLES.ja['を']).toBe('marks the object')
    expect(normaliseTile('学生です！')).toBe('学生です')
  })
})

describe('the shipped Japanese sentences', () => {
  it('have distinct keys, each with tokens that join back to the sentence', async () => {
    setBuildLanguageForTests('ja')
    const catalog = await loadCatalog()
    const bank = await shippedBank()
    expect(bank).toHaveLength(822)
    const seen = new Map<string, string>()
    const collisions: string[] = []
    const faults: string[] = []
    for (const phrase of bank) {
      const key = phraseKey(phrase.zh)
      const other = seen.get(key)
      if (other !== undefined) collisions.push(other + ' / ' + phrase.zh)
      seen.set(key, phrase.zh)
      const tiles = segmentWords(phrase.zh, new Set(), phrase.tokens, surfaceOf(catalog))
      if (!tiles.length) faults.push('no tokens: ' + phrase.zh)
      else if (lettersPhraseKey(tiles.join('')) !== key) faults.push(phrase.zh + ' -> ' + tiles.join(' | '))
    }
    expect([...collisions].sort()).toEqual([...KNOWN_COLLISIONS].sort())
    expect(faults).toEqual(KNOWN_FAULTS)
  })
  it('make whole-word tiles: a conjugated word is one tile', async () => {
    setBuildLanguageForTests('ja')
    const catalog = await loadCatalog()
    const phrase = (await shippedBank()).find(item => item.zh === '私は勉強します。')!
    expect(segmentWords(phrase.zh, new Set(), phrase.tokens, surfaceOf(catalog))).toEqual(['私', 'は', '勉強します'])
  })
  it('carry their tokens on catalog examples too', async () => {
    setBuildLanguageForTests('ja')
    const catalog = await loadCatalog()
    const phrase = catalogBankPhrases(catalog, 'vocabulary:benkyousuru--study').find(item => item.zh === '私は勉強します。')!
    expect(segmentWords(phrase.zh, new Set(), phrase.tokens, surfaceOf(catalog))).toEqual(['私', 'は', '勉強します'])
  })
})

/** Two true duplicates in the shipped bank (same sentence, ids 551/624 and 579/701; the English differs only in wording): they are one sentence to a learner and the key says so. */
const KNOWN_COLLISIONS: string[] = ['今日は暑いです。 / 今日は暑いです。', '土曜日は休みます。 / 土曜日は休みます。']
const KNOWN_FAULTS: string[] = []

describe('the shipped Korean sentences', () => {
  it('have distinct keys and non-empty tiles that join back to the sentence, none with a space in it', async () => {
    setBuildLanguageForTests('ko')
    const catalog = await loadCatalog()
    const bank = await shippedBank()
    expect(bank).toHaveLength(905)
    const keys = new Map<string, string>()
    const collisions: string[] = [], faults: string[] = []
    for (const phrase of bank) {
      const key = phraseKey(phrase.zh)
      const other = keys.get(key)
      if (other !== undefined) collisions.push(other + ' / ' + phrase.zh)
      keys.set(key, phrase.zh)
      const tiles = segmentWords(phrase.zh, new Set(), phrase.tokens, surfaceOf(catalog))
      if (!tiles.length) faults.push('no tokens: ' + phrase.zh)
      else if (lettersPhraseKey(tiles.join('')) !== lettersPhraseKey(phrase.zh) || tiles.some(tile => /\s/.test(tile) || !lettersPhraseKey(tile))) faults.push(phrase.zh + ' -> ' + tiles.join(' | '))
    }
    expect(collisions).toEqual([])
    expect(faults).toEqual([])
    expect(keys.size).toBe(905)
  })
  it('make word tiles: a particle is its own tile, a conjugated word is one tile', async () => {
    setBuildLanguageForTests('ko')
    const catalog = await loadCatalog()
    const bank = await shippedBank()
    expect(segmentWords('저는 공부해요.', new Set(), bank.find(item => item.zh === '저는 공부해요.')!.tokens, surfaceOf(catalog))).toEqual(['저', '는', '공부해요'])
  })
})
