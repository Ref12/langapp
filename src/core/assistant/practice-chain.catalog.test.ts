import { describe, expect, it } from 'vitest'
import { loadPhraseReadings } from '../pinyin/phrase-readings'
import { createPracticePlan } from './practice-chain'
import { loadPracticeChain } from './practice-chain-load'

describe('practice plans read text with catalog tones', () => {
  it('uses the catalog once loaded (谢谢 is xiè xie), and keeps a provided romanization as it is', async () => {
    await loadPracticeChain()
    await loadPhraseReadings()
    expect(createPracticePlan('谢谢').units.map(unit => unit.pinyin)).toEqual(['xiè', 'xie'])
    expect(createPracticePlan('谢谢', 'xièxiè').units.map(unit => unit.pinyin)).toEqual(['xiè', 'xiè'])
  })
})
