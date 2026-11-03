import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { continueOf } from './Drills'
import { db } from '../../core/database'
import { addToKnowledge } from '../../core/study/knowledge'
import { whenContent } from '../../core/drills/content'
import { createDrillSet, finishDrillSet, getDrillSet, newHandsfreeActivity } from '../../core/drills/store'
import { DEFAULT_HANDSFREE_SETTINGS } from '../../core/handsfree/contracts'
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

describe('Recent sets rows', () => {
  const hf = (fields: Record<string, unknown>) => ({ seed: 1, settings: DEFAULT_HANDSFREE_SETTINGS, started: true, position: 2, done: false, layout: 3, ...fields })
  it('continueOf: a stopped Hands-free activity first, else the first unfinished type, else nothing; finished sets never', async () => {
    const set = await newSet()
    expect(continueOf(set)).toBeUndefined()
    const recall = continueOf({ ...set, handsfreeRecall: hf({ position: 4 }) } as never)
    expect(recall).toMatchObject({ route: `practice/set/${set.id}/recall`, label: 'Continue Hands-free recall at prompt 5' })
    expect(continueOf({ ...set, handsfree: hf({}) } as never)?.route).toBe(`practice/set/${set.id}/handsfree`)
    const refs = set.refs.slice(0, 2)
    expect(continueOf({ ...set, progress: { meanings: { results: { [refs[0]]: 'got' }, scope: refs, done: false, redos: 0 } } } as never)).toMatchObject({ route: `practice/set/${set.id}/run/meanings` })
    expect(continueOf({ ...set, status: 'completed', handsfree: hf({}) } as never)).toBeUndefined()
  })

  it('shows an unfinished shortcut set with the words line, "left off in", Continue <type>, Open set and View items', async () => {
    const set = await newSet()
    await db.drillSets.put({ ...set, shortcut: 'handsfree', title: 'Hands-free · 1 Nov', handsfree: hf({ position: 3 }) } as never)
    render(<App />)
    const recent = (await screen.findByRole('heading', { name: 'Recent sets' })).closest('section')!
    const row = (await within(recent).findByText('Hands-free · 1 Nov')).closest('.resume-row') as HTMLElement
    expect(row.querySelector('.resume-text')).toHaveTextContent(/types done/)
    expect(row.querySelector('.resume-text')).not.toHaveTextContent(/stopped/)
    expect(within(row).getByRole('link', { name: 'Continue Hands-free introduction at prompt 4' })).toHaveAttribute('href', `#practice/set/${set.id}/handsfree`)
    expect(row.querySelector('.resume-text')).toHaveTextContent('left off in Hands-free introduction')
      expect(within(row).getByRole('link', { name: 'Continue Hands-free introduction at prompt 4' })).toHaveTextContent('Continue Hands-free introduction')
      expect(within(row).getByRole('link', { name: /^Open set / })).toHaveAttribute('href', `#practice/set/${set.id}`)
      expect(within(row).getByRole('link', { name: /^Open set / })).toHaveClass('secondary')
      expect(within(row).getByRole('link', { name: /^View items in / })).toHaveAttribute('href', `#practice/set/${set.id}/intro`)
  })

  it('writes the sentences of a shortcut set when its page opens, so every practice type is offered', async () => {
    const set = await newSet()
    await db.drillSets.put({ ...set, shortcut: 'handsfree', content: { state: 'pending', sentences: {}, conversations: [] } } as never)
    window.location.hash = `#practice/set/${set.id}`
    render(<App />)
    await screen.findByRole('heading', { name: 'Pick a practice type' })
    await waitFor(async () => expect((await getDrillSet(set.id))!.content.state).not.toBe('pending'))
  })
})

describe('Recent sets', () => {
  it('lists a completed set with Open and Save, and Remove from knowledge set in its ⋯ menu, which confirms', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    await finishDrillSet(set.id)
    const added = (await getDrillSet(set.id))!.addedRefs!
    expect(added.length).toBeGreaterThan(0)
    expect(await db.knowledge.count()).toBe(added.length)
    render(<App />)
    const recent = (await screen.findByRole('heading', { name: 'Recent sets' })).closest('section')!
    await within(recent).findByText(/types done · \d+ \w{3}/)
    const row = recent.querySelector('.resume-row')!
    expect(within(row as HTMLElement).getByText(/types done/)).toBeInTheDocument()
    expect(within(row as HTMLElement).queryByText(/Hands-free|Practice set/)).toBeNull()
    expect(within(row as HTMLElement).queryByRole('link', { name: /^Continue/ })).toBeNull()
    expect(within(row as HTMLElement).getByRole('link', { name: /^Open set New items/ })).toHaveAttribute('href', `#practice/set/${set.id}`)
    expect(within(row as HTMLElement).getByRole('link', { name: /^Open set New items/ })).toHaveClass('primary')
      expect(within(row as HTMLElement).getByRole('link', { name: /^View items in New items/ })).toHaveAttribute('href', expect.stringMatching(/\/intro$/))
      expect(within(row as HTMLElement).getByRole('button', { name: /^Save New items/ })).toBeInTheDocument()
    expect(within(row as HTMLElement).queryByText('In progress')).toBeNull()
    expect(within(row as HTMLElement).queryByRole('link', { name: /^Resume/ })).toBeNull()
    await user.click(await within(row as HTMLElement).findByRole('button', { name: /^More for New items/ }))
    expect(within(row as HTMLElement).queryByRole('menuitem', { name: /^Discard/ })).toBeNull()
    await user.click(await within(row as HTMLElement).findByRole('menuitem', { name: /^Remove New items.* from knowledge set$/ }))
    const dialog = screen.getByRole('dialog', { name: 'Remove from knowledge set' })
    expect(dialog).toHaveTextContent(/^Remove .*from your knowledge set\? Their reviews go too; your practice history stays\./)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await db.knowledge.count()).toBe(added.length)
    await user.click(within(row as HTMLElement).getByRole('menuitem', { name: /from knowledge set$/ }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await db.knowledge.count()).toBe(0)
    expect(await db.studyCards.count()).toBe(0)
    // nothing left to remove: the ⋯ menu goes away with it
    await waitFor(() => expect(within(row as HTMLElement).queryByRole('button', { name: /^More for/ })).toBeNull())
    expect(within(row as HTMLElement).getByRole('link', { name: /^Open set New items/ })).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Start Hands-free introduction' }))
    await waitFor(() => expect(window.location.hash).toMatch(/^#practice\/set\/[^/]+\/handsfree$/))
    const runs = await db.drillSets.toArray()
    expect(runs).toHaveLength(1)
    expect(runs[0].refs).toHaveLength(count)
    expect(runs[0].addOnFinish).toEqual(runs[0].refs)
    expect(runs[0].shortcut).toBe('handsfree')
  }, 40000)
})

describe('Practice home', () => {
  it('sends the old #drills links to Practice', async () => {
    window.location.hash = '#drills/set/gone'
    render(<App />)
    expect(await screen.findByText('This practice set is not available')).toBeInTheDocument()
    expect(window.location.hash).toBe('#practice/set/gone')
  })

  it('is the Practice nav entry, starts a new-words set on its intro cards, then lists it in Recent sets as In progress', async () => {
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
    expect(screen.queryByRole('heading', { name: 'Unfinished sets' })).toBeNull()
    const recent = (await screen.findByRole('heading', { name: 'Recent sets' })).closest('section')!
    expect(await within(recent).findByText(/New items/)).toBeInTheDocument()
    const line = recent.querySelector('.resume-row')!
    // title and meta on the left; Resume, Save and the ⋯ menu are same-size controls on the right
    expect([...line.children].map(child => child.className.split(' ')[0])).toEqual(['resume-text', 'resume-actions'])
    expect(line.querySelector('.resume-text')).toHaveTextContent('In progress')
    expect(line.querySelector('.resume-text')).toHaveTextContent(/0 of 11 types done/)
    // nothing started yet: no Continue, but Open set is always there
    expect(within(recent).queryByRole('link', { name: /^Continue/ })).toBeNull()
    expect(within(recent).getByRole('link', { name: /^Open set New items/ })).toBeInTheDocument()
    expect(within(recent).queryByRole('button', { name: /^Discard New items/ })).toBeNull()
    const openMenu = () => user.click(within(recent).getByRole('button', { name: /^More for New items/ }))
    await openMenu()
    await user.click(within(recent).getByRole('menuitem', { name: /^Discard New items/ }))
    const confirm = screen.getByRole('dialog', { name: 'Discard this set?' })
    expect(within(confirm).getAllByRole('button').map(button => button.textContent)).toEqual(['Cancel', 'Discard'])
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(recent).getByText(/New items/)).toBeInTheDocument()
    await openMenu()
    await user.click(within(recent).getByRole('menuitem', { name: /^Discard New items/ }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await openMenu()
    await user.click(within(recent).getByRole('menuitem', { name: /^Discard New items/ }))
    await user.click(within(screen.getByRole('dialog', { name: 'Discard this set?' })).getByRole('button', { name: 'Discard' }))
    expect(await within(recent).findByText('No sets yet.')).toBeInTheDocument()
  }, 40000)

  it('lists a review set as headword tiles with no meanings, reveals one on tap and all with the toggle, and records no introduction', async () => {
    const user = userEvent.setup()
    await addToKnowledge(['vocabulary:wo3--me', 'vocabulary:ni3--you'])
    const id = await createDrillSet({ kind: 'review' }, Date.now() + 1000)
    window.location.hash = `#practice/set/${id}/intro`
    render(<App />)
    const tile = await screen.findByRole('button', { name: /^我/ })
    expect(screen.getByRole('button', { name: /^你/ })).toBeInTheDocument()
    expect(tile).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/hidden/)).toBeNull()
    expect(screen.queryByText('wǒ')).toBeNull()
    const tiles = tile.closest('ul') as HTMLElement
    expect(tiles.textContent).not.toMatch(/(?<![a-z])me|you|wǒ|nǐ/i)
    await user.click(tile)
    expect(tile).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(tiles.textContent).toMatch(/(?<![a-z])me/i))
    expect(tiles.textContent).not.toMatch(/you/i)
    await user.click(tile)
    expect(tiles.textContent).not.toMatch(/(?<![a-z])me/i)
    await user.click(screen.getByRole('button', { name: 'Show all meanings' }))
    await waitFor(() => expect(tiles.textContent).toMatch(/you/i))
    expect(tiles.textContent).toMatch(/(?<![a-z])me/i)
    await user.click(screen.getByRole('button', { name: 'Hide meanings' }))
    expect(tiles.textContent).not.toMatch(/\b(me|you)\b/i)
    expect(await db.exerciseSessions.count() + await db.practiceHistory.count()).toBe(0)
  }, 40000)

  it('does a Word meanings pass: the type moves to Done with its score, and Redo stays ungraded', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}`
    render(<App />)
    await user.click((await screen.findByRole('link', { name: 'Start Word meanings' }, { timeout: 8000 })))
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
    const done = (await screen.findByRole('heading', { name: 'Pick a practice type' })).closest('section')!
    expect(within(done).getByText('Word meanings')).toBeInTheDocument()
    expect(within(done).getByText(/of \d+ correct/)).toBeInTheDocument()
    await user.click(within(done).getByRole('link', { name: 'Redo Word meanings, done' }))
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
    await user.click(within(row).getByRole('link', { name: /^Start / }))
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
    await user.click(await screen.findByRole('button', { name: 'Write elsewhere' }, { timeout: 8000 }))
    // The prompt is pinyin only.
    expect(document.querySelector('.dr-pinyin-prompt')?.textContent).not.toMatch(/\p{Script=Han}/u)
    await user.click(screen.getByRole('button', { name: /Reveal/ }))
    expect(document.querySelector('.dr-sentence-zh')?.textContent).toMatch(/\p{Script=Han}/u)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByLabelText('Stroke order')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Got it' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Needed a hint')
    await waitFor(async () => expect(Object.values((await getDrillSet(set.id))!.progress.write!.results)).toEqual(['hint']))
  }, 40000)

  it('titles a Hands-free shortcut set like any set from its source', async () => {
    const id = await createDrillSet({ kind: 'new' }, 1_700_000_000_000, { handsfree: newHandsfreeActivity() })
    const title = (await getDrillSet(id))!.title
    expect(title).toMatch(/^New items · /)
    expect(title).not.toMatch(/Hands-free/)
  })

  it.each(['learn', 'write'])('%s: the back link goes to the set page, labelled with the set title', async type => {
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}/run/${type}`
    render(<App />)
    const back = await screen.findByRole('link', { name: new RegExp(set.title) }, { timeout: 8000 })
    expect(back).toHaveAttribute('href', `#practice/set/${set.id}`)
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

describe('Type row icons', () => {
  it('labels Start, Continue and Restart per state, restarts a done type without asking, and asks first when answers exist', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    const now = (await getDrillSet(set.id))!
    const refs = now.refs.slice(0, 4)
    await db.drillSets.put({ ...now, progress: {
      meanings: { results: { [refs[0]]: 'got', [refs[1]]: 'missed' }, scope: refs, done: false, redos: 0 },
      match: { results: Object.fromEntries(refs.map(ref => [ref, 'got'])), scope: refs, done: true, redos: 0 },
    } } as never)
    window.location.hash = `#practice/set/${set.id}`
    render(<App />)
    const types = (await screen.findByRole('heading', { name: 'Pick a practice type' })).closest('section')!
    expect(within(types).getByRole('button', { name: 'Start Hands-free introduction' })).toHaveAttribute('title', 'Start')
    expect(within(types).getByRole('link', { name: 'Continue Word meanings' })).toHaveAttribute('title', 'Continue')
    const done = (await screen.findByRole('heading', { name: 'Pick a practice type' })).closest('section')!
    expect(within(done).getByRole('link', { name: /^Redo .*, done$/ })).toBeInTheDocument()
    await user.click(within(types).getByRole('button', { name: 'Restart Word meanings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Restart Word meanings?' })
    expect(dialog).toHaveTextContent('Your 2 answers so far stay in your history.')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect((await getDrillSet(set.id))!.progress.meanings).toBeDefined()
    await user.click(within(types).getByRole('button', { name: 'Restart Word meanings' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restart' }))
    await waitFor(async () => expect((await getDrillSet(set.id))!.progress.meanings).toBeUndefined())
    expect(window.location.hash).toBe(`#practice/set/${set.id}/run/meanings`)
    expect((await getDrillSet(set.id))!.progress.match?.done).toBe(true)
  }, 40000)

  it('restarting a stopped Hands-free run resets its position without a dialog', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    await db.drillSets.put({ ...set, handsfree: { seed: 1, settings: DEFAULT_HANDSFREE_SETTINGS, started: true, position: 4, done: false, layout: 2 } } as never)
    window.location.hash = `#practice/set/${set.id}`
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Continue Hands-free introduction at prompt 5' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restart Hands-free introduction' }))
    await waitFor(async () => expect((await getDrillSet(set.id))!.handsfree).toMatchObject({ started: false, position: 0, done: false }))
  }, 40000)
})

describe('Hands-free row and finished sets', () => {
  it('lists Hands-free first on the set page, starts it, and counts it among the types', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}`
    render(<App />)
    const types = (await screen.findByRole('heading', { name: 'Pick a practice type' })).closest('section')!
    const rows = within(types).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Hands-free introduction')
    expect(rows[1]).toHaveTextContent('Hands-free recall')
    expect(document.body).toHaveTextContent('0 of 11 types done')
    await user.click(within(rows[0]).getByRole('button', { name: 'Start Hands-free introduction' }))
    await waitFor(() => expect(window.location.hash).toBe(`#practice/set/${set.id}/handsfree`))
    expect((await getDrillSet(set.id))!.handsfree).toBeDefined()
  }, 40000)

  it('continues a stopped Hands-free run at its prompt; a done one gets a Done badge and Redo', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    await db.drillSets.put({ ...set, handsfree: { seed: 1, settings: DEFAULT_HANDSFREE_SETTINGS, started: true, position: 2, done: false } } as never)
    window.location.hash = `#practice/set/${set.id}`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Continue Hands-free introduction at prompt 3' }))
    await waitFor(() => expect(window.location.hash).toBe(`#practice/set/${set.id}/handsfree`))
    cleanup()
    const now = (await getDrillSet(set.id))!
    await db.drillSets.put({ ...now, handsfree: { ...now.handsfree!, done: true, position: 9 } } as never)
    window.location.hash = `#practice/set/${set.id}`
    render(<App />)
    const done = (await screen.findByRole('heading', { name: 'Pick a practice type' })).closest('section')!
    expect(done).toHaveTextContent('Played to the end')
    expect(document.body).toHaveTextContent('1 of 11 types done')
    await user.click(within(done).getByRole('button', { name: 'Redo Hands-free introduction, done' }))
    await waitFor(async () => expect((await getDrillSet(set.id))!.handsfree).toMatchObject({ done: false, started: false, position: 0 }))
  }, 40000)

  it('opens a finished set on its types list with a Summary button, and an untried type starts', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    await finishDrillSet(set.id)
    const knowledge = await db.knowledge.count()
    window.location.hash = `#practice/set/${set.id}`
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Pick a practice type' })).toBeInTheDocument()
    expect(document.body).toHaveTextContent('Finished')
    expect(screen.getByRole('link', { name: 'Summary' })).toHaveAttribute('href', `#practice/set/${set.id}/summary`)
    expect(screen.queryByRole('button', { name: 'Finish set' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start Hands-free introduction' })).toBeInTheDocument()
    await user.click(screen.getAllByRole('link', { name: /^Start / })[0])
    expect(window.location.hash).toMatch(/\/run\//)
    expect((await getDrillSet(set.id))!.status).toBe('completed')
    expect(await db.knowledge.count()).toBe(knowledge)
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

describe('Learn to write and Write it', () => {
  const ref = { sheng: 'vocabulary:xue2-sheng5--student', xi: 'vocabulary:xue2-xi2--study' }
  async function sharedSet(source: 'review' | 'new') {
    const set = await newSet()
    const sentences = { [ref.sheng]: { zh: '他是学生。', py: 'tā shì xué sheng.', en: 'He is a student.', source: 'catalog' as const }, [ref.xi]: { zh: '我学习中文。', py: 'wǒ xué xí zhōng wén.', en: 'I study Chinese.', source: 'catalog' as const } }
    const id = 'shared-' + source
    await db.drillSets.put({ ...set, id, source, refs: [ref.sheng, ref.xi], progress: {}, content: { state: 'ready', sentences, conversations: [] } })
    return id
  }
  const open = async (id: string, type: string) => { window.location.hash = `#practice/set/${id}/run/${type}`; render(<App />) }

  it('Learn to write is listed before Write it on the set page', async () => {
    const id = await sharedSet('new')
    window.location.hash = `#practice/set/${id}`
    render(<App />)
    const learn = await screen.findByText('Learn to write', undefined, { timeout: 8000 })
    expect(learn.compareDocumentPosition(screen.getByText('Write it')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }, 40000)

  it('Learn to write shows the word card, then the full loop for each character, and records Got it', async () => {
    const user = userEvent.setup()
    const id = await sharedSet('new')
    await open(id, 'learn')
    expect(await screen.findByText('Question 1 of 2', undefined, { timeout: 8000 })).toBeInTheDocument()
    expect(document.querySelector('.study-unit-card')).not.toBeNull()
    expect(screen.queryByRole('img', { name: 'Handwriting area' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /Learn to write it/ }))
    expect(await screen.findByText(/Character 1 of 2/)).toBeInTheDocument()
    expect((await screen.findAllByText(/Full guide/, undefined, { timeout: 8000 })).length).toBeGreaterThan(0)
    expect(document.querySelector('.writing-statusline')).toHaveTextContent('Full guide · 1/3')
    await user.click(screen.getByRole('button', { name: 'Next character' }))
    expect(await screen.findByText(/Character 2 of 2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next character' }))
    expect(await screen.findByText('Got it')).toBeInTheDocument()
    await waitFor(async () => expect(Object.values((await db.drillSets.get(id))!.progress.learn?.results ?? {})).toEqual(['got']))
  }, 40000)

  it('Previous goes back through the characters and across the word boundary; recorded results stay and the loop restarts fresh', async () => {
    const user = userEvent.setup()
    const id = await sharedSet('new')
    await open(id, 'learn')
    await user.click(await screen.findByRole('button', { name: /Learn to write it/ }, { timeout: 8000 }))
    expect(await screen.findByText(/Character 1 of 2/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'I already know how to write this' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Previous character' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/Character 1 of 2/)).toBeInTheDocument()
    expect(document.querySelector('.writing-statusline')).toHaveTextContent('Full guide \u00b7 2/3')
    await user.click(screen.getByRole('button', { name: 'Next character' }))
    expect(await screen.findByText(/Character 2 of 2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous character' }))
    expect(await screen.findByText(/Character 1 of 2/)).toBeInTheDocument()
    expect(document.querySelector('.writing-statusline')).toHaveTextContent('Full guide \u00b7 1/3')
    await user.click(screen.getByRole('button', { name: 'Next character' }))
    await user.click(screen.getByRole('button', { name: 'Next character' }))
    await user.click(await screen.findByRole('button', { name: /Next/ }))
    expect(await screen.findByText('Question 2 of 2')).toBeInTheDocument()
    await waitFor(async () => expect(Object.values((await db.drillSets.get(id))!.progress.learn?.results ?? {})).toEqual(['got']))
    await user.click(await screen.findByRole('button', { name: /Learn to write it/ }))
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Question 1 of 2')).toBeInTheDocument()
    expect(await screen.findByText(/Character 2 of 2/)).toBeInTheDocument()
    expect(document.querySelector('.writing-statusline')).toHaveTextContent('Full guide \u00b7 1/3')
    expect(Object.values((await db.drillSets.get(id))!.progress.learn?.results ?? {})).toEqual(['got'])
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText(/Character 1 of 2/)).toBeInTheDocument()
  }, 60000)

  it('Next character and Previous character move between characters without recording anything', async () => {
    const user = userEvent.setup()
    const id = await sharedSet('new')
    await open(id, 'learn')
    await user.click(await screen.findByRole('button', { name: /Learn to write it/ }, { timeout: 8000 }))
    expect(await screen.findByText(/Character 1 of 2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next character' }))
    expect(await screen.findByText(/Character 2 of 2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText(/Character 1 of 2/)).toBeInTheDocument()
    expect(document.querySelector('.writing-statusline')).toHaveTextContent('Full guide \u00b7 1/3')
    await user.click(screen.getByRole('button', { name: 'Next character' }))
    expect(await screen.findByText(/Character 2 of 2/)).toBeInTheDocument()
    expect(await db.characterStates.count()).toBe(0)
  }, 60000)

  it('Next in the loop moves to the next part of the same character, and records nothing', async () => {
    const user = userEvent.setup()
    const id = await sharedSet('new')
    await open(id, 'learn')
    await user.click(await screen.findByRole('button', { name: /Learn to write it/ }, { timeout: 8000 }))
    await screen.findAllByText(/Full guide/, undefined, { timeout: 8000 })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/Character 1 of 2/)).toBeInTheDocument()
    expect(document.querySelector('.writing-statusline')).toHaveTextContent('Full guide \u00b7 2/3')
    expect(await db.characterStates.count()).toBe(0)
  }, 40000)

  it('Write it is a test only: no Learn / Test switch, no teaching, Write elsewhere for reviews', async () => {
    const id = await sharedSet('review')
    await open(id, 'write')
    expect(await screen.findByRole('button', { name: 'Write elsewhere', pressed: true }, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Learn' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Characters' })).toBeNull()
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument()
    expect(document.querySelector('.dr-write-line')!.textContent).toMatch(/^Write \S+ \S+$/)
  }, 40000)

  it('a new-item set opens Write it on the pad straight away, without teaching', async () => {
    const id = await sharedSet('new')
    await open(id, 'write')
    expect(await screen.findByRole('img', { name: 'Handwriting area' }, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'I already know how to write this' })).toBeNull()
  }, 40000)

  it('Reveal shows the Chinese sentence and counts as a hint', async () => {
    const user = userEvent.setup()
    const id = await sharedSet('review')
    await open(id, 'write')
    await user.click(await screen.findByRole('button', { name: /Reveal/ }, { timeout: 8000 }))
    expect(document.querySelector('.dr-sentence-zh')).toHaveTextContent(/^(他是学生。|我学习中文。)$/)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(await screen.findByText('Needed a hint')).toBeInTheDocument()
  }, 40000)

  it('Practise writing opens the loop inline, returns to the question and counts as a hint', async () => {
    const user = userEvent.setup()
    const id = await sharedSet('review')
    await open(id, 'write')
    await user.click(await screen.findByRole('button', { name: /Practise writing/ }, { timeout: 8000 }))
    expect((await screen.findAllByText(/Full guide/, undefined, { timeout: 8000 })).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Back to the question' }))
    expect(await screen.findByRole('button', { name: 'Check answer' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(await screen.findByText('Needed a hint')).toBeInTheDocument()
  }, 40000)
})

describe('Practise writing goes back within the word', () => {
  it('Previous returns from the second character to the first, which starts fresh', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    const id = 'practise-back'
    await db.drillSets.put({ ...set, id, source: 'review', progress: {}, refs: ['vocabulary:xue2-sheng5--student'], content: { state: 'ready', sentences: { 'vocabulary:xue2-sheng5--student': { zh: '他是学生。', py: 'tā shì xué sheng.', en: 'He is a student.', source: 'catalog' } }, conversations: [] } })
    window.location.hash = `#practice/set/${id}/run/write`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Practise writing/ }, { timeout: 8000 }))
    expect(await screen.findByText(/Character 1 of 2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next character' }))
    expect(await screen.findByText(/Character 2 of 2/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText(/Character 1 of 2/)).toBeInTheDocument()
    expect(document.querySelector('.writing-statusline')).toHaveTextContent('Full guide \u00b7 1/3')
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
