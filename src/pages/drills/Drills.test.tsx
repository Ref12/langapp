import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { addToKnowledge } from '../../core/study/knowledge'
import { whenContent } from '../../core/drills/content'
import { createDrillSet, getDrillSet } from '../../core/drills/store'
import * as speech from '../../core/assistant/speech'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../../core/ai/structured', () => structured)

beforeEach(async () => {
  window.location.hash = '#drills'
  await db.delete()
  await db.open()
  structured.requestStructuredJSON.mockReset()
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false })
  vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** A new-words set from the curriculum, with its catalog sentences in place. */
async function newSet() {
  const id = await createDrillSet({ kind: 'new' })
  await whenContent(id)
  return (await getDrillSet(id))!
}

describe('Drills home', () => {
  it('is the Drills nav entry, starts a new-words set on its intro cards, then lists it as unfinished', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Drills', level: 1 })).toBeInTheDocument()
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }))
    expect(nav.getByRole('link', { name: /Drills/ })).toHaveAttribute('aria-current', 'page')
    expect(nav.queryByRole('link', { name: /^Practice/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Classic practice/ })).toHaveAttribute('href', '#practice')
    expect(screen.getByRole('link', { name: 'Mahjong' })).toHaveAttribute('href', '#practice/mahjong')
    const start = await screen.findByRole('button', { name: 'Start new words' })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    expect(await screen.findByRole('heading', { name: /^New words · \d+ \w{3}$/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Intro cards/ })).toBeInTheDocument()
    expect(document.querySelectorAll('.study-unit-card').length).toBeGreaterThan(0)
    await user.click(screen.getAllByRole('link', { name: /Start drilling/ })[0])
    expect(await screen.findByRole('heading', { name: 'Pick a drill type' })).toBeInTheDocument()
    // There is no "Learning from" selector on the set screen.
    expect(screen.queryByLabelText('Learning from')).toBeNull()
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: /Drills/ }))
    const unfinished = await screen.findByRole('heading', { name: 'Unfinished sets' })
    const row = unfinished.closest('section')!
    expect(await within(row).findByText(/New words · \d+ \w{3}/)).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: /^Discard New words/ }))
    expect(within(row).getByRole('button', { name: 'Keep' })).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Keep' }))
    expect(within(row).getByText(/New words/)).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: /^Discard New words/ }))
    await user.click(within(row).getByRole('button', { name: 'Discard' }))
    expect(await within(row).findByText('No unfinished sets.')).toBeInTheDocument()
  }, 40000)

  it('hides the items of a review set until Show words', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you'])
    const id = await createDrillSet({ kind: 'review' }, Date.now() + 1000)
    window.location.hash = `#drills/set/${id}/intro`
    render(<App />)
    expect(await screen.findByText(/items hidden/)).toBeInTheDocument()
    expect(screen.queryByText('我')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Show words/ }))
    expect(await screen.findByText('我')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Hide words/ }))
    expect(screen.queryByText('我')).toBeNull()
  }, 40000)
})

describe('doing drills', () => {
  it('does a Word meanings pass: the type moves to Done with its score, and Redo stays ungraded', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    window.location.hash = `#drills/set/${set.id}`
    render(<App />)
    await user.click((await screen.findAllByRole('link', { name: 'Start' }, { timeout: 8000 }))[0])
    for (let guard = 0; guard < 30; guard++) {
      const options = await screen.findAllByRole('radio').catch(() => [])
      if (!options.length) break
      await user.click(options[0])
      await user.click(screen.getByRole('button', { name: 'Check answer' }))
      await user.click(await screen.findByRole('button', { name: /^(Next|Finish)$/ }))
    }
    expect(await screen.findByRole('region', { name: 'Pass finished' })).toBeInTheDocument()
    const saved = (await getDrillSet(set.id))!
    expect(saved.progress.meanings?.done).toBe(true)
    const before = JSON.stringify(saved.progress.meanings!.results)
    await user.click(screen.getByRole('link', { name: 'Back to the set' }))
    const done = (await screen.findByRole('heading', { name: 'Done' })).closest('section')!
    expect(within(done).getByText('Word meanings')).toBeInTheDocument()
    expect(within(done).getByText(/of \d+ correct/)).toBeInTheDocument()
    await user.click(within(done).getByRole('link', { name: 'Redo Word meanings' }))
    expect(await screen.findByText(/REDO, NOT GRADED/)).toBeInTheDocument()
    await user.click((await screen.findAllByRole('radio'))[1])
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(JSON.stringify((await getDrillSet(set.id))!.progress.meanings!.results)).toBe(before)
  }, 40000)

  it('Write it on paper: a hint turns Got it into Needed a hint', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    window.location.hash = `#drills/set/${set.id}/run/write`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'On paper' }, { timeout: 8000 }))
    // The prompt is pinyin only.
    expect(document.querySelector('.dr-pinyin-prompt')?.textContent).not.toMatch(/\p{Script=Han}/u)
    await user.click(screen.getByRole('button', { name: /Reveal/ }))
    expect(document.querySelector('.dr-reveal .dr-zh')?.textContent).toMatch(/\p{Script=Han}/u)
    await user.click(screen.getByRole('button', { name: 'Show answer' }))
    await user.click(await screen.findByRole('button', { name: 'Got it' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Needed a hint')
    await waitFor(async () => expect(Object.values((await getDrillSet(set.id))!.progress.write!.results)).toEqual(['hint']))
  }, 40000)

  it('runs any type as a quiz page with a sticky count and Check all', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    await db.drillSets.put({ ...set, format: 'quiz' })
    window.location.hash = `#drills/set/${set.id}/run/meanings`
    render(<App />)
    const bar = await screen.findByRole('region', { name: 'Quiz progress' }, { timeout: 8000 })
    const total = document.querySelectorAll('.dr-quiz > li').length
    expect(total).toBeGreaterThan(1)
    expect(within(bar).getByText(`0 of ${total}`)).toBeInTheDocument()
    const groups = screen.getAllByRole('group', { name: 'Choose an answer' })
    await user.click(within(groups[0]).getAllByRole('radio')[0])
    await user.click(within(groups[1]).getAllByRole('radio')[0])
    expect(within(bar).getByText(`2 of ${total}`)).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: 'Check all' }))
    await waitFor(async () => expect(Object.keys((await getDrillSet(set.id))!.progress.meanings!.results)).toHaveLength(2))
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(2)
  }, 40000)
})

describe('summary', () => {
  it('shows the score, the counts, the per-type table, items to revisit and Practise missed', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    const [first, second, third] = set.refs
    await db.drillSets.put({ ...set, progress: { meanings: { results: { [first]: 'got', [second]: 'hint', [third]: 'missed' }, scope: [first, second, third], done: true, redos: 0 } } })
    window.location.hash = `#drills/set/${set.id}/summary`
    render(<App />)
    expect(await screen.findByText('2 / 3')).toBeInTheDocument()
    const stats = document.querySelector('.dr-stats')!
    expect(stats.textContent).toMatch(/1Got it/)
    expect(stats.textContent).toMatch(/1Needed a hint/)
    expect(stats.textContent).toMatch(/1Missed/)
    const table = screen.getByRole('table')
    expect(within(table).getByText('Word meanings')).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'Redo Word meanings' })).toBeInTheDocument()
    const revisit = screen.getByRole('heading', { name: 'Items to revisit' }).closest('section')!
    expect(within(revisit).getAllByRole('listitem')).toHaveLength(2)
    expect(within(revisit).getByRole('link', { name: 'Practise missed (ungraded)' })).toHaveAttribute('href', expect.stringContaining('run/meanings?missed=1'))
    await user.click(screen.getByRole('button', { name: 'Finish set' }))
    await waitFor(async () => expect((await getDrillSet(set.id))!.status).toBe('completed'))
  }, 40000)
})

describe('Learning from', () => {
  it('sits above both rows and drives the New words and Reviews counts and starts', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you', 'vocabulary:ta1--he'])
    await db.collections.put({ id: 'c1', name: 'Introductions', createdAt: 1, updatedAt: 1 } as never)
    await db.collectionItems.bulkPut([
      { id: 'i1', collectionId: 'c1', ref: 'vocabulary:wo3--me', addedAt: 1 }, { id: 'i2', collectionId: 'c1', ref: 'vocabulary:ni3--you', addedAt: 2 },
      { id: 'i3', collectionId: 'c1', ref: 'vocabulary:hao3--good', addedAt: 3 },
    ] as never)
    window.location.hash = '#drills'
    render(<App />)
    const select = await screen.findByLabelText('Learning from')
    const card = select.closest('section')!
    const rows = within(card).getAllByRole('listitem')
    // The selector comes before both rows.
    expect(select.compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(await within(card).findByText(/curriculum items/)).toBeInTheDocument()
    expect(within(card).getByText(/items? due · titles hidden/)).toBeInTheDocument()
    await within(select).findByRole('option', { name: 'Introductions' })
    await user.selectOptions(select, 'c1')
    expect(await within(card).findByText(/new items? in Introductions/)).toBeInTheDocument()
    expect(within(card).getByText(/2 items due in Introductions/)).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Start reviews' }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#drills\/set\//))
    const sets = await db.drillSets.toArray()
    expect(sets).toHaveLength(1)
    expect(sets[0].source).toBe('review')
    expect([...sets[0].refs].sort()).toEqual(['vocabulary:ni3--you', 'vocabulary:wo3--me'])
  }, 40000)
})
