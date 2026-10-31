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
// The stroke data is fetched from static files; the tests give every character one stroke.
vi.mock('../../core/characters/assets', async importOriginal => ({ ...await importOriginal<typeof import('../../core/characters/assets')>(),
  loadCharacterAsset: async (character: string) => ({ character, strokeCount: 1, reviewed: true, variant: 'reviewed-monoline', paths: ['M10 50 L90 50'] }) }))

beforeEach(async () => {
  localStorage.clear()
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
    const start = await screen.findByRole('button', { name: 'Start new items' })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    expect(await screen.findByRole('heading', { name: /^New items · \d+ \w{3}$/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Intro cards/ })).toBeInTheDocument()
    expect(document.querySelectorAll('.study-unit-card').length).toBeGreaterThan(0)
    await user.click(screen.getAllByRole('link', { name: /Start drilling/ })[0])
    expect(await screen.findByRole('heading', { name: 'Pick a drill type' })).toBeInTheDocument()
    // There is no "Learning from" selector on the set screen.
    expect(screen.queryByLabelText('Learning from')).toBeNull()
    await user.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: /Drills/ }))
    const unfinished = await screen.findByRole('heading', { name: 'Unfinished sets' })
    const row = unfinished.closest('section')!
    expect(await within(row).findByText(/New items · \d+ \w{3}/)).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: /^Discard New items/ }))
    expect(within(row).getByRole('button', { name: 'Keep' })).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Keep' }))
    expect(within(row).getByText(/New items/)).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: /^Discard New items/ }))
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

  it('Write it elsewhere: a hint turns Got it into Needed a hint', async () => {
    const user = userEvent.setup()
    const set = await newSet()
    window.location.hash = `#drills/set/${set.id}/run/write`
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
  it('sits above both rows and drives the New items and Reviews counts and starts', async () => {
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
    window.location.hash = `#drills/set/${id}/run/write`
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
    window.location.hash = `#drills/set/${id}/run/write`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Whole words' }, { timeout: 8000 }))
    expect(document.querySelector('.dr-write-line')!.textContent).toMatch(/^Write \S+ \S+$/)
    expect(document.querySelector('.dr-pinyin-prompt mark')!.textContent).toMatch(/\S+ \S+/)
    expect(localStorage.getItem('drills.write')).toContain('words')
  }, 40000)

  it('new-item sets open on the pad, where an unwritten character is taught first, and can be skipped', async () => {
    const user = userEvent.setup()
    const id = await sharedSet('new')
    window.location.hash = `#drills/set/${id}/run/write`
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Handwriting pad', pressed: true }, { timeout: 8000 })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'I already know how to write this' }, { timeout: 8000 }))
    expect(await screen.findByRole('img', { name: 'Handwriting area' })).toBeInTheDocument()
  }, 40000)
})

describe('no sideways overflow at 390 px', () => {
  const LONG = '大婚撞破未婚夫和繼妹，我轉身嫁給他昏迷的四叔'
  const fits = () => { const root = document.documentElement; return root.scrollWidth <= root.clientWidth }
  it('keeps Drills home and the set screen inside the screen, with a long Chinese study-set name', async () => {
    window.innerWidth = 390
    await db.collections.put({ id: 'long', name: LONG, createdAt: 1, updatedAt: 1 } as never)
    const set = await newSet()
    await db.drillSets.put({ ...set, title: LONG })
    window.location.hash = '#drills'
    const view = render(<App />)
    await screen.findByLabelText('Learning from')
    expect(fits()).toBe(true)
    // Study sets are only in the selector: there is no second list of them under the rows.
    expect(screen.queryByText(/can also be started whole/)).toBeNull()
    expect(screen.queryByRole('button', { name: `Start ${LONG}` })).toBeNull()
    // Every row of the card keeps its own text inside it (jsdom has no layout, so check the wrapping rules are on the elements).
    for (const element of view.container.querySelectorAll('.dr-rows strong, .resume-main strong, .dr-source select')) expect(element.closest('.dr-panel')).not.toBeNull()
    window.location.hash = `#drills/set/${set.id}`
    expect(await screen.findByRole('heading', { name: LONG }, { timeout: 8000 })).toBeInTheDocument()
    expect(fits()).toBe(true)
  }, 40000)
})
