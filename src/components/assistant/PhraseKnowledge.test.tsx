import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../../core/database'
import { loadCatalog } from '../../core/study/catalog'
import { addToKnowledge } from '../../core/study/knowledge'
import { PhraseKnowledge } from './PhraseKnowledge'

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(cleanup)

const refOf = async (ch: string) => [...(await loadCatalog()).units.values()].find(unit => unit.kind === 'vocabulary' && unit.record.ch === ch)!.ref
const known = async () => (await db.knowledge.toArray()).map(entry => entry.ref).sort()

describe('Add to knowledge set for a phrase', () => {
  it('adds a one-word phrase directly', async () => {
    render(<PhraseKnowledge text={'\u5b66\u751f'} />)
    fireEvent.click(await screen.findByRole('button', { name: /Add to knowledge set/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Added \u5b66\u751f to your knowledge set')
    expect(await known()).toEqual([await refOf('\u5b66\u751f')])
    await waitFor(() => expect(screen.queryByRole('button', { name: /Add to knowledge set/ })).toBeNull())
  })

  it('lists words with Add and Add all, and omits known words', async () => {
    await addToKnowledge([await refOf('\u8001\u5e08')])
    render(<PhraseKnowledge text={'\u5b66\u751f \u8001\u5e08 \u670b\u53cb'} />)
    fireEvent.click(await screen.findByRole('button', { name: /Add to knowledge set/ }))
    expect(await screen.findByRole('button', { name: 'Add all' })).toBeInTheDocument()
    expect(screen.queryByText('\u8001\u5e08')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add \u5b66\u751f' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Added \u5b66\u751f'))
    expect(await known()).toEqual([await refOf('\u5b66\u751f'), await refOf('\u8001\u5e08')].sort())
  })

  it('adds everything with Add all', async () => {
    render(<PhraseKnowledge text={'\u5b66\u751f \u8001\u5e08'} />)
    fireEvent.click(await screen.findByRole('button', { name: /Add to knowledge set/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add all' }))
    await waitFor(async () => expect(await known()).toEqual([await refOf('\u5b66\u751f'), await refOf('\u8001\u5e08')].sort()))
  })

  it('omits the item when every word is known and shows unknown words without a button', async () => {
    await addToKnowledge([await refOf('\u5b66\u751f')])
    const { unmount } = render(<PhraseKnowledge text={'\u5b66\u751f'} />)
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(screen.queryByRole('button')).toBeNull()
    unmount()
    render(<PhraseKnowledge text={'\u8001\u5e08 \u9f98\u9f98'} />)
    fireEvent.click(await screen.findByRole('button', { name: /Add to knowledge set/ }))
    expect(await screen.findByText(/not in the dictionary/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add \u9f98\u9f98' })).toBeNull()
  })
})
