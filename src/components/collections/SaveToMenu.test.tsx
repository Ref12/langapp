import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../../core/database'
import { loadCatalog } from '../../core/study/catalog'
import { itemId } from '../../core/collections/contracts'
import { addToKnowledge } from '../../core/study/knowledge'
import { SaveActions, SaveToMenu, defaultSetName } from './SaveToMenu'

const WO = 'vocabulary:wo3--me'
let second = ''
beforeEach(async () => {
  await db.delete(); await db.open(); await initializeWorkspace()
  second = [...(await loadCatalog()).units.keys()].find(ref => ref.startsWith('vocabulary:') && ref !== WO)!
  await db.collections.bulkAdd([
    { id: 'old', name: 'HSK verbs', kind: 'user', createdAt: 1, updatedAt: 10 },
    { id: 'new', name: 'Kitchen', kind: 'user', createdAt: 2, updatedAt: 20 },
  ])
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const open = async (refs: string[] = [WO]) => {
  const user = userEvent.setup()
  render(<SaveToMenu refs={refs} name="我" title="I; me" />)
  await user.click(screen.getByRole('button', { name: 'Save 我' }))
  return { user, menu: await screen.findByRole('dialog', { name: 'Save to' }) }
}

describe('SaveToMenu', () => {
  it('lists the knowledge set first, then study sets newest-updated first with their item counts', async () => {
    await db.collectionItems.add({ id: itemId('old', WO), collectionId: 'old', ref: WO, addedAt: 1 })
    const { menu } = await open()
    await waitFor(() => expect(within(menu).getAllByRole('checkbox')).toHaveLength(3))
    const rows = within(menu).getAllByRole('checkbox')
    expect(rows.map(row => row.closest('label')?.textContent)).toEqual(['Knowledge set', 'Kitchen0 items', 'HSK verbs1 item'])
    expect(rows[2]).toBeChecked(); expect(rows[1]).not.toBeChecked()
  })

  it('adds and removes membership at once, with a toast, and stays open', async () => {
    const { user, menu } = await open()
    await user.click(await within(menu).findByRole('checkbox', { name: /HSK verbs/ }))
    await waitFor(async () => expect(await db.collectionItems.get(itemId('old', WO))).toBeTruthy())
    expect(await within(menu).findByRole('status')).toHaveTextContent('Saved to HSK verbs')
    await waitFor(() => expect(within(menu).getByRole('checkbox', { name: /HSK verbs/ })).toBeChecked())
    expect(screen.getByRole('dialog', { name: 'Save to' })).toBeInTheDocument()
    await user.click(within(menu).getByRole('checkbox', { name: /HSK verbs/ }))
    await waitFor(async () => expect(await db.collectionItems.get(itemId('old', WO))).toBeUndefined())
    expect(await within(menu).findByRole('status')).toHaveTextContent('Removed from HSK verbs')
  })

  it('creates a study set with the item, using a dated default name that can be edited', async () => {
    const { user, menu } = await open()
    await user.click(within(menu).getByRole('button', { name: /New study set/ }))
    const input = within(menu).getByRole('textbox', { name: 'New study set name' })
    expect(input).toHaveValue(defaultSetName('I; me'))
    expect((input as HTMLInputElement).value).toMatch(/^I · \d{1,2} [A-Z][a-z]{2}$/)
    await user.clear(input); await user.type(input, 'My first')
    await user.click(within(menu).getByRole('button', { name: 'Create' }))
    await waitFor(async () => expect((await db.collections.toArray()).filter(set => set.name === 'My first').length).toBe(1))
    const made = (await db.collections.toArray()).find(set => set.name === 'My first')!
    expect(await db.collectionItems.get(itemId(made.id, WO))).toBeTruthy()
    expect(await within(menu).findByRole('status')).toHaveTextContent('Saved to My first')
  })

  it('adds to the knowledge set once, then shows it checked and disabled', async () => {
    const { user, menu } = await open()
    const box = within(menu).getByRole('checkbox', { name: 'Knowledge set' })
    await user.click(box)
    await waitFor(async () => expect(await db.knowledge.get(WO)).toBeTruthy())
    const done = await within(menu).findByRole('checkbox', { name: 'In your knowledge set' })
    expect(done).toBeChecked(); expect(done).toBeDisabled()
    expect(await db.collectionItems.count()).toBe(0)
  })

  it('opens with the knowledge set already checked for a known item', async () => {
    await addToKnowledge([WO])
    const { menu } = await open()
    const box = await within(menu).findByRole('checkbox', { name: 'In your knowledge set' })
    expect(box).toBeChecked(); expect(box).toBeDisabled()
  })

  it('handles several refs: checked only when all are in, toggling adds the rest, knowledge needs all', async () => {
    await db.collectionItems.add({ id: itemId('old', WO), collectionId: 'old', ref: WO, addedAt: 1 })
    await addToKnowledge([WO])
    const { user, menu } = await open([WO, second])
    const set = await within(menu).findByRole('checkbox', { name: /HSK verbs/ })
    await waitFor(() => expect(within(menu).getByRole('checkbox', { name: 'Knowledge set' })).not.toBeDisabled())
    expect(set).not.toBeChecked()
    expect(within(menu).getByRole('checkbox', { name: 'Knowledge set' })).not.toBeDisabled()
    await user.click(set)
    await waitFor(async () => expect(await db.collectionItems.where('collectionId').equals('old').count()).toBe(2))
    await waitFor(() => expect(within(menu).getByRole('checkbox', { name: /HSK verbs/ })).toBeChecked())
    await user.click(within(menu).getByRole('checkbox', { name: 'Knowledge set' }))
    await waitFor(async () => expect(await db.knowledge.count()).toBe(2))
    await user.click(within(menu).getByRole('checkbox', { name: /Kitchen/ }))
    await waitFor(async () => expect(await db.collectionItems.where('collectionId').equals('new').count()).toBe(2))
  })

  it('saves a media word and closes on Escape', async () => {
    await db.sourceEntries.add({ id: 'abc', word: '茶', pinyin: 'cha', meanings: ['tea'], sources: [], count: 1, updatedAt: 1 } as never)
    const user = userEvent.setup()
    render(<SaveToMenu refs={['source:abc']} name="茶" />)
    await user.click(screen.getByRole('button', { name: 'Save 茶' }))
    await user.click(await screen.findByRole('checkbox', { name: /Kitchen/ }))
    await waitFor(async () => expect(await db.collectionItems.get(itemId('new', 'source:abc'))).toBeTruthy())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('is a bottom sheet on a phone, where a card shows one Save button that includes the knowledge set', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const user = userEvent.setup()
    render(<SaveActions refs={[WO]} name="我" primary={<button>Add to knowledge set</button>} />)
    expect(screen.queryByRole('button', { name: 'Add to knowledge set' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save 我' }))
    expect(await screen.findByRole('dialog', { name: 'Save to' })).toHaveClass('save-sheet')
    expect(screen.getByRole('checkbox', { name: 'Knowledge set' })).toBeInTheDocument()
  })

  it('keeps the primary button beside a Save icon on a wide screen', () => {
    render(<SaveActions refs={[WO]} name="我" primary={<button>Add to knowledge set</button>} />)
    expect(screen.getByRole('button', { name: 'Add to knowledge set' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save 我' })).toBeInTheDocument()
  })
})
