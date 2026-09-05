import { describe, expect, it } from 'vitest'
import { normalizeImmersionToken } from './immersion'

describe('immersion token normalization', () => {
  it('combines extra trailing fields instead of rejecting the chunk', () => {
    const token = normalizeImmersionToken(
      ['世界', 'shìjiè', 'world', '，', ' '],
      new Set(),
      'token',
    )

    expect(token?.after).toBe('， ')
  })

  it('uses a safe fallback for an empty English annotation', () => {
    const token = normalizeImmersionToken(
      ['。', '', '', ''],
      new Set(),
      'token',
    )

    expect(token?.english).toBe('。')
  })

  it('preserves proper names in their original spelling', () => {
    const token = normalizeImmersionToken(
      ['亚瑟', 'Yàsè', 'Arthur', ''],
      new Set(['Arthur']),
      'token',
    )

    expect(token?.targetText).toBe('Arthur')
    expect(token?.romanization).toBe('')
  })
})
