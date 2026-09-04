import { describe, expect, it } from 'vitest'
import { contextAroundSelection } from './textContext'

describe('selection context', () => {
  it('marks the selected occurrence and includes surrounding sentences', () => {
    const text =
      'The first sentence ends. The traveler opened the ancient door. A garden waited. The final line followed.'
    const start = text.indexOf('ancient')
    const context = contextAroundSelection(
      text,
      { text: 'ancient', start, end: start + 'ancient'.length },
      1,
    )

    expect(context).toContain('The first sentence ends.')
    expect(context).toContain('<selected-word>ancient</selected-word>')
    expect(context).toContain('A garden waited.')
    expect(context).not.toContain('The final line followed.')
  })
})
