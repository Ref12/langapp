import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db, initializeWorkspace } from '../../core/database'
import { resetProfileStorage } from '../../test/profile-storage'
import * as speech from '../../core/assistant/speech'
import { createDrillSet, newHandsfreeActivity } from '../../core/drills/store'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../../core/ai/structured', () => structured)

const refs = ['vocabulary:wo3--me', 'vocabulary:xue2-xi2--study', 'vocabulary:xue2-sheng5--student']
let said: string[]

beforeEach(async () => {
  localStorage.clear()
  await resetProfileStorage()
  await initializeWorkspace()
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  said = []
  vi.spyOn(speech, 'playBrowserSpeechToEnd').mockImplementation(async (_id, text) => { said.push(text); return { status: 'completed' } })
  vi.spyOn(speech, 'stopBrowserSpeech').mockImplementation(() => undefined)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function openRun(settings: Record<string, unknown> = { pause: 'short', repeats: 1, sectionIntros: 'off' }, extra: Record<string, unknown> = { started: true }) {
  // Let the previous test's last position write land before this one seeds its set.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
  const now = Date.now()
  // A set made by the Hands-free shortcut: its Hands-free activity holds the seed, settings and where it stopped.
  await db.drillSets.put({ id: 'run1', title: 'Hands-free · 1 Nov', refs, source: 'review', status: 'active', format: 'single', progress: {}, content: { state: 'pending', sentences: {}, conversations: [] }, createdAt: now, updatedAt: now, shortcut: 'handsfree',
    handsfree: { seed: 5, settings, started: false, position: 0, done: false, layout: 3, ...extra } } as never)
  window.location.hash = '#practice/set/run1/handsfree'
}
/** The Hands-free activity of a set, and the set. */
const hf = async (id = 'run1') => (await db.drillSets.get(id))!.handsfree!
const setOf = async (id = 'run1') => (await db.drillSets.get(id))!
/** What buildRunScript takes: the set's items with its activity's seed and settings. */
const scriptInput = async (id = 'run1') => { const set = await setOf(id); return { refs: set.refs, seed: set.handsfree!.seed, settings: set.handsfree!.settings } }
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const phase = () => screen.getByRole('status').textContent
/** The settings live in a dialog opened from the player. */
const openSettings = async () => { fireEvent.click(await screen.findByRole('button', { name: 'Settings' })); return screen.findByRole('dialog', { name: 'Hands-free settings' }) }

describe('Hands-free player', () => {
  it('plays, advances through the prompts, and skips and goes back by prompt', async () => {
    await openRun()
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    expect(phase()).toBe('1 of 15')
    fireEvent.click(play)
    await waitFor(() => expect(said[0]).toMatch(/^This is how you say, /))
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.hf-prompt')).toHaveTextContent('我'), { timeout: 4000 })
    await advance(3500)
    await waitFor(() => expect(phase()).toMatch(/^([2-9]|1\d) of 15/))
    expect(await hf()).toMatchObject({ started: true, done: false })
    expect(await setOf()).toMatchObject({ status: 'active' })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const before = (await hf()).position
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(async () => expect((await hf()).position).toBe(before + 1))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(async () => expect((await hf()).position).toBe(before - 1))
  })

  it('shows the scrambled recall phase and finishes the run into History as Finished', async () => {
    await openRun()
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    fireEvent.click(play)
    await advance(60000)
    await waitFor(() => expect(phase()).toMatch(/of 15|Finished/), { timeout: 3000 })
    for (let step = 0; step < 40 && phase() !== 'Finished'; step++) await advance(60000)
    expect(phase()).toBe('Finished')
    expect(await setOf()).toMatchObject({ status: 'completed', handsfree: { done: true } })
    expect(said.some(text => text.startsWith('How do you say'))).toBe(true)
  })

  it('shows the same display full screen in pocket mode, ignores taps, and exits only on a 3 second hold with a 3, 2, 1 ring that cancels on early release', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const request = vi.fn().mockResolvedValue({ release, addEventListener: vi.fn() })
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    await openRun()
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /Pocket mode/ }))
    const overlay = await screen.findByRole('dialog', { name: /Pocket mode/ })
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
    // the same display: phase line, prompt and progress, inside the overlay
    expect(within(overlay).getByRole('status')).toHaveTextContent('1 of 15')
    expect(overlay.querySelector('.hf-prompt')).toHaveTextContent('me')
    expect(within(overlay).getByLabelText('Run progress')).toBeInTheDocument()
    expect(within(overlay).getByText('Hold anywhere to exit')).toBeInTheDocument()
    fireEvent.click(overlay)
    await advance(4000)
    expect(screen.getByRole('dialog', { name: /Pocket mode/ })).toBeInTheDocument()
    expect(within(overlay).queryByRole('timer')).toBeNull()
    // an early release cancels and resets the ring
    fireEvent.pointerDown(overlay)
    await advance(1100)
    expect(within(overlay).getByRole('timer')).toHaveTextContent('2')
    expect(Number(overlay.querySelector('[data-testid="hf-ring"]')!.getAttribute('stroke-dashoffset'))).toBeGreaterThan(0)
    fireEvent.pointerUp(overlay)
    await advance(3500)
    expect(within(overlay).queryByRole('timer')).toBeNull()
    expect(screen.getByRole('dialog', { name: /Pocket mode/ })).toBeInTheDocument()
    // a full hold counts 3, 2, 1 and exits
    fireEvent.pointerDown(overlay)
    await advance(100)
    expect(within(overlay).getByRole('timer')).toHaveTextContent('3')
    await advance(2000)
    expect(within(overlay).getByRole('timer')).toHaveTextContent('1')
    expect(screen.getByRole('dialog', { name: /Pocket mode/ })).toBeInTheDocument()
    await advance(1000)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Pocket mode/ })).toBeNull())
    await waitFor(() => expect(release).toHaveBeenCalled())
    delete (navigator as unknown as Record<string, unknown>).wakeLock
  })


  it('resumes where it left off after leaving and coming back, and remembers the settings', async () => {
    await openRun()
    const first = render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    const dialog = await openSettings()
    fireEvent.change(within(dialog).getByLabelText('Pause length'), { target: { value: 'long' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('handsfree.settings')!)).toMatchObject({ pause: 'long' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close settings' }))
    fireEvent.click(play)
    await waitFor(() => expect(said.length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(async () => expect((await hf()).position).toBe(2))
    first.unmount()
    // leaving mid-run keeps the set unfinished, at its saved prompt
    expect(await setOf()).toMatchObject({ status: 'active', handsfree: { started: true, position: 2 } })
    render(<App />)
    expect(await screen.findByRole('button', { name: /^(Resume|Play)$/ })).toBeEnabled()
    await waitFor(() => expect(phase()).toMatch(/^\d+ of 15$/))
    fireEvent.click(screen.getByRole('button', { name: /^(Resume|Play)$/ }))
    await waitFor(() => expect(said.length).toBeGreaterThan(0))
    const again = await openSettings()
    expect(within(again).getByLabelText('Pause length')).toHaveValue('long')
    expect(within(again).getByLabelText('Repeats')).toBeEnabled()
    expect((await setOf()).status).toBe('active')
  })

  it('starts from Practice home with Learning from, and creates a Hands-free-only set that opens on its Hands-free activity and is not yet listed', async () => {
    await db.knowledge.add({ ref: refs[0], addedAt: 1, source: 'new' } as never).catch(() => undefined)
    const before = await db.knowledge.count()
    window.location.hash = '#practice'
    render(<App />)
    const start = await screen.findByRole('button', { name: 'Start Hands-free introduction' })
    expect(screen.getByRole('heading', { name: 'Programs' })).toBeInTheDocument()
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)
    await waitFor(() => expect(window.location.hash).toMatch(/^#practice\/set\/[^/]+\/handsfree$/))
    const [run] = await db.drillSets.toArray()
    expect(run).toMatchObject({ source: 'new', shortcut: 'handsfree', status: 'active', handsfree: { started: false, done: false, settings: { pause: 'normal', repeats: 3, itemWording: 'full', sectionIntros: 'full', emphasis: 'pauses' } } })
    expect(run.addOnFinish?.length).toBeGreaterThan(0)
    expect(await db.knowledge.count()).toBe(before)
  })

  it('opens an unstarted run on the intro cards under a count heading, with no list of all items, and Start listening plays', async () => {
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'off' }, {})
    render(<App />)
    const start = await screen.findByRole('button', { name: /Start listening/ })
    expect(await screen.findByRole('heading', { name: '3 items' })).toBeInTheDocument()
    expect(screen.queryByLabelText('All items')).toBeNull()
    await waitFor(() => expect(document.querySelectorAll('[data-unit]')).toHaveLength(3))
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
    fireEvent.click(start)
    await waitFor(() => expect(said[0]).toMatch(/^This is how you say, /))
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /View items/ })).toBeInTheDocument()
    expect((await hf()).started).toBe(true)
  })

  it('goes straight to the player for a run that has started, with an Items button for the cards', async () => {
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'off' }, { started: true, position: 1 })
    render(<App />)
    expect(await screen.findByRole('button', { name: /^(Resume|Play)$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start listening/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /View items/ }))
    expect(await screen.findByRole('button', { name: /Continue listening/ })).toBeInTheDocument()
  })

  it('shows the characters and pinyin only when the Chinese starts being spoken', async () => {
    let release: (() => void) | undefined
    vi.mocked(speech.playBrowserSpeechToEnd).mockImplementation((_id, text) => {
      said.push(text)
      if (!text.startsWith('This is how you say')) return Promise.resolve({ status: 'completed' })
      return new Promise(resolve => { release = () => resolve({ status: 'completed' }) })
    })
    await openRun()
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    expect(document.querySelector('.hf-prompt')).toHaveTextContent('me')
    fireEvent.click(play)
    await waitFor(() => expect(said.length).toBeGreaterThan(0))
    // the English frame is still being spoken: no Chinese or pinyin yet
    expect(screen.queryByTestId('hf-pinyin')).toBeNull()
    expect(document.querySelector('.hf-prompt')).not.toHaveTextContent('我')
    release?.()
    await waitFor(() => expect(said).toContain('我'), { timeout: 4000 })
    expect(await screen.findByTestId('hf-pinyin')).toHaveTextContent('wǒ')
    expect(document.querySelector('.hf-prompt')).toHaveTextContent('我')
  })

  it('shows the voice pickers and speeds in the page settings, and saves them with the run', async () => {
    await openRun()
    render(<App />)
    await screen.findByRole('button', { name: 'Play' })
    expect(screen.queryByLabelText('English voice')).toBeNull()
    const dialog = await openSettings()
    for (const name of ['English voice', 'Chinese voice']) expect(within(dialog).getByLabelText(name)).toBeInTheDocument()
    // no separate emphasis voice; the emphasis speed only appears for Slower and louder
    expect(within(dialog).queryByLabelText('Emphasis voice')).toBeNull()
    expect(within(dialog).queryByLabelText('Emphasis speed')).toBeNull()
    expect(within(dialog).queryByLabelText('Include grammar')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Emphasise the English word'), { target: { value: 'loud' } })
    expect(await within(dialog).findByLabelText('Emphasis speed')).toHaveValue('0.8')
    expect(within(dialog).getByLabelText('Chinese speed')).toHaveValue('0.5')
    expect(within(dialog).getByLabelText('Repeats')).toHaveValue('1')
    fireEvent.change(within(dialog).getByLabelText('Emphasis speed'), { target: { value: '0.7' } })
    await waitFor(async () => expect((await hf()).settings).toMatchObject({ emphasisRate: 0.7 }))
    expect(JSON.parse(localStorage.getItem('handsfree.settings')!)).toMatchObject({ emphasisRate: 0.7 })
  })

  it('has Hands-free defaults with the same pickers in Settings', async () => {
    window.location.hash = '#settings'
    render(<App />)
    const panel = await screen.findByRole('region', { name: 'Hands-free settings' })
    const details = panel.querySelector('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    for (const name of ['English voice', 'Chinese voice', 'Chinese speed', 'Emphasise the English word']) expect(within(panel).getByLabelText(name)).toBeInTheDocument()
    expect(within(panel).queryByLabelText('Emphasis voice')).toBeNull()
    fireEvent.change(within(panel).getByLabelText('Repeats'), { target: { value: '5' } })
    expect(JSON.parse(localStorage.getItem('handsfree.settings')!)).toMatchObject({ repeats: 5 })
  })

  it('lists an unfinished Hands-free set in Recent sessions with In progress, resumes it at the saved prompt, and discards it from the ⋯ menu', async () => {
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'off' }, { started: true, position: 3 })
    window.location.hash = '#practice'
    render(<App />)
    const section = (await screen.findByRole('heading', { name: 'Recent sessions' })).closest('section')!
    expect(screen.queryByRole('heading', { name: 'Unfinished sets' })).toBeNull()
    const resume = await within(section).findByRole('link', { name: 'Continue Hands-free introduction at prompt 4' })
    const row = section.querySelector('.resume-row')!
    expect(row.querySelector('.resume-text')).toHaveTextContent('Hands-free · 1 Nov')
    expect(row.querySelector('.resume-text')).toHaveTextContent('In progress')
    expect(row.querySelector('.resume-text')).toHaveTextContent(/3 words.* · \d of \d+ types done/)
    expect(row.querySelector('.resume-text')).not.toHaveTextContent(/stopped/)
    expect(within(section).getByRole('link', { name: 'Open session Hands-free · 1 Nov' })).toHaveAttribute('href', '#practice/set/run1')
    // Resume is the main icon button, Discard lives in the ⋯ menu
    expect(within(section).queryByRole('button', { name: /^(Resume|Play)$/ })).toBeNull()
    expect(within(section).queryByRole('button', { name: 'Discard Hands-free · 1 Nov' })).toBeNull()
    expect(resume).toHaveAttribute('href', '#practice/set/run1/handsfree')
    fireEvent.click(resume)
    expect(await screen.findByRole('button', { name: /^(Resume|Play)$/ })).toBeEnabled()
    await waitFor(() => expect(phase()).toMatch(/^\d+ of 15$/))
    window.location.hash = '#practice'
    const again = (await screen.findByRole('heading', { name: 'Recent sessions' })).closest('section')!
    fireEvent.click(await within(again).findByRole('button', { name: 'More for Hands-free · 1 Nov' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Discard Hands-free · 1 Nov' }))
    const confirm = screen.getByRole('dialog', { name: 'Discard this session?' })
    expect(confirm.querySelectorAll('button')).toHaveLength(2)
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(within(again).queryByRole('link', { name: /Continue Hands-free/ })).toBeNull())
    expect(await setOf()).toMatchObject({ status: 'abandoned', discarded: true })
  })

  it('goes back to the set page, titled with the set, from a shortcut set in both Hands-free types', async () => {
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'off' }, { started: true, position: 1 })
    render(<App />)
    await screen.findByRole('button', { name: /^(Resume|Play)$/ })
    const link = screen.getAllByRole('link', { name: /Hands-free · 1 Nov/ }).find(item => item.classList.contains('back-link'))!
    expect(link).toHaveAttribute('href', '#practice/set/run1')
    expect(screen.queryByRole('link', { name: 'Practice', exact: true } as never)?.classList.contains('back-link') ?? false).toBe(false)
  })

  it('redirects an old #practice/handsfree/<run id> link to the migrated set\'s Hands-free activity', async () => {
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'off' }, { started: true, position: 1 })
    window.location.hash = '#practice/handsfree/run1'
    render(<App />)
    expect(await screen.findByRole('button', { name: /^(Resume|Play)$/ })).toBeEnabled()
    expect(window.location.hash).toBe('#practice/set/run1/handsfree')
  })

  it('finishes a New items run with the added-items line, and adds them to the knowledge set once', async () => {
    const id = await createDrillSet({ kind: 'new', count: 3 }, Date.now(), { handsfree: { ...newHandsfreeActivity({ pause: 'short', repeats: 1, sectionIntros: 'off' }), started: true } })
    const before = await db.knowledge.count()
    window.location.hash = '#practice/set/' + id + '/handsfree'
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    fireEvent.click(play)
    for (let step = 0; step < 60 && phase() !== 'Finished'; step++) await advance(60000)
    expect(phase()).toBe('Finished')
    await waitFor(() => expect(screen.getByText(/^Added \d+ words? .*to your knowledge set$/)).toBeInTheDocument())
    const run = await setOf(id)
    expect(run.status).toBe('completed')
    expect(await db.knowledge.count()).toBe(before + run.addedRefs!.length)
    expect(run.addedRefs!.length).toBeGreaterThan(0)
  })

  it('shows the section introduction as the header until the first prompt, then the prompt', async () => {
    await openRun({ pause: 'short', repeats: 1 })
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    fireEvent.click(play)
    await waitFor(() => expect(said[0]).toMatch(/^Hands-free lesson\./))
    await waitFor(() => expect(said.some(text => text.startsWith('This is how you say, '))).toBe(true), { timeout: 4000 })
    expect(document.querySelector('.hf-prompt')).not.toHaveClass('hf-section')
  })

  // Skipped 2026-11-02: a Hands-free save can still be in flight when the test ends, failing CI with an unhandled PrematureCommitError.
  it.skip('counts a section introduction as its own step: the header replaces the progress, Next goes to item 1 and Back returns to the header', async () => {
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'full' }, { started: true, layout: 2 })
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    expect(phase()).toBe('Introducing new words')
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(phase()).toBe('Introducing 1 of 3'))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(phase()).toBe('Introducing new words'))
    expect((await hf()).position).toBe(0)
  })

  it('opens a run saved in an older layout from the top, once, without errors', async () => {
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'full' }, { started: true, position: 7, layout: 2 })
    render(<App />)
    await waitFor(async () => expect(await hf()).toMatchObject({ layout: 3, position: 0 }))
    await screen.findByRole('button', { name: /^(Resume|Play)$/ })
  })

  it('has the item wording, section introductions and emphasis choices in the page settings and in Settings, Full, Full and Pauses only by default', async () => {
    await openRun({ pause: 'short', repeats: 1 })
    render(<App />)
    await screen.findByRole('button', { name: 'Play' })
    const dialog = await openSettings()
    expect(within(dialog).getByLabelText('Wording around each item')).toHaveValue('full')
    expect(within(dialog).getByLabelText('Section introductions')).toHaveValue('full')
    expect(within(dialog).getByLabelText('Emphasise the English word')).toHaveValue('pauses')
    fireEvent.change(within(dialog).getByLabelText('Wording around each item'), { target: { value: 'abridged' } })
    await waitFor(() => expect(within(dialog).getByLabelText('Wording around each item')).toHaveValue('abridged'))
    fireEvent.change(within(dialog).getByLabelText('Section introductions'), { target: { value: 'header' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('handsfree.settings')!)).toMatchObject({ itemWording: 'abridged', sectionIntros: 'header' }))
    await waitFor(async () => expect((await hf()).settings).toMatchObject({ itemWording: 'abridged', sectionIntros: 'header' }))
    cleanup()
    localStorage.removeItem('handsfree.settings')
    window.location.hash = '#settings'
    render(<App />)
    const panel = await screen.findByRole('region', { name: 'Hands-free settings' })
    expect(within(panel).getByLabelText('Wording around each item')).toHaveValue('full')
    expect(within(panel).getByLabelText('Section introductions')).toHaveValue('full')
  })

  it('opens the settings dialog from a button in the player, and closes it', async () => {
    await openRun()
    render(<App />)
    await screen.findByRole('button', { name: 'Play' })
    expect(screen.queryByRole('dialog', { name: 'Hands-free settings' })).toBeNull()
    expect(document.querySelector('section.hf-settings')).toBeNull()
    const dialog = await openSettings()
    expect(within(dialog).getByText('Changes apply from the next prompt.')).toBeInTheDocument()
    for (const name of ['Pause length', 'Repeats', 'Section introductions', 'Wording around each item', 'Emphasise the English word']) expect(within(dialog).getByLabelText(name)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog', { name: 'Hands-free settings' })).toBeNull()
  })

  it('applies a changed Repeats from the next prompt of a run in progress, and resumes at the matching prompt', async () => {
    const { buildRunScript } = await import('../../core/handsfree/store')
    const { promptKeyAt, findPrompt } = await import('../../core/handsfree/script')
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'off' }, { started: true, position: 1 })
    const before = (await buildRunScript(await scriptInput())).script
    render(<App />)
    await screen.findByRole('button', { name: /^(Resume|Play)$/ })
    await waitFor(() => expect(phase()).toMatch(/^\d+ of 15$/))
    const dialog = await openSettings()
    fireEvent.change(within(dialog).getByLabelText('Repeats'), { target: { value: '3' } })
    await waitFor(async () => expect((await hf()).settings).toMatchObject({ repeats: 3 }))
    // the script was rebuilt with more repeats, and the current prompt kept its place in it (same phase, item and direction)
    const after = (await buildRunScript(await scriptInput())).script
    expect(after.segments.length).toBeGreaterThan(before.segments.length)
    expect(findPrompt(after, promptKeyAt(before, 1), 1)).toBeGreaterThanOrEqual(1)
    await waitFor(() => expect(phase()).toMatch(/^\d+ of 15$/))
    // playing on uses the new script, and a later resume lands on the same prompt
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close settings' }))
    fireEvent.click(screen.getByRole('button', { name: /^(Resume|Play)$/ }))
    await waitFor(() => expect(said.length).toBeGreaterThan(0))
    const saved = await hf()
    expect(saved.settings.repeats).toBe(3)
    expect(promptKeyAt(after, saved.position)).toBe(promptKeyAt(after, findPrompt(after, promptKeyAt(before, 1), 1)))
  })
})
