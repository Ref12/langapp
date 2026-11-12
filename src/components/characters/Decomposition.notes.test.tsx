import { readFileSync } from 'node:fs'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Decomposition } from './Decomposition'
import { resetComponentData } from '../../core/characters/components'
import { resetCharacterMeanings } from '../../core/characters/meanings'

const components = readFileSync('public/characters/chinese/components.generated.json', 'utf8')
const meanings = readFileSync('public/characters/chinese/meanings.generated.json', 'utf8')
const notes = JSON.stringify({ schemaVersion: 1, notes: {
  前: { p: [['', 'f', 'worn-down 止 foot'], ['刖', 'f', '月 for 舟 boat; 刂 added later']], o: 'A foot 止 on a boat 舟: moving forward; 刂 added later.' },
  河: { p: [['氵', 'm', 'water: a river'], ['可', 's', 'sound kě → hé']] },
  好: { p: [['女', 'm', 'x']] }, // does not fit the two parts shown: ignored
} })
const stub = (withNotes: boolean) => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('components.generated.json')) return new Response(components)
  if (url.includes('meanings.generated.json')) return new Response(meanings)
  if (url.includes('part-notes.generated.json')) return withNotes ? new Response(notes) : new Response('', { status: 404 })
  return new Response('', { status: 404 })
}))
beforeEach(() => { resetComponentData(); resetCharacterMeanings() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Decomposition with part notes', () => {
  it('前 shows the notes instead of the dictionary meaning, and the origin when expanded', async () => {
    stub(true)
    render(<Decomposition character="前" />)
    await waitFor(() => expect(document.querySelector('.cmp-line')).toHaveTextContent('月 for 舟 boat; 刂 added later'))
    expect(document.querySelector('.cmp-line')).not.toHaveTextContent('punishment')
    expect(screen.queryByTestId('part-origin')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Show decomposition/ }))
    expect(screen.getByTestId('part-origin')).toHaveTextContent('A foot 止 on a boat 舟: moving forward')
    const box = document.querySelectorAll('[data-part-box]')[1] as HTMLElement
    expect(box).toHaveTextContent('older form')
    expect(box).toHaveTextContent('月 for 舟 boat')
    expect(box).toHaveTextContent('on its own: cutting off feet as form of punishment')
  })
  it('河 shows the sound note for 可', async () => {
    stub(true)
    render(<Decomposition character="河" defaultOpen />)
    await waitFor(() => expect(document.querySelector('.cmp-line')).toHaveTextContent('sound part: sound kě → hé'))
    expect(document.querySelector('.cmp-line')).toHaveTextContent('meaning part: water: a river')
    const box = document.querySelectorAll('[data-part-box]')[1] as HTMLElement
    expect(box).toHaveTextContent('sound kě → hé')
    expect(box).toHaveTextContent('on its own: may, can')
    expect(screen.queryByTestId('part-origin')).toBeNull()
  })
  it('a character without notes looks as before', async () => {
    stub(true)
    render(<Decomposition character="想" defaultOpen />)
    await waitFor(() => expect(document.querySelector('.cmp-line')).toHaveTextContent('想 ='))
    expect(document.querySelector('.cmp-own')).toBeNull()
    expect(screen.queryByTestId('part-origin')).toBeNull()
    expect(document.querySelector('.cmp-line')).not.toHaveTextContent('part:')
  })
  it('丑 has no note: a part with no role says its meaning is its own', async () => {
    stub(true)
    render(<Decomposition character="丑" defaultOpen />)
    await waitFor(() => expect(document.querySelector('.cmp-line')).toHaveTextContent('丑 ='))
    expect(document.querySelector('.cmp-line .cmp-own')).toHaveTextContent('on its own: knife')
    expect(document.querySelector('.cmp-line')).toHaveTextContent('on its own: two')
    expect(document.querySelector('[data-part-box] .cmp-mean')).toHaveTextContent('on its own: knife')
  })
  it('notes that do not fit the shown parts are ignored', async () => {
    stub(true)
    render(<Decomposition character="好" defaultOpen />)
    await waitFor(() => expect(document.querySelector('.cmp-line')).toHaveTextContent('好 ='))
    expect(document.querySelector('.cmp-own')).toBeNull()
  })
  it('with no part-notes file (the Japanese build) the display is today\'s', async () => {
    stub(false)
    render(<Decomposition character="河" />)
    await waitFor(() => expect(document.querySelector('.cmp-line')).toHaveTextContent('河 = 氵 water + 可 kě'))
  })
})
