import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { buildCatalog, type BandData } from '../core/study/catalog'
import { Dictionary } from './Dictionary'
import { Writing } from './Writing'
import { useRoute } from '../core/routing'

const source = vi.hoisted(() => ({ catalog: undefined as ReturnType<typeof buildCatalog> | undefined }))
vi.mock('../components/study/useCatalog', () => ({ useCatalog: () => ({ catalog: source.catalog }) }))
vi.mock('../core/characters/assets', () => ({
  characterAttributionUrl: './characters/chinese/attribution.html',
  characterAssetIndex: [
    { character: '\u8336', strokeCount: 9, reviewed: true, variant: 'reviewed-monoline' },
    { character: '\u4e00', strokeCount: 1, reviewed: true, variant: 'reviewed-monoline' },
  ],
  loadCharacterAsset: async (character: string) => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] }),
}))

function Harness() {
  const workspace = useLiveQuery(loadWorkspace, [])
  const route = useRoute()
  if (!workspace) return null
  const [page, section, scope] = route.split('/')
  const props = { workspace, now: 1, busy: false, run: async (operation: () => Promise<void>) => { await operation() } }
  return page === 'writing' ? <Writing {...props} codepoint={section} scope={scope} /> : <Dictionary {...props} section={section} initialScope={scope} />
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
  window.location.hash = 'dictionary/characters'
  const data: BandData = {
    schemaVersion: 1, band: '1', alignment: 'Fixture', groups: [], grammar: [],
    vocabulary: [
      { id: 'v1', ch: '\u8336\u676f', pr: 'cha bei', ds: 'teacup', lb: 'teacup' },
      { id: 'v2', ch: '\u8336', pr: 'cha', ds: 'tea', lb: 'tea' },
    ],
  }
  source.catalog = buildCatalog([data])
})
afterEach(cleanup)

describe('dictionary characters', () => {
  it('shows available and unavailable guides and filters full versus derived knowledge without duplicates', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByRole('heading', { name: 'Characters, one stroke at a time.' })
    expect(screen.getByRole('button', { name: 'Characters (3)' })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Character \u676f' })).getByRole('button', { name: 'Guide unavailable' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'My knowledge set (0)' }))
    await screen.findByRole('heading', { name: 'Your knowledge set is empty' })
    await act(async () => {
      await db.knowledge.bulkAdd([
        { ref: 'vocabulary:teacup', kind: 'vocabulary', lb: 'teacup', band: '1', source: 'dictionary', addedAt: 1 },
        { ref: 'vocabulary:tea', kind: 'vocabulary', lb: 'tea', band: '1', source: 'new', addedAt: 1 },
      ])
    })
    await screen.findByRole('button', { name: 'My knowledge set (2)' })
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.queryByRole('article', { name: 'Character \u4e00' })).not.toBeInTheDocument()
    await act(async () => { await db.knowledge.delete('vocabulary:teacup') })
    await screen.findByRole('button', { name: 'My knowledge set (1)' })
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })
  it('saves independent manual additions and retains automatic membership when unpinned', async () => {
    const user = userEvent.setup()
    await db.knowledge.add({ ref: 'vocabulary:tea', kind: 'vocabulary', lb: 'tea', band: '1', source: 'dictionary', addedAt: 1 })
    const view = render(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Keep \u8336 independently' }))
    await user.click(screen.getByRole('button', { name: 'Add \u4e00 to knowledge set' }))
    await screen.findByRole('button', { name: 'My knowledge set (2)' })
    await user.click(screen.getByRole('button', { name: 'Remove manual addition \u8336' }))
    await screen.findByRole('button', { name: 'Keep \u8336 independently' })
    expect(screen.getByRole('button', { name: 'My knowledge set (2)' })).toBeInTheDocument()
    view.unmount()
    render(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'My knowledge set (2)' }))
    expect(screen.getByRole('article', { name: 'Character \u4e00' })).toBeInTheDocument()
    await act(async () => { await db.knowledge.clear() })
    await screen.findByRole('button', { name: 'My knowledge set (1)' })
    expect(screen.queryByRole('article', { name: 'Character \u8336' })).not.toBeInTheDocument()
  })
  it('searches word context, launches practice from the chosen character and returns to its scope', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Add \u8336 to knowledge set' }))
    await user.click(await screen.findByRole('button', { name: 'My knowledge set (1)' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search dictionary' }), 'teacup')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    await user.click(screen.getByRole('link', { name: 'Practice writing \u8336' }))
    await screen.findByRole('img', { name: 'Handwriting area' })
    expect(window.location.hash).toBe('#writing/8336/knowledge')
    await user.click(screen.getByRole('link', { name: 'Back to characters' }))
    await screen.findByRole('heading', { name: 'Characters, one stroke at a time.' })
    expect(screen.getByRole('button', { name: 'My knowledge set (1)' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(db.isOpen()).toBe(true))
  })
})
