import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLiveQuery } from 'dexie-react-hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { buildCatalog, type BandData } from '../core/study/catalog'
import { itemId } from '../core/collections/contracts'
import { Dictionary } from './Dictionary'

const source = vi.hoisted(() => ({ catalog: undefined as ReturnType<typeof buildCatalog> | undefined }))
vi.mock('../components/study/useCatalog', () => ({ useCatalog: () => ({ catalog: source.catalog }) }))

function Harness() {
  const workspace = useLiveQuery(loadWorkspace, [])
  if (!workspace) return null
  return <Dictionary workspace={workspace} now={1} busy={false} run={async operation => { await operation() }} section="vocabulary" initialScope="all" />
}

beforeEach(async () => {
  await db.delete(); await db.open(); await initializeWorkspace()
  window.location.hash = 'dictionary/vocabulary/all'
  const data: BandData = { schemaVersion: 1, band: '1', alignment: 'Fixture', groups: [], grammar: [], vocabulary: [{ id: 'v1', ch: '我', pr: 'wo', ds: 'I; me', lb: 'wo3--me' }] }
  source.catalog = buildCatalog([data])
  await db.collections.add({ id: 'c1', name: 'HSK verbs', kind: 'user', createdAt: 1, updatedAt: 1 })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Save from the Dictionary', () => {
  it('saves a word to a study set from its card, keeping Add to knowledge set as the primary action', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const card = (await screen.findByRole('heading', { name: '我' })).closest('article')!
    expect(within(card).getByRole('button', { name: 'Add to knowledge set' })).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Save 我' }))
    await user.click(await screen.findByRole('checkbox', { name: /HSK verbs/ }))
    await waitFor(async () => expect(await db.collectionItems.get(itemId('c1', 'vocabulary:wo3--me'))).toMatchObject({ collectionId: 'c1' }))
    expect(await screen.findByText('Saved to HSK verbs')).toBeTruthy()
    expect(await db.knowledge.count()).toBe(0)
  })
})
