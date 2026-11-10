import { describe, expect, it } from 'vitest'
import romajiOverrides from '../../../curriculum/japanese/authoring/romaji-overrides.json'
import { jaMeta, koMeta, zhMeta } from './meta'
import { gradeKanaReading, romajiToKana } from './japanese-reading'

const grade = (answer: string, reading: string) => gradeKanaReading(answer, [reading], romajiOverrides.overrides).verdict

describe('a typed Japanese reading', () => {
  const right: [string, string[]][] = [
    ['わたし', ['わたし', 'ワタシ', 'watashi', 'WATASHI', 'wata shi']],
    ['がくせい', ['gakusei', 'gakusee', 'gakusē', 'ガクセイ']],
    ['せんせい', ['sensei']],
    ['とうきょう', ['toukyou', 'tōkyō', 'tookyoo', 'tōkyou']],
    ['し', ['shi', 'si']], ['ち', ['chi', 'ti']], ['つ', ['tsu', 'tu']], ['ふ', ['fu', 'hu']], ['じ', ['ji', 'zi']],
    ['しゃ', ['sha', 'sya']], ['ちゃ', ['cha', 'tya']], ['じゃ', ['ja', 'zya', 'jya']],
    ['きっぷ', ['kippu', 'きっぷ']], ['しんぶん', ['shinbun', 'shimbun']], ['こんや', ["kon'ya", 'konnya']],
    ['こんにちは', ['konnichiwa', 'konnichiha', 'こんにちは']], ['べんきょうします', ['benkyoushimasu', 'benkyou shimasu', 'べんきょう します']],
    ['こんにゃく', ['konnyaku', "kon'nyaku"]], ['コーヒー', ['koohii', 'こうひい']],
  ]
  for (const [reading, answers] of right) for (const answer of answers) it(answer + ' is right for ' + reading, () => expect(grade(answer, reading)).toBe('correct'))
  it('takes tokyo for とうきょう as the near verdict', () => expect(grade('tokyo', 'とうきょう')).toBe('tones'))
  it('does not take konya for こんや', () => expect(grade('konya', 'こんや')).toBe('wrong'))
  it('marks a wrong reading wrong, in kana and in romaji', () => {
    expect(grade('sensei', 'がくせい')).toBe('wrong')
    expect(grade('せんせい', 'がくせい')).toBe('wrong')
    expect(grade('hello', 'がくせい')).toBe('wrong')
  })
  it('leaves what cannot be read to the learner', () => {
    expect(grade('学生', 'がくせい')).toBe('self')
    expect(grade('gakusei1', 'がくせい')).toBe('self')
    expect(grade('がくsei', 'がくせい')).toBe('self')
  })
  it('names the reading that was meant', () => expect(gradeKanaReading('sensei', ['がくせい']).kana).toBe('がくせい'))
  it('reads romaji as kana with the ambiguous spellings', () => {
    expect(romajiToKana('konnya')).toEqual(expect.arrayContaining(['こんや', 'こんにゃ']))
    expect(romajiToKana('shimbun')).toContain('しんぶん')
    expect(romajiToKana('xyz')).toEqual([])
  })
})

describe('the packs say how a reading is marked', () => {
  it('Chinese keeps pinyin: a preview line, the tone note', () => {
    expect(zhMeta.readingInput.grade('xue2xi2', ['xué xí']).verdict).toBe('correct')
    expect(zhMeta.readingInput.preview?.('xue2xi2', ['xué xí'])).toBeTruthy()
    expect(zhMeta.readingInput.nearNote).toBe('Right syllables, tones:')
  })
  it('Japanese has no preview and keeps its audio for after the check', () => {
    expect(jaMeta.readingInput.preview).toBeUndefined()
    expect(jaMeta.readingInput.audioIsAnswer).toBe(true)
  })
  it('Korean leaves the marking to the learner', () => expect(koMeta.readingInput.grade('hangug', ['한국']).verdict).toBe('self'))
})
