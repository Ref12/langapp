import { describe, expect, it } from 'vitest'
import { compareTranscript } from './transcript-diff'

describe('local transcript comparison', () => {
  it('compares Chinese characters while ignoring punctuation, spacing, case, and compatibility width', () => {
    expect(compareTranscript('\u4f60\u597d\uff0c\u670b\u53cb\uff01ABC', '\u4f60 \u597d \u670b\u53cb abc').outcome).toBe('match')
    expect(compareTranscript('\uff21\uff22\uff23', 'abc').outcome).toBe('match')
  })
  it('marks substitutions as missing and extra without inventing acoustic scores', () => {
    expect(compareTranscript('\u6211\u559d\u8336', '\u6211\u5403\u8336')).toEqual({
      outcome: 'different', differences: [
        { kind: 'match', text: '\u6211' }, { kind: 'missing', text: '\u559d' },
        { kind: 'extra', text: '\u5403' }, { kind: 'match', text: '\u8336' },
      ],
    })
  })
  it('handles omissions, insertions, and repeated characters deterministically', () => {
    expect(compareTranscript('abc', 'ac').differences).toEqual([
      { kind: 'match', text: 'a' }, { kind: 'missing', text: 'b' }, { kind: 'match', text: 'c' },
    ])
    expect(compareTranscript('aba', 'aaba').differences).toEqual([
      { kind: 'match', text: 'a' }, { kind: 'extra', text: 'a' }, { kind: 'match', text: 'ba' },
    ])
  })
  it('does not claim accuracy or a match for silence or punctuation-only references', () => {
    expect(compareTranscript('\u8336', ' ... ').outcome).toBe('no-speech')
    expect(compareTranscript('...', '').outcome).toBe('no-reference')
  })
  it('preserves meaningful symbols, diacritics, and code points rather than breaking surrogate pairs', () => {
    expect(compareTranscript('cafe', 'caf\u00e9').outcome).toBe('different')
    expect(compareTranscript('\ud840\udc00+', '\ud840\udc00').differences).toEqual([{ kind: 'match', text: '\ud840\udc00' }, { kind: 'missing', text: '+' }])
  })
  it('supports the full bounded reference/transcript without a quadratic-memory matrix', () => {
    const result = compareTranscript('a'.repeat(3000), 'b'.repeat(8000))
    expect(result.differences).toEqual([{ kind: 'missing', text: 'a'.repeat(3000) }, { kind: 'extra', text: 'b'.repeat(8000) }])
    expect(() => compareTranscript('a'.repeat(3001), '')).toThrow('limits')
    expect(() => compareTranscript('a', 'b'.repeat(8001))).toThrow('limits')
    expect(compareTranscript('\ufdfa'.repeat(3000), 'b').outcome).toBe('too-long')
    expect(compareTranscript('a', '\ufdfa'.repeat(8000)).outcome).toBe('too-long')
  })
  it('preserves both strings and matches a baseline LCS for every short binary string', () => {
    const values = ['']
    let layer = ['']
    for (let size = 0; size < 4; size++) {
      layer = layer.flatMap(value => [`${value}a`, `${value}b`])
      values.push(...layer)
    }
    for (const expected of values) for (const actual of values) {
      const comparison = compareTranscript(expected, actual)
      expect(comparison.differences.filter(part => part.kind !== 'extra').map(part => part.text).join('')).toBe(expected)
      expect(comparison.differences.filter(part => part.kind !== 'missing').map(part => part.text).join('')).toBe(actual)
      const lengths = Array.from({ length: expected.length + 1 }, () => Array<number>(actual.length + 1).fill(0))
      for (let i = 1; i <= expected.length; i++) for (let j = 1; j <= actual.length; j++) {
        lengths[i][j] = expected[i - 1] === actual[j - 1] ? lengths[i - 1][j - 1] + 1 : Math.max(lengths[i - 1][j], lengths[i][j - 1])
      }
      expect(comparison.differences.filter(part => part.kind === 'match').reduce((sum, part) => sum + part.text.length, 0)).toBe(lengths[expected.length][actual.length])
    }
  })
})
