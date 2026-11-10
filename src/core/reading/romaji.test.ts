import { describe, expect, it } from 'vitest'
import { kanaToRomaji, tokensToRomaji } from './romaji'

const overrides = { こんにちは: 'konnichiwa', こんばんは: 'konbanwa', ではありません: 'dewa arimasen' }

describe('kanaToRomaji', () => {
  it('spells kana in Hepburn without macrons', () => {
    const cases: [string, string][] = [
      ['きょう', 'kyou'], ['がっこう', 'gakkou'], ['はな', 'hana'], ['しんぶん', 'shinbun'], ['ほんや', "hon'ya"], ['コーヒー', 'koohii'], ['おちゃ', 'ocha'], ['じゅう', 'juu'],
      ['とうきょう', 'toukyou'], ['し', 'shi'], ['ち', 'chi'], ['つ', 'tsu'], ['ふ', 'fu'], ['じゃ', 'ja'], ['ん', 'n'], ['きんえん', "kin'en"], ['まっちゃ', 'matcha'], ['ざっし', 'zasshi'],
      ['ちょっと', 'chotto'], ['べんきょうします', 'benkyoushimasu'], ['でんわ', 'denwa'], ['ファイル', 'fairu'], ['パーティー', 'paatii'], ['ほんのすこし', 'honnosukoshi'],
    ]
    for (const [kana, romaji] of cases) expect(kanaToRomaji(kana), kana).toBe(romaji)
  })
  it('writes は and へ as ha and he inside a word, and を as o', () => {
    expect(kanaToRomaji('はへ')).toBe('hahe')
    expect(kanaToRomaji('じゅぎょうをうける')).toBe('jugyou o ukeru')
    expect(kanaToRomaji('をください')).toBe('o kudasai')
  })
  it('consults the hand-written romaji first', () => {
    expect(kanaToRomaji('こんにちは', overrides)).toBe('konnichiwa')
    expect(kanaToRomaji('こんばんは', overrides)).toBe('konbanwa')
    expect(kanaToRomaji('ではありません', overrides)).toBe('dewa arimasen')
    expect(kanaToRomaji('こんにちは')).toBe('konnichiha')
  })
})

describe('tokensToRomaji', () => {
  it('writes a particle is as wa, e and o, spaces tokens and leaves none before punctuation', () => {
    const sentence = [
      { reading: 'わたし' }, { reading: 'は', particle: true }, { reading: 'がっこう' }, { reading: 'へ', particle: true }, { reading: 'いきます' }, { reading: '。', punctuation: true },
    ]
    expect(tokensToRomaji(sentence)).toBe('watashi wa gakkou e ikimasu.')
    expect(tokensToRomaji([{ reading: 'みず' }, { reading: 'を', particle: true }, { reading: 'のみます' }, { reading: '。', punctuation: true }])).toBe('mizu o nomimasu.')
    expect(tokensToRomaji([{ reading: 'はな' }, { reading: 'は', particle: true }, { reading: 'きれい' }])).toBe('hana wa kirei')
  })
  it('says a word token は as ha, and joins a sound the token split cut in two', () => {
    expect(tokensToRomaji([{ reading: 'は' }, { reading: 'っぴゃく' }, { reading: 'えん' }])).toBe('happyaku en')
    expect(tokensToRomaji([{ reading: 'こんにちは' }], overrides)).toBe('konnichiwa')
  })
})
