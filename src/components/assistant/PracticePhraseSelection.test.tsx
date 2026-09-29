import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PracticePhraseSelection } from './PracticePhraseSelection'
import { PinyinFormatContext } from '../pinyin-context'

const text = '\u6211\u60f3\u660e\u5929\u65e9\u4e0a\u53bb\u516c\u56ed\u8dd1\u6b65\u3002'
const readings = ['wo3', 'xiang3', 'ming2', 'tian1', 'zao3', 'shang4', 'qu4', 'gong1', 'yuan2', 'pao3', 'bu4', '。']
const units = Array.from(text, (text, index) => ({ text, pinyin: readings[index] }))
const preview = (start: number, end: number) => ({
  start, end, text: units.slice(start, end).map(unit => unit.text).join(''),
  pinyin: units.slice(start, end).map(unit => unit.pinyin).join(' '),
})

afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges() })

describe('precise phrase selection', () => {
  it.each([
    ['marks', 'xiǎng míng tiān'], ['marks-and-numbers', 'xiǎng3 míng2 tiān1'], ['numbers', 'xiang3 ming2 tian1'],
  ] as const)('selects a partial phrase with two taps and displays %s without changing its readings', async (format, display) => {
    const add = vi.fn().mockResolvedValue(true)
    render(<PinyinFormatContext.Provider value={format}><PracticePhraseSelection text={text} units={units} disabled={false} preview={preview} add={add} /></PinyinFormatContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Select part' }))
    fireEvent.click(screen.getByRole('button', { name: /^Select character 4:/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Select character 2:/ }))
    expect(screen.getByRole('status')).toHaveTextContent('\u60f3\u660e\u5929')
    expect(screen.getByRole('status')).toHaveTextContent(display)
    expect(preview(1, 4).pinyin).toBe('xiang3 ming2 tian1')
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(3)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add selection to playlist' })) })
    expect(add).toHaveBeenCalledWith(1, 4)
    expect(screen.queryByText('Selected part')).not.toBeInTheDocument()
  })

  it('allows a single character and retains selection if saving fails', async () => {
    const add = vi.fn().mockResolvedValue(false)
    render(<PracticePhraseSelection text={text} units={units} disabled={false} preview={preview} add={add} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select part' }))
    fireEvent.click(screen.getByRole('button', { name: /^Select character 3:/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add selection to playlist' })) })
    expect(add).toHaveBeenCalledWith(2, 3)
    expect(screen.getByRole('status')).toHaveTextContent('\u660e')
    expect(screen.getByRole('button', { name: 'Add selection to playlist' })).toBeEnabled()
  })

  it('accepts exact native text selections without changing the phrase', async () => {
    const add = vi.fn().mockResolvedValue(true)
    render(<PracticePhraseSelection text={text} units={units} disabled={false} preview={preview} add={add} />)
    const node = screen.getByText(text).firstChild!
    act(() => {
      const range = document.createRange()
      range.setStart(node, 2)
      range.setEnd(node, 6)
      window.getSelection()!.addRange(range)
      fireEvent(document, new Event('selectionchange'))
    })
    expect(screen.getByRole('status')).toHaveTextContent('\u660e\u5929\u65e9\u4e0a')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add selection to playlist' })) })
    expect(add).toHaveBeenCalledWith(2, 6)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('keeps combining characters together in the mobile picker', async () => {
    const combined = '\u4f60e\u0301\u597d'
    const add = vi.fn().mockResolvedValue(true)
    render(<PracticePhraseSelection text={combined} units={Array.from(combined, text => ({ text, pinyin: text }))}
      disabled={false} preview={(start, end) => ({ start, end, text: 'e\u0301', pinyin: 'e\u0301' })} add={add} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select part' }))
    expect(screen.getAllByRole('button', { name: /^Select character/ })).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /^Select character 2:/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add selection to playlist' })) })
    expect(add).toHaveBeenCalledWith(1, 3)
  })

  it('does not add punctuation-only selections or act during recording/saving', () => {
    const add = vi.fn()
    const view = render(<PracticePhraseSelection text={text} units={units} disabled={false} preview={preview} add={add} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select part' }))
    expect(screen.queryByRole('button', { name: /^Select character 12:/ })).not.toBeInTheDocument()
    const node = screen.getByText(text).firstChild!
    act(() => {
      const range = document.createRange()
      range.setStart(node, 11)
      range.setEnd(node, 12)
      window.getSelection()!.addRange(range)
      fireEvent(document, new Event('selectionchange'))
    })
    expect(screen.getByRole('button', { name: 'Add selection to playlist' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('spoken character')
    view.rerender(<PracticePhraseSelection text={text} units={units} disabled preview={preview} add={add} />)
    expect(screen.getByRole('button', { name: 'Select part' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Select character 1:/ })).toBeDisabled()
    expect(add).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps exact multiword offsets and in-range punctuation (reverse: %s)', async reverse => {
    const source = '“你好， 世界！”'
    const customUnits = Array.from(source, text => ({ text, pinyin: text }))
    const add = vi.fn().mockResolvedValue(true)
    const preview = vi.fn((start: number, end: number) => ({
      start, end, text: customUnits.slice(start, end).map(unit => unit.text).join(''), pinyin: 'nǐ hǎo， shì jiè',
    }))
    const { container } = render(<PracticePhraseSelection text={source} units={customUnits} disabled={false} preview={preview} add={add} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select part' }))
    expect(container.querySelector('.practice-character-buttons')?.textContent).toBe(source)
    expect(screen.getAllByRole('button', { name: /^Select character/ }).map(button => button.textContent)).toEqual(['你', '好', '世', '界'])
    for (const punctuation of container.querySelectorAll('.practice-character-punctuation')) {
      expect(punctuation.tagName).toBe('SPAN')
      expect(punctuation.closest('button, label, [role="button"], [tabindex]')).toBeNull()
      expect(punctuation).not.toHaveAttribute('aria-pressed')
    }
    const endpoints = reverse ? [7, 2] : [2, 7]
    for (const offset of endpoints) fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Select character ${offset}:`) }))
    expect(screen.getByRole('status')).toHaveTextContent('你好， 世界')
    expect(screen.getByRole('status')).toHaveTextContent('nǐ hǎo， shì jiè')
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(4)
    expect(preview).toHaveBeenLastCalledWith(1, 7)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add selection to playlist' })) })
    expect(add).toHaveBeenCalledWith(1, 7)
  })

  it.each(['👩🏽‍💻', '🇨🇳', '#️⃣', '𠮷', 'e\u0301'])('keeps %s whole and retains code-point offsets after plain punctuation', async group => {
    const source = `你，${group}！好`
    const customUnits = Array.from(source, text => ({ text, pinyin: text }))
    const add = vi.fn().mockResolvedValue(true)
    render(<PracticePhraseSelection text={source} units={customUnits} disabled={false}
      preview={(start, end) => ({ start, end, text: customUnits.slice(start, end).map(unit => unit.text).join(''), pinyin: '' })} add={add} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select part' }))
    expect(screen.getAllByRole('button', { name: /^Select character/ }).map(button => button.textContent)).toEqual(['你', group, '好'])
    fireEvent.click(screen.getByRole('button', { name: /^Select character 3:/ }))
    expect(screen.getByRole('button', { name: /^Select character 3:/ })).toHaveAttribute('aria-pressed', 'true')
    const last = customUnits.length
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Select character ${last}:`) }))
    expect(screen.getByRole('status')).toHaveTextContent(`${group}！好`)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add selection to playlist' })) })
    expect(add).toHaveBeenCalledWith(2, last)
  })

  it('allows native selections including punctuation endpoints without adding punctuation tiles', async () => {
    const source = '你，“好”。'
    const customUnits = Array.from(source, text => ({ text, pinyin: text }))
    const add = vi.fn().mockResolvedValue(true)
    render(<PracticePhraseSelection text={source} units={customUnits} disabled={false}
      preview={(start, end) => ({ start, end, text: customUnits.slice(start, end).map(unit => unit.text).join(''), pinyin: '' })} add={add} />)
    const node = screen.getByText(source).firstChild!
    act(() => {
      const range = document.createRange()
      range.setStart(node, 1)
      range.setEnd(node, 6)
      window.getSelection()!.addRange(range)
      fireEvent(document, new Event('selectionchange'))
    })
    expect(screen.getByRole('status')).toHaveTextContent('，“好”。')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add selection to playlist' })) })
    expect(add).toHaveBeenCalledWith(1, 6)
  })
})
