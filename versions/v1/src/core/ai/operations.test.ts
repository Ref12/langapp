import { describe, expect, it } from 'vitest'
import { parseAIJson } from './operations'

describe('AI JSON repair', () => {
  it('repairs a missing comma between immersion tuples', () => {
    const parsed = parseAIJson(
      '{"blocks":[[["你好","nǐ hǎo","hello","，"] ["世界","shìjiè","world","。"]]]}',
    ) as { blocks: unknown[] }

    expect(parsed.blocks).toHaveLength(1)
  })
})
