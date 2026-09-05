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

  it('accepts provider tuples with blank or extra fields for normalization', () => {
    const parsed = translateImmersionOutputSchema.parse({
      blocks: [[['你好', 'nǐ hǎo', '', '。', ' ']]],
    })

    expect(parsed.blocks[0]?.[0]).toHaveLength(5)
  })
})
