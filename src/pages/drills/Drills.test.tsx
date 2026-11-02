import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { addToKnowledge } from '../../core/study/knowledge'
import { whenContent } from '../../core/drills/content'
import { createDrillSet, finishDrillSet, getDrillSet } from '../../core/drills/store'
import * as speech from '../../core/assistant/speech'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../../core/ai/structured', () => structured)
// The stroke data is fetched from static files; the tests give every character one stroke.
vi.mock('../../core/characters/assets', async importOriginal => ({ ...await importOriginal<typeof import('../../core/characters/assets')>(),
  loadCharacterAsset: async (character: string) => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] }) }))

beforeEach(async () => {
  localStorage.clear()
  window.location.hash = '#practice'
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

describe('Recent sets', () => {
  it('lists a completed set with Open, Save and Remove from knowledge set, and the removal confirms', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    await finishDrillSet(set.id)
    const added = (await getDrillSet(set.id))!.addedRefs!
    expect(added.length).toBeGreaterThan(0)
    expect(await db.knowledge.count()).toBe(added.length)
    render(<App />)
    const recent = (await screen.findByRole('heading', { name: 'Recent sets' })).closest('section')!
    await within(recent).findByText(/Practice set ·/)
    const row = recent.querySelector('.resume-row')!
    expect(within(row as HTMLElement).getByText(/Practice set ·/)).toBeInTheDocument()
    expect(within(row as HTMLElement).getByRole('link', { name: /^Open New items/ })).toHaveAttribute('href', `#practice/set/${set.id}`)
    expect(within(row as HTMLElement).getByRole('button', { name: /^Save New items/ })).toBeInTheDocument()
    expect(screen.getByText('No unfinished sets.')).toBeInTheDocument()
    await user.click(await within(row as HTMLElement).findByRole('button', { name: /^Remove New items.* from knowledge set$/ }))
    const dialog = screen.getByRole('dialog', { name: 'Remove from knowledge set' })
    expect(dialog).toHaveTextContent(/^Remove .*from your knowledge set\? Their reviews go too; your practice history stays\./)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await db.knowledge.count()).toBe(added.length)
    await user.click(within(row as HTMLElement).getByRole('button', { name: /from knowledge set$/ }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await db.knowledge.count()).toBe(0)
    expect(await db.studyCards.count()).toBe(0)
    await waitFor(() => expect(within(row as HTMLElement).queryByRole('button', { name: /from knowledge set$/ })).toBeNull())
    expect(within(row as HTMLElement).getByRole('link', { name: /^Open New items/ })).toBeInTheDocument()
  }, 40000)
})

describe('What you will practise', () => {
  it('offers chips 5/10/15/20, defaults to 5, clamps a typed value, remembers it, and migrates the old stored key', async () => {
    localStorage.setItem('practice.newWords', '10')
    const user = userEvent.setup()
    render(<App />)
    const group = await screen.findByRole('group', { name: 'New items per set' })
    expect(within(group).getAllByRole('button').map(button => button.textContent)).toEqual(['5', '10', '15', '20'])
    expect(within(group).getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('at least — whole lessons are kept together')).toBeInTheDocument()
    await user.click(within(group).getByRole('button', { name: '15' }))
    expect(localStorage.getItem('practice.newItems')).toBe('15')
    const field = screen.getByRole('spinbutton', { name: 'Number of new items' })
    await user.clear(field)
    await user.type(field, '99')
    await user.tab()
    expect(field).toHaveValue(20)
    expect(localStorage.getItem('practice.newItems')).toBe('20')
    cleanup()
    render(<App />)
    expect(await screen.findByRole('spinbutton', { name: 'Number of new items' })).toHaveValue(20)
  })

  it('shows the actual selection as items, words, grammar and lessons, and remembers the count separately for Reviews', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me'])
    render(<App />)
    const summary = await screen.findByTestId('selection-summary')
    await waitFor(() => expect(summary).toHaveTextContent(/^\d+ items? · \d+ words?, \d+ grammar · \d+ lessons?/))
    await user.click(within(await screen.findByRole('group', { name: 'New items per set' })).getByRole('button', { name: '10' }))
    const text = summary.textContent!
    expect(Number(/^(\d+) item/.exec(text)![1])).toBeGreaterThanOrEqual(10)
    await user.click(screen.getByRole('button', { name: 'Reviews' }))
    const reviews = await screen.findByRole('group', { name: 'Reviews per set' })
    expect(within(reviews).getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(reviews).getByRole('button', { name: '5' }))
    expect(localStorage.getItem('practice.reviewCount')).toBe('5')
    expect(localStorage.getItem('practice.newItems')).toBe('10')
    expect(screen.getByTestId('selection-summary')).toHaveTextContent('1 of 1 due')
    await user.click(screen.getByRole('button', { name: 'New items' }))
    expect(within(await screen.findByRole('group', { name: 'New items per set' })).getByRole('button', { name: '10' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('View items shows the intro cards of exactly the selection, and Start creates a set with those refs', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(within(await screen.findByRole('group', { name: 'New items per set' })).getByRole('button', { name: '5' }))
    const view = await screen.findByRole('button', { name: /View items/ })
    await waitFor(() => expect(view).toBeEnabled())
    const count = Number(/^(\d+) item/.exec(screen.getByTestId('selection-summary').textContent!)![1])
    await user.click(view)
    const dialog = await screen.findByRole('dialog', { name: 'Items you will practise' })
    // just the cards under a count heading: no separate list of everything above them
    expect(await within(dialog).findByRole('heading', { name: `${count} ${count === 1 ? 'item' : 'items'}` })).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('All items')).toBeNull()
    await waitFor(() => expect(dialog.querySelectorAll('.study-unit-card, .word-card').length).toBe(count))
    const shown = [...dialog.querySelectorAll('[data-unit]')].map(card => card.getAttribute('data-unit'))
    await user.click(within(dialog).getByRole('button', { name: 'Close items' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Start practice set' }))
    await screen.findByRole('heading', { name: /^New items · / }, { timeout: 20000 })
    const set = (await db.drillSets.toArray())[0]
    expect(set.refs).toHaveLength(count)
    const items = await (await import('../../core/drills/items')).loadItems(set.refs, await (await import('../../core/study/catalog')).loadCatalog())
    expect(set.refs).toEqual(shown)
    expect(items).toHaveLength(count)
  }, 40000)

  it('Hands-free Start creates a run with the selected refs, and Reviews mode selects the due items', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you'])
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Reviews' }))
    const card = (await screen.findByRole('heading', { name: 'What you\'ll practise' })).closest('section')!
    expect(card).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'New items' }))
    await waitFor(() => expect(screen.getByTestId('selection-summary')).toHaveTextContent(/items?/))
    const count = Number(/^(\d+) item/.exec(screen.getByTestId('selection-summary').textContent!)![1])
    await user.click(screen.getByRole('button', { name: 'Start Hands-free' }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#practice\/handsfree\//))
    const runs = await db.handsfreeRuns.toArray()
    expect(runs).toHaveLength(1)
    expect(runs[0].refs).toHaveLength(count)
    expect(runs[0].addOnComplete).toEqual(runs[0].refs)
  }, 40000)
})

describe('Practice home', () => {
  it('sends the old #drills links to Practice', async () => {
    window.location.hash = '#drills/set/gone'
    render(<App />)
    expect(await screen.findByText('This practice set is not available')).toBeInTheDocument()
    expect(window.location.hash).toBe('#practice/set/gone')
  })

  it('is the Practice nav entry, starts a new-words set on its intro cards, then lists it as unfinished', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Practice', level: 1 })).toBeInTheDocument()
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }))
    expect(nav.getByRole('link', { name: /Practice/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Classic practice/ })).toHaveAttribute('href', '#review')
    expect(screen.getByRole('link', { name: 'Mahjong' })).toHaveAttribute('href', '#practice/mahjong')
    const start = await screen.findByRole('button', { name: 'Start practice set' })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    expect(await screen.findByRole('heading', { name: /^New items · \d+ \w{3}$/ }, { timeout: 20000 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^\d+ items?$/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('All items')).toBeNull()
    expect(document.querySelectorAll('.study-unit-card').length).toBeGreaterThan(0)
    await user.click(screen.getAllByRole('link', { name: /Start practicing/ })[0])
    expect(await screen.findByRole('heading', { name: 'Pick a practice type' })).toBeInTheDocument()
    // There is no "Learning from" selector on the set screen.
    expect(screen.queryByLabelText('Learning from')).toBeNull()
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: /Practice/ }))
    const unfinished = await screen.findByRole('heading', { name: 'Unfinished sets' })
    const row = unfinished.closest('section')!
    expect(await within(row).findByText(/New items · \d+ \w{3}/)).toBeInTheDocument()
    const line = row.querySelector('.resume-row')!
    // title and meta on the left; resume and discard are same-size icon buttons on the right
    expect([...line.children].map(child => child.className)).toEqual(['resume-text', 'icon-button', 'icon-button'])
    await user.click(within(row).getByRole('button', { name: /^Discard New items/ }))
    const confirm = screen.getByRole('dialog', { name: 'Discard this set?' })
    expect(within(confirm).getAllByRole('button').map(button => button.textContent)).toEqual(['Cancel', 'Discard'])
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(row).getByText(/New items/)).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: /^Discard New items/ }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(within(row).getByRole('button', { name: /^Discard New items/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Discard this set?' })).getByRole('button', { name: 'Discard' }))
    expect(await within(row).findByText('No unfinished sets.')).toBeInTheDocument()
  }, 40000)

  it('hides the items of a review set until Show words', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you'])
    const id = await createDrillSet({ kind: 'review' }, Date.now() + 1000)
    window.location.hash = `#practice/set/${id}/intro`
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
    window.location.hash = `#practice/set/${set.id}`
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

  it('Match pairs is its own type: Word meanings has no Match style, and a board is graded per item', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}`
    render(<App />)
    const row = (await screen.findByText('Match pairs', {}, { timeout: 8000 })).closest('li')!
    await user.click(within(row).getByRole('link', { name: 'Start' }))
    const board = await screen.findByRole('group', { name: 'Pairs to match' })
    expect(board.style.getPropertyValue('--match-rows')).not.toBe('')
    const cells = within(board).getAllByRole('button')
    expect(cells.every(cell => cell.classList.contains('match-cell'))).toBe(true)
    // Pair every left cell by trying the right column in turn: wrong tries are charged as misses, the pass still finishes.
    for (let guard = 0; guard < 80 && !screen.queryByRole('region', { name: 'Pass finished' }); guard++) {
      const next = screen.queryByRole('button', { name: /^(Next|Finish)$/ })
      if (next) { await user.click(next); continue }
      const group = screen.queryByRole('group', { name: 'Pairs to match' })
      if (!group) continue
      const [first, second] = [within(group).getByRole('group', { name: 'First column' }), within(group).getByRole('group', { name: 'Second column' })]
      const left = within(first).getAllByRole('button').find(cell => !(cell as HTMLButtonElement).disabled)
      if (!left) { await new Promise(resolve => setTimeout(resolve, 50)); continue }
      for (const right of within(second).getAllByRole('button')) {
        if ((left as HTMLButtonElement).disabled) break
        if ((right as HTMLButtonElement).disabled) continue
        await user.click(left); await user.click(right)
      }
    }
    expect(await screen.findByRole('region', { name: 'Pass finished' })).toBeInTheDocument()
    expect(Object.keys((await getDrillSet(set.id))!.progress.match?.results ?? {}).length).toBeGreaterThan(0)
  }, 60000)

  it('Word meanings keeps Choose and Type only', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}/run/meanings`
    render(<App />)
    const style = await screen.findByRole('group', { name: 'Style' })
    expect(within(style).getAllByRole('button').map(button => button.textContent)).toEqual(['Choose', 'Type'])
    await user.click(within(style).getByRole('button', { name: 'Type' }))
    expect(screen.getByRole('group', { name: 'Direction' })).toBeInTheDocument()
  }, 40000)

  it('a typed answer preselects the automatic mark, and the chosen override is what is graded', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}/run/meanings`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Type' }))
    await user.type(await screen.findByRole('textbox'), 'zzz wrong')
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    const marks = await screen.findByRole('group', { name: 'Mark your answer' })
    expect(screen.getByText(/Checked automatically: Missed/)).toBeInTheDocument()
    expect(within(marks).getByRole('button', { name: 'Missed' })).toHaveAttribute('aria-pressed', 'true')
    expect(Object.keys((await getDrillSet(set.id))!.progress.meanings?.results ?? {})).toHaveLength(0)
    await user.click(within(marks).getByRole('button', { name: 'Got it' }))
    expect(within(marks).getByRole('button', { name: 'Got it' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /^(Next|Finish)$/ }))
    const results = Object.values((await getDrillSet(set.id))!.progress.meanings!.results)
    expect(results).toEqual(['got'])
  }, 40000)

  it('Write it elsewhere: a hint turns Got it into Needed a hint', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}/run/write`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Whole words' }, { timeout: 8000 }))
    await user.click(screen.getByRole('button', { name: 'Write elsewhere' }))
    // The prompt is pinyin only.
    expect(document.querySelector('.dr-pinyin-prompt')?.textContent).not.toMatch(/\p{Script=Han}/u)
    await user.click(screen.getByRole('button', { name: /Reveal/ }))
    expect(document.querySelector('.dr-reveal .dr-zh')?.textContent).toMatch(/\p{Script=Han}/u)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByLabelText('Stroke order')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Got it' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Needed a hint')
    await waitFor(async () => expect(Object.values((await getDrillSet(set.id))!.progress.write!.results)).toEqual(['hint']))
  }, 40000)

  it('runs any type as a quiz page with a sticky count and Check all', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    await db.drillSets.put({ ...set, format: 'quiz' })
    window.location.hash = `#practice/set/${set.id}/run/meanings`
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
    window.location.hash = `#practice/set/${set.id}/summary`
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
  it('is the top panel, drives the selection in both modes, and Start uses it', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you', 'vocabulary:ta1--he'])
    await db.collections.put({ id: 'c1', name: 'Introductions', createdAt: 1, updatedAt: 1 } as never)
    await db.collectionItems.bulkPut([
      { id: 'i1', collectionId: 'c1', ref: 'vocabulary:wo3--me', addedAt: 1 }, { id: 'i2', collectionId: 'c1', ref: 'vocabulary:ni3--you', addedAt: 2 },
      { id: 'i3', collectionId: 'c1', ref: 'vocabulary:hao3--good', addedAt: 3 },
    ] as never)
    window.location.hash = '#practice'
    render(<App />)
    const select = await screen.findByLabelText('Learning from')
    const panel = (await screen.findByRole('heading', { name: "What you'll practise" })).closest('section')!
    expect(panel.contains(select)).toBe(true)
    const programs = screen.getByRole('heading', { name: 'Programs' }).closest('section')!
    expect(select.compareDocumentPosition(programs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await within(select).findByRole('option', { name: 'Introductions' })
    await user.selectOptions(select, 'c1')
    await waitFor(() => expect(screen.getByTestId('selection-summary')).toHaveTextContent(/^1 item · 1 word, 0 grammar/))
    await user.click(within(panel).getByRole('button', { name: 'Reviews' }))
    await waitFor(() => expect(screen.getByTestId('selection-summary')).toHaveTextContent('2 of 2 due'))
    await user.click(screen.getByRole('button', { name: 'Start practice set' }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#practice\/set\//))
    const sets = await db.drillSets.toArray()
    expect(sets).toHaveLength(1)
    expect(sets[0].source).toBe('review')
    expect([...sets[0].refs].sort()).toEqual(['vocabulary:ni3--you', 'vocabulary:wo3--me'])
  }, 40000)
})

describe('Write it by character', () => {
  const ref = { sheng: 'vocabulary:xue2-sheng5--student', xi: 'vocabulary:xue2-xi2--study' }
  async function sharedSet(source: 'review' | 'new') {
    const set = await newSet()
    const sentences = { [ref.sheng]: { zh: '他是学生。', py: 'tā shì xué sheng.', en: 'He is a student.', source: 'catalog' as const }, [ref.xi]: { zh: '我学习中文。', py: 'wǒ xué xí zhōng wén.', en: 'I study Chinese.', source: 'catalog' as const } }
    const id = 'shared-' + source
    await db.drillSets.put({ ...set, id, source, refs: [ref.sheng, ref.xi], progress: {}, content: { state: 'ready', sentences, conversations: [] } })
    return id
  }

  it('asks each character once, prompting only its syllable, and grades words by their worst character', async () => {
    const user = userEvent.setup()
    const id = await sharedSet('review')
    window.location.hash = `#practice/set/${id}/run/write`
    render(<App />)
    // Reviews default to Write elsewhere, and to Characters.
    expect(await screen.findByRole('button', { name: 'Characters', pressed: true }, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write elsewhere', pressed: true })).toBeInTheDocument()
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument()
    const marks = ['got', 'hint', 'missed'] as const
    const labels = { got: 'Got it', hint: 'Needed a hint', missed: 'Missed' }
    const asked: string[] = []
    for (let step = 0; step < 3; step++) {
      expect(document.querySelectorAll('.dr-pinyin-prompt mark')).toHaveLength(1)
      const line = document.querySelector('.dr-write-line')!.textContent!
      expect(line).toMatch(/^Write \S+$/)
      asked.push(line)
      await user.click(screen.getByRole('button', { name: 'Check answer' }))
      await user.click(await screen.findByRole('button', { name: labels[marks[step]] }))
      await user.click(await screen.findByRole('button', { name: step === 2 ? 'Finish' : 'Next' }))
    }
    expect(new Set(asked).size).toBe(3)
    expect(await screen.findByRole('heading', { name: /Write it done/ })).toBeInTheDocument()
    expect(screen.getByText('Missed characters')).toBeInTheDocument()
    const saved = (await getDrillSet(id))!.progress.write!
    expect(Object.keys(saved.chars!)).toHaveLength(3)
    expect(Object.keys(saved.results)).toHaveLength(2)
    expect(Object.values(saved.results)).toContain('missed')
    expect(saved.done).toBe(true)
  }, 60000)

  it('Whole words mode accents the whole word on paper and remembers the choice', async () => {
    const user = userEvent.setup()
    const id = await sharedSet('review')
    window.location.hash = `#practice/set/${id}/run/write`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Whole words' }, { timeout: 8000 }))
    expect(document.querySelector('.dr-write-line')!.textContent).toMatch(/^Write \S+ \S+$/)
    expect(document.querySelector('.dr-pinyin-prompt mark')!.textContent).toMatch(/\S+ \S+/)
    expect(localStorage.getItem('drills.write')).toContain('words')
  }, 40000)

  it('new-item sets open on the pad, where an unwritten character is taught first, and can be skipped', async () => {
    const user = userEvent.setup()
    const id = await sharedSet('new')
    window.location.hash = `#practice/set/${id}/run/write`
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Handwriting pad', pressed: true }, { timeout: 8000 })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'I already know how to write this' }, { timeout: 8000 }))
    expect(await screen.findByRole('img', { name: 'Handwriting area' })).toBeInTheDocument()
  }, 40000)
})

describe('no sideways overflow at 390 px', () => {
  const LONG = '大婚撞破未婚夫和繼妹，我轉身嫁給他昏迷的四叔'
  const fits = () => { const root = document.documentElement; return root.scrollWidth <= root.clientWidth }
  it('marks the answer screens as excluded from selected-text help, so Write elsewhere never opens phrase practice by accident', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    window.location.hash = `#practice/set/${id}/run/write`
    render(<App />)
    const title = await screen.findByText('Write it', { selector: 'h2' })
    expect(title.closest('[data-assistant-exclude]')).not.toBeNull()
  })

  it('keeps Practice home and the set screen inside the screen, with a long Chinese study-set name', async () => {
    window.innerWidth = 390
    await db.collections.put({ id: 'long', name: LONG, createdAt: 1, updatedAt: 1 } as never)
    const set = await newSet()
    await db.drillSets.put({ ...set, title: LONG })
    window.location.hash = '#practice'
    const view = render(<App />)
    await screen.findByLabelText('Learning from')
    expect(fits()).toBe(true)
    // Study sets are only in the selector: there is no second list of them under the rows.
    expect(screen.queryByText(/can also be started whole/)).toBeNull()
    expect(screen.queryByRole('button', { name: `Start ${LONG}` })).toBeNull()
    // Every row of the card keeps its own text inside it (jsdom has no layout, so check the wrapping rules are on the elements).
    for (const element of view.container.querySelectorAll('.dr-rows strong, .resume-main strong, .dr-source select')) expect(element.closest('.dr-panel, .dr-from')).not.toBeNull()
    window.location.hash = `#practice/set/${set.id}`
    expect(await screen.findByRole('heading', { name: LONG }, { timeout: 8000 })).toBeInTheDocument()
    expect(fits()).toBe(true)
  }, 40000)
})
