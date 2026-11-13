// @vitest-environment node
// The one speech-preparation step (the pack's speechText) for every language: Japanese says its ambiguous words in kana inside a sentence, Korean is passed through, Chinese is in speech-chinese.test.ts.
import { afterEach, describe, expect, it } from 'vitest'
import { getPack, spokenText } from '.'
import { noteJapaneseReadings, resetJapaneseReadings, type SentenceToken } from './speech-text'
import { setBuildLanguageForTests } from '../storage-names'

const speak = (text: string, hint?: Parameters<ReturnType<typeof getPack>['speechText']>[1]) => getPack().speechText(text, hint)
afterEach(() => { resetJapaneseReadings(); setBuildLanguageForTests('ja') })

describe('Japanese speechText: ambiguous words inside a sentence', () => {
  it('says 今日 from its token reading and leaves the particles and the rest as written', () => {
    setBuildLanguageForTests('ja')
    const tokens: SentenceToken[] = [{ text: '今日', reading: 'きょう' }, { text: 'は', reading: 'は', grammar: 'topic' }, { text: '学校', reading: 'がっこう' }, { text: 'に', reading: 'に', grammar: 'goal' }, { text: '行きます', reading: 'いきます' }, { punctuation: '。' }]
    expect(speak('今日は学校に行きます。', { kind: 'sentence', tokens })).toBe('きょうは学校に行きます。')
  })
  it('says 何時 as なんじ', () => {
    setBuildLanguageForTests('ja')
    const tokens: SentenceToken[] = [{ text: '何時', reading: 'なんじ' }, { text: 'です', reading: 'です', grammar: 'copula' }, { text: 'か', reading: 'か', grammar: 'question' }]
    expect(speak('何時ですか', { kind: 'sentence', tokens })).toBe('なんじですか')
  })
  it('leaves a sentence with no ambiguous word, or tokens that do not spell it, as written', () => {
    setBuildLanguageForTests('ja')
    const tokens: SentenceToken[] = [{ text: '学校', reading: 'がっこう' }, { text: 'に', reading: 'に', grammar: 'goal' }, { text: '行きます', reading: 'いきます' }, { punctuation: '。' }]
    expect(speak('学校に行きます。', { kind: 'sentence', tokens })).toBe('学校に行きます。')
    expect(speak('明日は雨です。', { kind: 'sentence', tokens })).toBe('明日は雨です。')
  })
  it('without tokens, a lexicon entry that pins the reading decides; otherwise it stays as written', () => {
    setBuildLanguageForTests('ja')
    expect(speak('今日は雨です。')).toBe('今日は雨です。')
    noteJapaneseReadings('catalog', [['今日', 'きょう']])
    expect(speak('今日は雨です。')).toBe('きょうは雨です。')
    expect(speak('学校に行きます。')).toBe('学校に行きます。')
  })
})

describe('Korean speechText: the seam exists and passes the text through', () => {
  it('leaves Korean text unchanged, with or without a hint', () => {
    setBuildLanguageForTests('ko')
    expect(speak('저는 학생입니다.')).toBe('저는 학생입니다.')
    expect(speak('안녕하세요', { kind: 'word', reading: 'annyeonghaseyo' })).toBe('안녕하세요')
    expect(spokenText('ko-KR', '감사합니다')).toBe('감사합니다')
  })
  it('does not touch another language\'s text', () => {
    setBuildLanguageForTests('zh')
    expect(spokenText('en-US', 'Take a look at the bank.')).toBe('Take a look at the bank.')
    expect(spokenText('ja-JP', '今日は雨です。')).toBe('今日は雨です。')
  })
})
