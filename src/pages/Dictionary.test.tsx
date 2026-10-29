import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { buildCatalog, catalogCounts, type BandData } from '../core/study/catalog'
import { Dictionary } from './Dictionary'
import { Writing } from './Writing'
import { useRoute } from '../core/routing'

const source = vi.hoisted(() => ({ catalog: undefined as ReturnType<typeof buildCatalog> | undefined }))
const handwriting = vi.hoisted(() => ({ calls: [] as { strokes: number; allowed: string }[] }))
vi.mock('../core/characters/handwriting', () => ({
  createHandwritingRecognizer: () => ({
    recognize: async (drawing: unknown[], allowed: string) => {
      handwriting.calls.push({ strokes: drawing.length, allowed })
      return [{ character: '\u8336', score: 1 }, { character: '\u676f', score: 2 }]
    },
    dispose: () => undefined,
  }),
}))
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
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('dictionary characters', () => {
  it('opens on My knowledge set for the knowledge hash and on the full list otherwise', async () => {
    window.location.hash = 'dictionary/vocabulary/knowledge'
    const view = render(<Harness />)
    expect(await screen.findByRole('button', { name: /^My knowledge set \(/ })).toHaveAttribute('aria-pressed', 'true')
    view.unmount()
    window.location.hash = 'dictionary/vocabulary/all'
    render(<Harness />)
    expect(await screen.findByRole('button', { name: /^My knowledge set \(/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps My knowledge set when switching sections and remembers it for bare routes', async () => {
    const user = userEvent.setup()
    window.location.hash = 'dictionary/vocabulary/knowledge'
    const view = render(<Harness />)
    expect(await screen.findByRole('button', { name: /^My knowledge set \(/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /^Grammar/ }))
    expect(window.location.hash).toBe('#dictionary/grammar/knowledge')
    expect(await screen.findByRole('button', { name: /^My knowledge set \(/ })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.dictionaryScope).toBe('knowledge'))
    view.unmount()
    window.location.hash = 'dictionary'
    render(<Harness />)
    expect(await screen.findByRole('button', { name: /^My knowledge set \(/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Full list' }))
    expect(window.location.hash).toBe('#dictionary/vocabulary/all')
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.dictionaryScope).toBe('all'))
  })

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
  it('shows knowledge-set counts on tabs and band options in that scope and totals in the full list', async () => {
    const user = userEvent.setup()
    window.location.hash = 'dictionary/vocabulary'
    await db.knowledge.add({ ref: 'vocabulary:tea', kind: 'vocabulary', lb: 'tea', band: '1', source: 'new', addedAt: 1 })
    render(<Harness />)
    await screen.findByRole('button', { name: `Vocabulary (${catalogCounts.vocabulary.toLocaleString('en-US')})` })
    await user.click(screen.getByRole('button', { name: 'My knowledge set (1)' }))
    expect(screen.getByRole('button', { name: 'Vocabulary (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grammar (0)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Characters (1)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'HSK 1 (1)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'HSK 2 (0)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Full list' }))
    expect(screen.getByRole('button', { name: `Vocabulary (${catalogCounts.vocabulary.toLocaleString('en-US')})` })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^HSK 1 \(\d[\d,]*\)$/ })).toBeInTheDocument()
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
  it('draws a character: candidates stay inside the catalog, picking one fills the search and filters the list, and the pad stays open', async () => {
    const user = userEvent.setup()
    handwriting.calls.length = 0
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
    let captured = false
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      pointerId: number
      isPrimary: boolean
      constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1; this.isPrimary = options.isPrimary ?? true }
    })
    Object.defineProperties(SVGElement.prototype, {
      setPointerCapture: { configurable: true, value: () => { captured = true } },
      hasPointerCapture: { configurable: true, value: () => captured },
      releasePointerCapture: { configurable: true, value: () => { captured = false } },
    })
    render(<Harness />)
    expect(await screen.findAllByRole('article')).toHaveLength(3)
    const search = screen.getByRole('searchbox', { name: 'Search dictionary' })
    await user.click(screen.getByRole('button', { name: 'Draw' }))
    const pad = screen.getByRole('img', { name: 'Handwriting area' })
    expect(screen.getByRole('button', { name: 'Draw' })).toHaveAttribute('aria-expanded', 'true')
    expect(search).not.toHaveFocus()
    fireEvent.pointerDown(pad, { pointerId: 1, button: 0, clientX: 20, clientY: 50 })
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 50, clientY: 50 })
    fireEvent.pointerUp(pad, { pointerId: 1, clientX: 80, clientY: 50 })
    const candidate = await screen.findByRole('button', { name: /^\u676f/ })
    expect(handwriting.calls.at(-1)?.strokes).toBe(1)
    expect([...handwriting.calls.at(-1)!.allowed].sort()).toEqual(['\u4e00', '\u676f', '\u8336'])
    await user.click(candidate)
    expect(search).toHaveValue('\u676f')
    expect(screen.getByRole('img', { name: 'Handwriting area' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Character \u4e00' })).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Character \u676f' })).toBeInTheDocument()
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
    await user.click(screen.getByRole('link', { name: 'Back' }))
    await screen.findByRole('heading', { name: 'Characters, one stroke at a time.' })
    expect(screen.getByRole('button', { name: 'My knowledge set (1)' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(db.isOpen()).toBe(true))
  })
})
