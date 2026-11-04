import { readFileSync } from 'node:fs'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Decomposition } from './Decomposition'
import { resetComponentData } from '../../core/characters/components'
import { resetCharacterMeanings } from '../../core/characters/meanings'

const components = readFileSync('public/characters/chinese/components.generated.json', 'utf8')
const meanings = readFileSync('public/characters/chinese/meanings.generated.json', 'utf8')
export const stubFiles = () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('components.generated.json')) return new Response(components)
    if (url.includes('meanings.generated.json')) return new Response(meanings)
    return new Response('', { status: 404 })
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
beforeEach(() => { resetComponentData(); resetCharacterMeanings(); stubFiles() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Decomposition when the parts file cannot be fetched', () => {
  it('retries once, then recovers', async () => {
    const real = stubFiles()
    let first = true
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => { if (String(input).includes('components.generated') && first) { first = false; return Promise.reject(new TypeError('Failed to fetch')) } return real(input) }))
    render(<Decomposition character="河" />)
    await waitFor(() => expect(document.querySelector('.cmp-line')).toHaveTextContent('河 = 氵 water + 可 kě'))
  })
  it('shows a quiet line, never the raw "Failed to fetch"; the extra control stays on the line', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    render(<Decomposition character="河" extra={<button type="button" aria-label="Colour parts">c</button>} />)
    expect(await screen.findByText('Parts unavailable offline')).toBeInTheDocument()
    expect(screen.queryByText(/Failed to fetch/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Colour parts' }).closest('.cmp-row')).not.toBeNull()
  })
  it('puts an extra control after the Parts toggle on the decomposition line', async () => {
    render(<Decomposition character="河" label="Parts" hideLabel="Parts" extra={<button type="button" aria-label="Colour parts">c</button>} />)
    const toggle = await screen.findByRole('button', { name: /Parts/ })
    expect(toggle.nextElementSibling).toBe(screen.getByRole('button', { name: 'Colour parts' }))
  })
})

describe('Decomposition', () => {
  it('starts as a text line: 河 = 氵 water + 可 kě', async () => {
    render(<Decomposition character="河" />)
    const line = await screen.findByText(/氵/, { selector: '.cmp-glyph' })
    const row = line.closest('.cmp-line')!
    await waitFor(() => expect(row).toHaveTextContent('河 = 氵 water + 可 kě'))
    expect(document.querySelector('.cmp-boxes')).toBeNull()
  })
  it('想 = 相 + 心 gives no sound pinyin on the meaning part', async () => {
    render(<Decomposition character="想" />)
    const row = (await screen.findByText('心', { selector: '.cmp-glyph' })).closest('.cmp-line')!
    expect(row).toHaveTextContent('想 = 相')
    expect(row).toHaveTextContent('心 heart')
    await waitFor(() => expect(row).toHaveTextContent('xiāng'))
  })
  it('tapping the line or the button expands the boxes with roles and variant-form text, and closes again', async () => {
    const user = userEvent.setup()
    render(<Decomposition character="河" />)
    await user.click(await screen.findByRole('button', { name: /Show decomposition/ }))
    const boxes = document.querySelector('.cmp-boxes') as HTMLElement
    expect(within(boxes).getByText('meaning part')).toBeInTheDocument()
    expect(within(boxes).getByText('sound part')).toBeInTheDocument()
    expect(within(boxes).getByText('left form of 水')).toBeInTheDocument()
    expect(within(boxes).getByText('bound form')).toBeInTheDocument()
    await user.click(within(boxes).getByText('left form of 水'))
    expect(document.querySelector('.cmp-forms')).toHaveTextContent('Forms of 水')
    await user.click(document.querySelector('.cmp-line')!)
    expect(document.querySelector('.cmp-boxes')).toBeNull()
  })
  it('娶 shows the sound + meaning role', async () => {
    const user = userEvent.setup()
    render(<Decomposition character="娶" />)
    await user.click(await screen.findByRole('button', { name: /Show decomposition/ }))
    expect(screen.getByText('sound + meaning', { selector: '.cmp-chip' })).toBeInTheDocument()
  })
  it('an ideographic compound shows every part as a meaning part; a pictographic character shows no roles', async () => {
    const user = userEvent.setup()
    render(<Decomposition character="明" />)
    await user.click(await screen.findByRole('button', { name: /Show decomposition/ }))
    expect(screen.getAllByText('meaning part')).toHaveLength(2)
    expect(screen.queryByText('sound part')).toBeNull()
  })
  it('nests in place: 想 opens 相 into 木 and 目', async () => {
    const user = userEvent.setup()
    render(<Decomposition character="想" defaultOpen />)
    await user.click(await screen.findByRole('button', { name: /2 parts/ }))
    const sub = document.querySelector('.cmp-sub') as HTMLElement
    expect(sub).toHaveTextContent('tree')
    expect(sub).toHaveTextContent('eye')
  })
  it('links full characters to their Dictionary card and nothing else', async () => {
    const user = userEvent.setup()
    render(<Decomposition character="河" defaultOpen />)
    await screen.findByText('sound part')
    const links = [...document.querySelectorAll('a.cmp-link')].map(link => link.textContent)
    expect(new Set(links)).toEqual(new Set(['可']))
    expect(document.querySelector('a.cmp-link')).toHaveAttribute('href', '#dictionary/characters/all?q=' + encodeURIComponent('可'))
    cleanup()
    render(<Decomposition character="汉" defaultOpen />)
    await screen.findByText('no meaning', { selector: '.cmp-mean' })
    expect(document.querySelectorAll('a.cmp-link')).toHaveLength(0)
    expect(document.querySelector('.cmp-box.none')).not.toBeNull()
    void user
  })
  it('never shows code points or block names', async () => {
    const user = userEvent.setup()
    for (const character of ['河', '恭', '春', '汉', '都', '娶']) {
      const { container, unmount } = render(<Decomposition character={character} defaultOpen />)
      await screen.findAllByText(/./, { selector: '.cmp-mean' })
      for (const forms of container.querySelectorAll('button.cmp-chip.form')) await user.click(forms)
      expect(container.textContent).not.toMatch(/U\+|[Rr]adicals Supplement|CJK|Unified|\bURO\b|Ext(ension)? [A-Z]/)
      unmount()
    }
  })
  it('a part with no font character is drawn from the parts font and tagged', async () => {
    render(<Decomposition character="春" defaultOpen />)
    expect(await screen.findByText('drawn from strokes')).toBeInTheDocument()
    const glyph = document.querySelector('.cmp-box .cmp-glyph')!.textContent!
    expect(glyph.codePointAt(0)).toBeGreaterThanOrEqual(0xe000)
  })
  it('colours the parts only when asked', async () => {
    const { rerender } = render(<Decomposition character="河" />)
    await screen.findByText(/氵/, { selector: '.cmp-glyph' })
    expect(document.querySelector('.cmp-tp.coloured')).toBeNull()
    rerender(<Decomposition character="河" colour />)
    expect(document.querySelectorAll('.cmp-tp.coloured')).toHaveLength(2)
  })
})
