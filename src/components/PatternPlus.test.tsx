import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PatternText } from './PatternText'
import { ReadingText } from './display-context'

describe('the pattern plus', () => {
  it('renders a hidden .pattern-plus between the parts, with no literal + in the text', () => {
    const { container } = render(<p><PatternText text="<subject> + 是 + <noun>" /></p>)
    const kinds = [...container.querySelector('p')!.children].filter(node => node.className || node.textContent).map(node => node.className || 'text')
    expect(kinds).toEqual(['pattern-slot', 'pattern-plus', 'text', 'pattern-plus', 'pattern-slot'])
    expect(container.querySelectorAll('.pattern-plus')).toHaveLength(2)
    expect(container.querySelector('.pattern-plus')).toHaveAttribute('aria-hidden', 'true')
    expect(container.textContent).toBe('subject 是 noun')
  })
  it('does the same on the reading line', () => {
    const { container } = render(<p><ReadingText kana="<subject> + shì + <noun>" pattern /></p>)
    expect(container.querySelectorAll('.pattern-plus')).toHaveLength(2)
    expect(container.textContent).not.toContain('+')
  })
})
