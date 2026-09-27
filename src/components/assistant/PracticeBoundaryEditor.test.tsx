import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { practiceChainSchema } from '../../core/assistant/practice-chain-contracts'
import { PracticeBoundaryEditor } from './PracticeBoundaryEditor'

const text = '\u6211\u60f3\u660e\u5929\u65e9\u4e0a\u53bb\u516c\u56ed\u8dd1\u6b65\u3002'
const changed = vi.fn()
function Harness({ source = text, initialEnds = [2, 6, 9, 12], customCount = 0, disabled = false }: {
  source?: string
  initialEnds?: number[]
  customCount?: number
  disabled?: boolean
}) {
  const units = Array.from(source, text => ({ text, pinyin: text }))
  const [ends, setEnds] = useState(initialEnds)
  return <PracticeBoundaryEditor plan={{ units, ends, warnings: [] }} disabled={disabled} trackCount={ends.length + customCount}
    change={next => {
      practiceChainSchema.parse({ text: source, ends: next })
      changed(next)
      setEnds(next)
    }} />
}
afterEach(() => { cleanup(); changed.mockReset() })

describe('highlighted character split points', () => {
  it('shows existing boundaries and toggles within-word splits/joins in place', () => {
    render(<Harness />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(11)
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(3)
    const split = screen.getByRole('button', { name: /^Split after character 1:/ })
    expect(split).toHaveAccessibleDescription(/Tap a character to split after it/)
    fireEvent.click(split)
    expect(changed).toHaveBeenLastCalledWith([1, 2, 6, 9, 12])
    expect(split).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^Split after character 2:/ }))
    expect(changed).toHaveBeenLastCalledWith([1, 6, 9, 12])
    expect(screen.getByRole('button', { name: /^Split after character 2:/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^Split after character 11:/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Split after character 11:/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('counts custom rows toward the 80-row limit and allows joining, then splitting again', () => {
    render(<Harness customCount={76} />)
    const split = screen.getByRole('button', { name: /^Split after character 1:/ })
    expect(split).toBeDisabled()
    fireEvent.click(split)
    expect(changed).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Split after character 2:/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /^Split after character 2:/ }))
    expect(changed).toHaveBeenCalledWith([6, 9, 12])
    expect(split).toBeEnabled()
    fireEvent.click(split)
    expect(changed).toHaveBeenLastCalledWith([1, 6, 9, 12])
    expect(screen.getByRole('button', { name: /^Split after character 2:/ })).toBeDisabled()
  })

  it('renders punctuation and spaces as plain text and attaches them to the preceding new chunk', () => {
    const source = '“你好， 世界！”'
    const { container } = render(<Harness source={source} initialEnds={[Array.from(source).length]} />)
    expect(container.querySelector('.practice-character-buttons')?.textContent).toBe(source)
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['你', '好', '世', '界'])
    for (const punctuation of container.querySelectorAll('.practice-character-punctuation')) {
      expect(punctuation.tagName).toBe('SPAN')
      expect(punctuation.closest('button, label, [role="button"], [tabindex]')).toBeNull()
      expect(punctuation).not.toHaveAttribute('aria-pressed')
    }
    const split = screen.getByRole('button', { name: /^Split after character 3:/ })
    expect(split).toHaveAccessibleName(/includes following punctuation through character 5/)
    fireEvent.click(split)
    expect(changed).toHaveBeenLastCalledWith([5, 9])
    expect(Array.from(source).slice(0, 5).join('')).toBe('“你好， ')
    fireEvent.click(split)
    expect(changed).toHaveBeenLastCalledWith([9])
    expect(screen.getByRole('button', { name: /^Split after character 7:/ })).toBeDisabled()
  })

  it.each([2, 3, 4])('represents and restores an existing split at exact punctuation offset %s', offset => {
    const source = '你好，“世界”。'
    render(<Harness source={source} initialEnds={[offset, 8]} />)
    const split = screen.getByRole('button', { name: /^Split after character 2:/ })
    expect(split).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
    fireEvent.click(split)
    expect(changed).toHaveBeenLastCalledWith([8])
    expect(split).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(split)
    expect(changed).toHaveBeenLastCalledWith([offset, 8])
    expect(split).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not expose split points inside combining-character groups', () => {
    render(<Harness source={'\u4f60e\u0301\u597d'} initialEnds={[4]} />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /^Split after character 2:/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Split after character 3:/ }))
    expect(changed).toHaveBeenLastCalledWith([3, 4])
  })

  it.each(['👩🏽‍💻', '🇨🇳', '#️⃣', '𠮷'])('preserves safe boundaries and offsets around %s', group => {
    const source = `你${group}，好。`
    const end = 1 + Array.from(group).length
    const length = Array.from(source).length
    render(<Harness source={source} initialEnds={[length]} />)
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['你', group, '好'])
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Split after character ${end}:`) }))
    expect(changed).toHaveBeenLastCalledWith([end + 1, length])
  })

  it('does not create punctuation/symbol-only chunks or expose an editable final end', () => {
    const source = '👩🏽‍💻，你。🇨🇳'
    render(<Harness source={source} initialEnds={[Array.from(source).length]} />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(button)
    }
    expect(changed).not.toHaveBeenCalled()
  })

  it('disables split and join controls while recording or saving', () => {
    render(<Harness disabled />)
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(changed).not.toHaveBeenCalled()
  })
})
