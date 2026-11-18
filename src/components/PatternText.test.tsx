import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PatternText } from './PatternText'

describe('PatternText', () => {
  it('renders each slot as a chip with its name and no angle brackets, fixed text intact', () => {
    const { container } = render(<p><PatternText text="<clause one>，<optional subject> + 还 + <predicate>" /></p>)
    const chips = [...container.querySelectorAll('.pattern-slot')].map(chip => chip.textContent)
    expect(chips).toEqual(['clause one', 'optional subject', 'predicate'])
    expect(container.textContent).not.toMatch(/[<>]/)
    expect(container.textContent).toContain('还')
    expect(screen.getByText('predicate')).toBeInTheDocument()
  })
  it('leaves plain text alone', () => {
    const { container } = render(<p><PatternText text="喂？" /></p>)
    expect(container.textContent).toBe('喂？')
  })
})
