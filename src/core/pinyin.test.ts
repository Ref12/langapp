import { describe, expect, it } from 'vitest'
import { formatPinyin, pinyinFormatSchema } from './pinyin'

describe('display-only pinyin formatting', () => {
  it.each([
    ['wǒ', 'wǒ3', 'wo3'],
    ['mā má mǎ mà ma', 'mā1 má2 mǎ3 mà4 ma5', 'ma1 ma2 ma3 ma4 ma5'],
    ['Nǚ lǜ lüe nǚ ér huār', 'Nǚ3 lǜ4 lüe5 nǚ3 ér2 huār1', 'Nü3 lü4 lüe5 nü3 er2 huar1'],
    ['ń ň ǹ m̄ ḿ ê̄', 'ń2 ň3 ǹ4 m̄1 ḿ2 ê̄1', 'n2 n3 n4 m1 m2 ê1'],
    ['Wǒmen, nǐhǎo! Xī’ān / Běijīng', 'Wǒ3men5, nǐ3hǎo3! Xī1’ān1 / Běi3jīng1', 'Wo3men5, ni3hao3! Xi1’an1 / Bei3jing1'],
    ['shì + N; V + le\nnǐ\tde', 'shì4 + N; V + le5\nnǐ3\tde5', 'shi4 + N; V + le5\nni3\tde5'],
  ])('formats %s in all three styles, preserving punctuation', (source, combined, numbered) => {
    expect(formatPinyin(source)).toBe(source.normalize('NFC'))
    expect(formatPinyin(source, 'marks-and-numbers')).toBe(combined.normalize('NFC'))
    expect(formatPinyin(source, 'numbers')).toBe(numbered)
    expect(formatPinyin(source.normalize('NFD'), 'numbers')).toBe(numbered)
  })

  it.each(['wo3', 'wǒ3'])('accepts explicitly numbered legacy syllables without duplicating tones: %s', source => {
    expect(formatPinyin(source)).toBe('wǒ')
    expect(formatPinyin(source, 'marks-and-numbers')).toBe('wǒ3')
    expect(formatPinyin(source, 'numbers')).toBe('wo3')
  })

  it('retains umlauts and supports numbered ü, v, and u: spellings', () => {
    expect(formatPinyin('nv3 lu:4 nü3 lü4', 'marks-and-numbers')).toBe('nǚ3 lǜ4 nǚ3 lǜ4')
    expect(formatPinyin('nu:3 nü3', 'numbers')).toBe('nü3 nü3')
  })

  it.each([
    ['shui3 liu2 gui1 dui4', 'shuǐ liú guī duì'],
    ['hao3 mei2 ou3 dou1', 'hǎo méi ǒu dōu'],
    ['xian1 xue2 yuan2', 'xiān xué yuán'],
    ['NÜ3 LU:4 NV3', 'NǙ LǛ NǙ'],
    ['n2 n3 n4 m1 m2 ng2 ê1', 'ń ň ǹ m̄ ḿ ńg ê̄'],
    ['huar1 wanr2', 'huār wánr'],
  ])('places tone marks on explicitly numbered syllables: %s', (source, marked) => {
    expect(formatPinyin(source)).toBe(marked.normalize('NFC'))
    expect(formatPinyin(formatPinyin(source, 'marks-and-numbers'), 'numbers'))
      .toBe(formatPinyin(source, 'numbers'))
  })

  it.each(['ma', 'ma0', 'ma5'])('shows neutral tones as 5 without inventing a mark: %s', source => {
    expect(formatPinyin(source)).toBe('ma')
    expect(formatPinyin(source, 'marks-and-numbers')).toBe('ma5')
    expect(formatPinyin(source, 'numbers')).toBe('ma5')
  })

  it.each(['', '□', 'Subject + Verb', 'HTTP 2026', 'wǒ4', 'ni9', 'mānán', 'wo'.repeat(100), '汉字'])('preserves non-pinyin or ambiguous text unchanged: %s', source => {
    expect(formatPinyin(source, 'marks-and-numbers')).toBe(source)
  })

  it('only allows the supported display formats', () => {
    expect(pinyinFormatSchema.options).toEqual(['marks', 'marks-and-numbers', 'numbers'])
    expect(pinyinFormatSchema.safeParse('anything').success).toBe(false)
  })
})
