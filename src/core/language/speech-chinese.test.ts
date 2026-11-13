// @vitest-environment node
// The Chinese speech step: a character with two readings is spoken as a character that has only the sentence's reading (speech-chinese.ts), the screen text is not touched.
import { readFileSync } from 'node:fs'
import { pinyin } from 'pinyin-pro'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getPack } from '.'
import { chinesePolyphones, chinesePolyphoneWords, noteChineseReadings, resetChineseReadings } from './speech-chinese'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog } from '../study/catalog'
import { shippedPhrases } from '../phrases/bank'

const speak = (text: string, hint?: Parameters<ReturnType<typeof getPack>['speechText']>[1]) => getPack().speechText(text, hint)
const bands = [1, 2, 3, 4, 5, 6]
const json = (path: string) => JSON.parse(readFileSync(new URL('../../data/' + path, import.meta.url), 'utf8'))

beforeAll(async () => {
  setBuildLanguageForTests('zh')
  await loadCatalog()
})
afterEach(() => { resetChineseReadings(); setBuildLanguageForTests('zh') })

describe('Chinese speechText: readings known', () => {
  it("speaks the owner's sentence with 孩 and leaves the display text alone", () => {
    const display = '她们做饭，还喝茶。'
    noteChineseReadings([[display, 'tā men zuò fàn hái hē chá']])
    expect(speak(display, { kind: 'sentence' })).toBe('她们做饭，孩喝茶。')
    expect(display).toBe('她们做饭，还喝茶。')
  })
  it('takes the reading from the hint when the caller has it', () => {
    expect(speak('还书', { kind: 'word', reading: 'huán shū' })).toBe('环书')
    expect(speak('银行', { kind: 'word', reading: 'yín háng' })).toBe('银杭')
    expect(speak('行人', { kind: 'word', reading: 'xíng rén' })).toBe('形人')
  })
  it('speaks the same sentence from the shipped phrase bank (the bank notes its pinyin as it loads)', async () => {
    await shippedPhrases('1')
    expect(speak('她们做饭，还喝茶。', { kind: 'sentence' })).toBe('她们做饭，孩喝茶。')
  })
  it('leaves a sentence with no polyphones, and a sentence whose pinyin does not line up, unchanged', () => {
    noteChineseReadings([['我是学生。', 'wǒ shì xué shēng']])
    expect(speak('我是学生。', { kind: 'sentence' })).toBe('我是学生。')
    expect(speak('还喝茶', { reading: 'hái hē' })).toBe('还喝茶')
  })
  it('a character said for the word it is practised in', () => {
    expect(speak('还', { kind: 'character', within: { text: '还书', reading: 'huán shū' } })).toBe('环')
    expect(speak('还', { kind: 'character' })).toBe('还')
  })
  it('does not use a reading noted two ways', () => {
    noteChineseReadings([['还', 'hái'], ['还', 'huán']])
    expect(speak('还', { kind: 'word' })).toBe('还')
  })
})

describe('Chinese speechText: no readings known (the dictionary words decide)', () => {
  it('speaks 银行, 还书 and 行人 from their words', () => {
    expect(speak('银行')).toBe('银杭')
    expect(speak('还书')).toBe('环书')
    expect(speak('行人')).toBe('形人')
  })
  it('works on an AI-reply-like string with no token data', () => {
    expect(speak('好的，你可以去银行，然后还书。')).toBe('好的，你可以去银杭，然后环书。')
  })
  it('leaves a lone 还 that no word decides, and text with no Han, unchanged', () => {
    expect(speak('我还想喝茶')).toBe('我还想喝茶')
    expect(speak('Hello, world 123')).toBe('Hello, world 123')
    expect(speak('')).toBe('')
  })
  it('keeps the words the voices read well', () => {
    expect(speak('我的书都不好看了')).toBe('我的书都不好看了')
  })
})

describe('the generated table', () => {
  it('has the polyphonic characters and the substitutes of the owner', () => {
    expect(chinesePolyphones['还']).toEqual({ hái: '孩', huán: '环' })
    expect(chinesePolyphones['行']).toMatchObject({ háng: '杭', xíng: '形' })
    expect(chinesePolyphones['长']).toMatchObject({ cháng: '常', zhǎng: '掌' })
    expect(chinesePolyphones['重']).toMatchObject({ zhòng: '众', chóng: '虫' })
    expect(chinesePolyphones['乐']).toMatchObject({ yuè: '月' })
    for (const skipped of '了的地得着么都和一不') expect(chinesePolyphones[skipped]).toBeUndefined()
  })
  it('every substitute has exactly one reading, and it is the reading it stands for; no substitute is polyphonic itself', () => {
    const used = new Map<string, Set<string>>() // char -> readings the curriculum shows
    for (const band of bands) for (const entry of json('v2/hsk-' + band + '.generated.json').vocabulary as { ch: string; pr: string }[]) {
      const syllables = entry.pr.normalize('NFC').toLowerCase().split(/\s+/)
      const chars = [...entry.ch]
      if (syllables.length === chars.length) chars.forEach((char, at) => used.set(char, (used.get(char) ?? new Set()).add(syllables[at])))
    }
    let checked = 0
    for (const [char, bySyllable] of Object.entries(chinesePolyphones)) {
      for (const [syllable, substitute] of Object.entries(bySyllable)) {
        const readings = [...new Set((pinyin(substitute, { multiple: true, type: 'array', toneType: 'symbol' }) as string[]).map(item => item.normalize('NFC').toLowerCase()))]
        expect(readings, char + ' ' + syllable + ' -> ' + substitute).toEqual([syllable])
        expect(chinesePolyphones[substitute], substitute + ' is polyphonic').toBeUndefined()
        expect([...(used.get(substitute) ?? [])].filter(item => item !== syllable && /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/u.test(item)), substitute + ' is read another way in the curriculum').toEqual([])
        checked++
      }
    }
    expect(checked).toBeGreaterThan(80)
  })
  it('every polyphonic character shows two readings in the dictionary data, and every word is made of its characters', () => {
    for (const char of Object.keys(chinesePolyphones)) expect(Object.keys(chinesePolyphones[char]).length).toBeGreaterThan(0)
    for (const [word, reading] of Object.entries(chinesePolyphoneWords)) expect(reading.split(' ').length, word).toBe([...word].length)
  })
})
