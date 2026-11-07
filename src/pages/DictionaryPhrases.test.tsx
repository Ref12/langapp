import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { buildCatalog, type BandData } from '../core/study/catalog'
import { Dictionary } from './Dictionary'
import { useRoute } from '../core/routing'
import { PageActionsProvider } from '../components/PageActionsMenu'

const source = vi.hoisted(() => ({ catalog: undefined as ReturnType<typeof buildCatalog> | undefined, bandLoads: [] as string[] }))
const speech = vi.hoisted(() => ({ played: [] as string[][] }))
vi.mock('../components/study/useCatalog', () => ({ useCatalog: () => ({ catalog: source.catalog }) }))
vi.mock('../core/assistant/speech', async importOriginal => ({ ...(await importOriginal<object>()), playBrowserSpeech: (...args: string[]) => { speech.played.push(args) } }))
// The shipped band file: the factory runs when the file is first imported, so bandLoads shows whether anything fetched it.
vi.mock('../data/phrases/hsk-1.json', () => { source.bandLoads.push('1'); return { default: { schemaVersion: 2, band: '1', phrases: [
  { id: 1, zh: '我喝水。', py: 'wǒ hē shuǐ', en: 'I drink water.', words: ['me', 'drink', 'water'], source: 'ai', checked: true },
  { id: 2, zh: '我喝茶。', py: 'wǒ hē chá', en: 'I drink tea (generated).', words: ['me', 'drink', 'tea'], grammar: ['plain'], source: 'ai', checked: true },
] } } })

// The count index: only this small file may load while Vocabulary is open.
vi.mock('../data/phrases/index.json', () => ({ default: { schemaVersion: 1, bands: { '1': { count: 2, words: { me: 2, drink: 2, tea: 1, water: 1 } } } } }))

function Harness() {
  const workspace = useLiveQuery(loadWorkspace, [])
  const route = useRoute()
  if (!workspace) return null
  const [path, query = ''] = route.split('?')
  const [, section, scope] = path.split('/')
  const params = new URLSearchParams(query)
  const props = { workspace, now: 1, busy: false, run: async (operation: () => Promise<void>) => { await operation() } }
  return <PageActionsProvider><Dictionary {...props} section={section} initialScope={scope} initialQuery={params.get('q') ?? undefined} initialWord={params.get('word') ?? undefined} /></PageActionsProvider>
}

beforeEach(async () => {
  speech.played.length = 0
  await db.delete()
  await db.open()
  await initializeWorkspace()
  const data: BandData = {
    schemaVersion: 1, band: '1', alignment: 'Fixture', grammar: [],
    vocabulary: [
      { id: 'v1', ch: '\u6211', pr: 'wo', ds: 'me', lb: 'me' }, { id: 'v2', ch: '\u559d', pr: 'he', ds: 'drink', lb: 'drink' },
      { id: 'v3', ch: '\u8336', pr: 'cha', ds: 'tea', lb: 'tea' }, { id: 'v4', ch: '\u6c34', pr: 'shui', ds: 'water', lb: 'water' },
    ],
    groups: [{ id: 'g1', units: [], examples: [{ id: 'e1', segments: [{ word: 'drink' }, { word: 'tea' }, { punctuation: '\u3002' }], translation: 'Drink tea.', grammar: [] }] }],
  }
  source.catalog = buildCatalog([data])
  for (const word of ['me', 'drink', 'tea']) await db.knowledge.add({ ref: `vocabulary:${word}`, kind: 'vocabulary', lb: word, band: '1', addedAt: 1, source: 'new' })
  await db.userPhrases.add({ zh: '\u6211\u8981\u6c34', py: 'wǒ yào shuǐ', en: 'I want water', words: ['vocabulary:me', 'vocabulary:water'], grammar: [], source: 'user', addedAt: 2 })
  await db.phraseHeard.add({ zh: '\u5582\u8336', heard: 2, lastHeardAt: Date.UTC(2026, 10, 5, 12) })
})
afterEach(() => { cleanup() })

const rowOf = (zh: string) => document.querySelector(`tr[data-phrase="${zh}"]`) as HTMLElement

describe('dictionary phrases', () => {
  // First on purpose: the band files must not be loaded while another section is open.
  it('does not load phrase data for the other sections, and offers a link per word', async () => {
    window.location.hash = 'dictionary/vocabulary/all'
    render(<Harness />)
    // from the index: 2 shipped + 1 lesson example + 1 of the learner's own; per word the same way (me: 2 + 0 + 1)
    expect(await screen.findByRole('button', { name: 'Phrases (4)' })).toBeInTheDocument()
    const links = await screen.findAllByRole('link', { name: /^\d+ phrases$/ })
    expect(links.map(link => link.textContent).sort()).toEqual(['2 phrases', '2 phrases', '3 phrases', '3 phrases'])
    expect(source.bandLoads).toEqual([])
    expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^#dictionary\/phrases\/all\?word=vocabulary%3A/))
  })

  it('opens the section with scope counts, states and what is missing', async () => {
    window.location.hash = 'dictionary/vocabulary/all'
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(await screen.findByRole('button', { name: 'Phrases' }))
    expect(await screen.findByRole('button', { name: /^Phrases \(\d+\)$/ })).toBeInTheDocument()
    expect(window.location.hash).toBe('#dictionary/phrases/all')
    expect(source.bandLoads).toEqual(['1'])
    const scopes = within(screen.getByRole('group', { name: 'Phrase scope' }))
    // lesson example, 我喝水 (needs water), 我喝茶 (needs the grammar tag), the learner's 我要水 (needs water)
    expect(await scopes.findByRole('button', { name: 'All (4)' })).toBeInTheDocument()
    expect(scopes.getByRole('button', { name: 'Ready (1)' })).toBeInTheDocument()
    expect(scopes.getByRole('button', { name: 'Pending (3)' })).toBeInTheDocument()
    expect(scopes.getByRole('button', { name: 'Added by me (1)' })).toBeInTheDocument()
    expect(rowOf('\u559d\u8336\u3002')).toHaveTextContent(/Lesson example.*Ready/)
    expect(rowOf('\u6211\u559d\u6c34\u3002')).toHaveTextContent(/Generated.*Pending needs \u6c34/)
    expect(rowOf('\u6211\u559d\u8336\u3002')).toHaveTextContent('Pending needs plain')
    await user.click(scopes.getByRole('button', { name: 'Pending (3)' }))
    await waitFor(() => expect(window.location.hash).toBe('#dictionary/phrases/pending'))
    await waitFor(() => expect(rowOf('\u559d\u8336\u3002')).toBeNull())
    expect(rowOf('\u6211\u559d\u6c34\u3002')).not.toBeNull()
    await user.click(scopes.getByRole('button', { name: 'Added by me (1)' }))
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(1))
    expect(rowOf('\u6211\u8981\u6c34')).toHaveTextContent('Added by me')
  })

  it('filters to the phrases of a word from its link, keeps the filter in the route and goes back', async () => {
    window.location.hash = 'dictionary/vocabulary/all'
    const user = userEvent.setup()
    render(<Harness />)
    const card = (await screen.findByText('tea')).closest('article') as HTMLElement
    await user.click(within(card).getByRole('link', { name: 'Phrases' }))
    await waitFor(() => expect(window.location.hash).toBe('#dictionary/phrases/all?word=vocabulary%3Atea'))
    await waitFor(() => expect(rowOf('\u559d\u8336\u3002')).not.toBeNull())
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2) // the example and the generated 我喝茶
    expect(rowOf('\u6211\u559d\u6c34\u3002')).toBeNull()
    expect(screen.getByText(/Phrases with/)).toHaveTextContent('Phrases with \u8336')
    expect(within(rowOf('\u559d\u8336\u3002')).getByRole('link', { name: '\u8336' })).toHaveAttribute('href', '#dictionary/vocabulary/all?q=%E8%8C%B6')
    act(() => { window.history.back() })
    await waitFor(() => expect(window.location.hash).toBe('#dictionary/vocabulary/all'))
  })

  it('marks unknown words, plays a phrase and removes only a phrase the learner added', async () => {
    window.location.hash = 'dictionary/phrases/all'
    const user = userEvent.setup()
    render(<Harness />)
    expect(await screen.findByText('\u6211\u8981\u6c34')).toBeInTheDocument()
    expect(within(rowOf('\u6211\u8981\u6c34')).getByRole('link', { name: '\u6c34' })).toHaveAttribute('title', 'Not in your knowledge set yet')
    expect(within(rowOf('\u6211\u8981\u6c34')).getByRole('link', { name: '\u6211' })).not.toHaveAttribute('title')
    expect(within(rowOf('\u6211\u559d\u6c34\u3002')).queryByRole('button', { name: /^Remove/ })).toBeNull()
    await user.click(within(rowOf('\u6211\u8981\u6c34')).getByRole('button', { name: 'Play \u6211\u8981\u6c34' }))
    expect(speech.played[0].slice(1)).toEqual(['\u6211\u8981\u6c34', 'zh-Hans'])
    await user.click(within(rowOf('\u6211\u8981\u6c34')).getByRole('button', { name: 'Remove \u6211\u8981\u6c34' }))
    await waitFor(() => expect(rowOf('\u6211\u8981\u6c34')).toBeNull())
    expect(await db.userPhrases.count()).toBe(0)
    expect(rowOf('\u6211\u559d\u6c34\u3002')).not.toBeNull()
  })

  it('gives each row the Ask, Practice and Write menu next to Play', async () => {
    window.location.hash = 'dictionary/phrases/all'
    const user = userEvent.setup()
    render(<Harness />)
    expect(await screen.findByText('\u6211\u8981\u6c34')).toBeInTheDocument()
    const row = rowOf('\u6211\u8981\u6c34')
    expect(within(row).getByRole('button', { name: 'Play \u6211\u8981\u6c34' })).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Phrase actions' }))
    for (const name of ['Ask', 'Practice', 'Write']) expect(await screen.findByRole('button', { name })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Remove \u6211\u8981\u6c34' })).toBeInTheDocument()
  })

  it('searches and pages', async () => {
    window.location.hash = 'dictionary/phrases/all'
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByText('\u6211\u8981\u6c34')
    await user.type(screen.getByLabelText('Search dictionary'), 'wo yao')
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(1))
    await user.clear(screen.getByLabelText('Search dictionary'))
    await user.type(screen.getByLabelText('Search dictionary'), 'tea')
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(2))
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull()
  })
})
