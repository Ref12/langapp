import { describe, expect, it } from 'vitest'
import { splitTextForAnalysis } from './textChunks'

describe('analysis text chunks', () => {
  it('keeps every chunk within the requested size and preserves the source', () => {
    const text = `${'A sentence. '.repeat(20)}${'Another sentence. '.repeat(20)}`
    const chunks = splitTextForAnalysis(text, 120)

    expect(chunks.every((chunk) => chunk.text.length <= 120)).toBe(true)
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(text)
    expect(chunks[1]?.start).toBe(chunks[0]?.text.length)
  })
})
