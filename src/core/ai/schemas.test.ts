import { describe, expect, it } from 'vitest'
import { translateImmersionOutputSchema } from './schemas'

describe('immersion translation schema', () => {
  it('accepts compact annotated token tuples', () => {
    const parsed = translateImmersionOutputSchema.parse({
      blocks: [
        [
          ['你好', 'nǐ hǎo', 'hello', '，'],
          ['世界', 'shìjiè', 'world', '。'],
        ],
      ],
    })

    expect(parsed.blocks[0]?.[1]?.[0]).toBe('世界')
  })

  it('rejects tokens without an English meaning', () => {
    expect(() =>
      translateImmersionOutputSchema.parse({
        blocks: [[['你好', 'nǐ hǎo', '', '。']]],
      }),
    ).toThrow()
  })
})
