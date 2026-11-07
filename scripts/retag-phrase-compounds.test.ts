import { describe, expect, it } from 'vitest'
import { buildCurriculum, readCatalog } from './build-phrase-bank.mjs'
import { readPhraseBands, defaultPhraseAuthoringDir } from './phrase-bank-files.mjs'
import { retagFiles, retagWords, weekdayCompounds } from './retag-phrase-compounds.mjs'

const curriculum = buildCurriculum(readCatalog())
const SLOW = 30_000
const compounds = weekdayCompounds(curriculum)

describe('retag-phrase-compounds', () => {
  it('finds the weekday compounds of the catalog, not the months', () => {
    expect(compounds.map(entry => entry.ch)).toEqual(expect.arrayContaining(['星期一', '星期六', '周一', '周日']))
    expect(compounds.some(entry => entry.ch.endsWith('月'))).toBe(false)
  })
  it('replaces 星期 + a number by the compound and keeps the other words', () => {
    const phrase = { zh: '星期三我们上课。', words: ['xing1-qi1--weekday', 'xing1-qi1--week', 'san1--three', 'wo3-men5--we', 'shang4-ke4--class'] }
    expect(retagWords(phrase, compounds, curriculum)).toEqual(['xing1-qi1-san1--wednesday', 'wo3-men5--we', 'shang4-ke4--class'])
  })
  it('keeps a number that the phrase also uses outside the weekday', () => {
    const phrase = { zh: '星期三我有三本书。', words: ['xing1-qi1--weekday', 'san1--three', 'wo3--me', 'you3--have', 'ben3--books', 'shu1--book'] }
    expect(retagWords(phrase, compounds, curriculum)).toEqual(['xing1-qi1-san1--wednesday', 'san1--three', 'wo3--me', 'you3--have', 'ben3--books', 'shu1--book'])
  })
  it('leaves a phrase without a weekday alone', () => {
    const phrase = { zh: '我是学生。', words: ['wo3--me', 'shi4--identity', 'xue2-sheng5--student'] }
    expect(retagWords(phrase, compounds, curriculum)).toBe(phrase.words)
  })
  it('has nothing left to retag in the shipped phrase bank', () => {
    const { changed } = retagFiles(readPhraseBands(defaultPhraseAuthoringDir), curriculum)
    expect(changed).toEqual([])
  }, SLOW)
})
