import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LearnFromSpan, readyToLearn } from './LearnFromSpan'

describe('LearnFromSpan', () => {
  const base = { id: 'x', title: 't', url: 'u', extractor: '', source: 'captions', language: 'zh', lines: [{ start: 0, end: 1, text: '你好' }], savedAt: 1 } as never
  it('is hidden until both passes are done', () => {
    expect(readyToLearn({})).toBe(false)
    expect(readyToLearn({ entries: { complete: true } } as never)).toBe(true)
    const { container } = render(<LearnFromSpan item={base} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('shows a prominent entry point when ready', () => {
    vi.stubGlobal('indexedDB', undefined)
    render(<LearnFromSpan item={{ ...(base as object), entries: { complete: true } } as never} />)
    expect(screen.getByRole('button', { name: 'Learn from this' })).toBeTruthy()
  })
})
