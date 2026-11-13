// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { getPack } from '../language'
import { isImpliedSubject } from '../language/subject-rules'
import { shippedPhrases } from '../phrases/bank'
import type { BankPhrase } from '../phrases/contracts'

describe('Chinese: the subject is not dropped', () => {
  let bank: BankPhrase[]
  beforeAll(async () => { bank = Object.values(await shippedPhrases('1')).flat() }, 60000)
  it('no flag, no brackets, and the distractor rule is off', () => {
    const pack = getPack()
    expect(pack.id).toBe('zh')
    expect(pack.dropsSubject).toBeUndefined()
    expect(bank.length).toBeGreaterThan(100)
    expect(bank.some(phrase => phrase.impliedSubject)).toBe(false)
    expect(isImpliedSubject('ja', { tokens: undefined })).toBe(false)
    expect(pack.meaningText({ zh: '学习。', en: 'You study.', impliedSubject: true })).toBe('You study.')
    expect(pack.meaningText({ zh: '学习。', en: 'You study.' })).toBe('You study.')
    expect(pack.sameMeaningApartFromWho({ zh: '学习。', en: 'You study.', impliedSubject: true }, { zh: '我学习。', en: 'I study.' })).toBe(false)
  })
})
