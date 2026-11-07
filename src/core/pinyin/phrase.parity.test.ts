import { describe, expect, it } from 'vitest'
import { buildCurriculum, phrasePinyin as pipelinePinyin, readCatalog } from '../../../scripts/build-phrase-bank.mjs'
import { buildCatalog, type BandData } from '../study/catalog'
import hsk1 from '../../data/phrases/hsk-1.json'
import { phrasePinyin } from './phrase'
import { phraseReadingsOf } from './phrase-readings'

describe('the app and the pipeline read phrases alike', () => {
  it('gives the same pinyin for every shipped HSK 1 phrase, and the stored py', () => {
    const bands = readCatalog() as BandData[]
    const curriculum = buildCurriculum(bands)
    const readings = phraseReadingsOf(buildCatalog(bands))
    const phrases = (hsk1 as { phrases: { zh: string; py: string }[] }).phrases
    expect(phrases.length).toBeGreaterThan(0)
    for (const phrase of phrases) {
      const expected = pipelinePinyin(phrase.zh, curriculum)
      expect(phrasePinyin(phrase.zh, readings), phrase.zh).toBe(expected)
      expect(expected, phrase.zh).toBe(phrase.py)
    }
  })
})
