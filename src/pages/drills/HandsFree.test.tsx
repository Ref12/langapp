import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db, initializeWorkspace } from '../../core/database'
import { resetProfileStorage } from '../../test/profile-storage'
import * as speech from '../../core/assistant/speech'
import { createHandsfreeRun } from '../../core/handsfree/store'

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
  const now = Date.now()
  await db.handsfreeRuns.put({ id: 'run1', title: 'Hands-free · 1 Nov', refs, source: 'review', seed: 5, settings, status: 'active', started: false, position: 0, createdAt: now, updatedAt: now, ...extra } as never)
  window.location.hash = '#practice/handsfree/run1'
}
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
    expect(phase()).toBe('Introducing 1 of 3')
    fireEvent.click(play)
    await waitFor(() => expect(said[0]).toMatch(/^This is how you say, /))
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('.hf-prompt')).toHaveTextContent('我'), { timeout: 4000 })
    await advance(3500)
    await waitFor(() => expect(phase()).toMatch(/^Introducing [23] of 3/))
    expect((await db.handsfreeRuns.get('run1'))).toMatchObject({ started: true, status: 'active' })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    const before = (await db.handsfreeRuns.get('run1'))!.position
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(async () => expect((await db.handsfreeRuns.get('run1'))!.position).toBe(before + 1))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(async () => expect((await db.handsfreeRuns.get('run1'))!.position).toBe(before - 1))
  })

  it('shows the scrambled recall phase and finishes the run into History as Finished', async () => {
    await openRun()
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    fireEvent.click(play)
    await advance(60000)
    await waitFor(() => expect(phase()).toMatch(/Scrambled recall|Mixed round|Finished|Recall/), { timeout: 3000 })
    for (let step = 0; step < 40 && phase() !== 'Finished'; step++) await advance(60000)
    expect(phase()).toBe('Finished')
    expect(await db.handsfreeRuns.get('run1')).toMatchObject({ status: 'completed' })
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
    expect(within(overlay).getByRole('status')).toHaveTextContent('Introducing 1 of 3')
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
    await waitFor(async () => expect((await db.handsfreeRuns.get('run1'))!.position).toBe(2))
    first.unmount()
    await waitFor(async () => expect((await db.handsfreeRuns.get('run1'))!.status).toBe('abandoned'))
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeEnabled()
    await waitFor(() => expect(phase()).toBe('Introducing 2 of 3'))
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(said.length).toBeGreaterThan(0))
    const again = await openSettings()
    expect(within(again).getByLabelText('Pause length')).toHaveValue('long')
    expect(within(again).getByLabelText('Repeats')).toBeEnabled()
    expect((await db.handsfreeRuns.get('run1'))!.status).toBe('active')
  })

  it('starts from Practice home with Learning from, and creates a run that is not yet in History', async () => {
    await db.knowledge.add({ ref: refs[0], addedAt: 1, source: 'new' } as never).catch(() => undefined)
    const before = await db.knowledge.count()
    window.location.hash = '#practice'
    render(<App />)
    const start = await screen.findByRole('button', { name: 'Start Hands-free' })
    expect(screen.getByRole('heading', { name: 'Programs' })).toBeInTheDocument()
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)
    await waitFor(() => expect(window.location.hash).toMatch(/^#practice\/handsfree\//))
    const [run] = await db.handsfreeRuns.toArray()
    expect(run).toMatchObject({ source: 'new', started: false, status: 'active', settings: { pause: 'normal', repeats: 3, itemWording: 'full', sectionIntros: 'full', emphasis: 'pauses' } })
    expect(run.addOnComplete?.length).toBeGreaterThan(0)
    expect(await db.knowledge.count()).toBe(before)
    expect(await createHandsfreeRun({ kind: 'new' })).toBeTruthy()
  })

  it('opens an unstarted run on the intro cards with an item list, and Start listening plays', async () => {
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'off' }, {})
    render(<App />)
    const start = await screen.findByRole('button', { name: /Start listening/ })
    const list = await screen.findByLabelText('All items')
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    await waitFor(() => expect(document.querySelectorAll('[data-unit]')).toHaveLength(3))
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
    fireEvent.click(start)
    await waitFor(() => expect(said[0]).toMatch(/^This is how you say, /))
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Items/ })).toBeInTheDocument()
    expect((await db.handsfreeRuns.get('run1'))!.started).toBe(true)
  })

  it('goes straight to the player for a run that has started, with an Items button for the cards', async () => {
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'off' }, { started: true, position: 1 })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start listening/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Items/ }))
    expect(await screen.findByRole('button', { name: /Start listening/ })).toBeInTheDocument()
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
    await waitFor(async () => expect((await db.handsfreeRuns.get('run1'))!.settings).toMatchObject({ emphasisRate: 0.7 }))
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

  it('lists an unfinished run on Practice home, resumes it at the saved prompt, and discards it', async () => {
    await openRun({ pause: 'short', repeats: 1, sectionIntros: 'off' }, { started: true, status: 'abandoned', position: 3 })
    window.location.hash = '#practice'
    render(<App />)
    const section = (await screen.findByRole('heading', { name: 'Unfinished sets' })).closest('section')!
    await within(section).findByRole('link', { name: 'Resume Hands-free · 1 Nov' })
    const row = section.querySelector('.resume-row')!
    expect(row.querySelector('.resume-text')).toHaveTextContent('Hands-free · 1 Nov')
    expect(row.querySelector('.resume-text')).toHaveTextContent('Hands-free · 3 items · stopped at prompt 4')
    // the same pattern as a practice set: resume and discard are icon buttons on the right, no text Resume button
    expect([...row.children].map(child => child.className)).toEqual(['resume-text', 'icon-button', 'icon-button'])
    expect(within(section).queryByRole('button', { name: 'Resume' })).toBeNull()
    const resume = await within(section).findByRole('link', { name: 'Resume Hands-free · 1 Nov' })
    expect(resume).toHaveAttribute('href', '#practice/handsfree/run1')
    fireEvent.click(resume)
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeEnabled()
    await waitFor(() => expect(phase()).toBe('Introducing 3 of 3'))
    window.location.hash = '#practice'
    const again = (await screen.findByRole('heading', { name: 'Unfinished sets' })).closest('section')!
    fireEvent.click(await within(again).findByRole('button', { name: 'Discard Hands-free · 1 Nov' }))
    // the question is its own full-width line under the meta; the title does not move
    const confirm = within(again).getByRole('group', { name: 'Discard Hands-free · 1 Nov?' })
    expect(confirm.parentElement).toBe(again.querySelector('.resume-row'))
    expect(confirm).toHaveTextContent('Discard this set?')
    expect(confirm.querySelectorAll('button')).toHaveLength(2)
    expect(again.querySelector('.resume-text')).toHaveTextContent('Hands-free · 1 Nov')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(within(again).queryByRole('link', { name: /Resume Hands-free/ })).toBeNull())
    expect((await db.handsfreeRuns.get('run1'))!.discarded).toBe(true)
  })

  it('finishes a New items run with the added-items line, and adds them to the knowledge set once', async () => {
    const id = await createHandsfreeRun({ kind: 'new', count: 3 })
    await db.handsfreeRuns.update(id, { settings: { pause: 'short', repeats: 1, sectionIntros: 'off' }, started: true })
    const before = await db.knowledge.count()
    window.location.hash = '#practice/handsfree/' + id
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    fireEvent.click(play)
    for (let step = 0; step < 60 && phase() !== 'Finished'; step++) await advance(60000)
    expect(phase()).toBe('Finished')
    await waitFor(() => expect(screen.getByText(/^Added \d+ words? .*to your knowledge set$/)).toBeInTheDocument())
    const run = (await db.handsfreeRuns.get(id))!
    expect(await db.knowledge.count()).toBe(before + run.addedRefs!.length)
    expect(run.addedRefs!.length).toBeGreaterThan(0)
  })

  it('shows the section introduction as the header until the first prompt, then the prompt', async () => {
    await openRun({ pause: 'short', repeats: 1 })
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    fireEvent.click(play)
    await waitFor(() => expect(said[0]).toMatch(/^Introducing new words\. You'll hear the English/))
    await waitFor(() => expect(said.some(text => text.startsWith('This is how you say, '))).toBe(true), { timeout: 4000 })
    expect(document.querySelector('.hf-prompt')).not.toHaveClass('hf-section')
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
    await waitFor(async () => expect((await db.handsfreeRuns.get('run1'))!.settings).toMatchObject({ itemWording: 'abridged', sectionIntros: 'header' }))
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
    const before = (await buildRunScript((await db.handsfreeRuns.get('run1'))!)).script
    render(<App />)
    await screen.findByRole('button', { name: 'Resume' })
    await waitFor(() => expect(phase()).toBe('Introducing 2 of 3'))
    const dialog = await openSettings()
    fireEvent.change(within(dialog).getByLabelText('Repeats'), { target: { value: '3' } })
    await waitFor(async () => expect((await db.handsfreeRuns.get('run1'))!.settings).toMatchObject({ repeats: 3 }))
    // the script was rebuilt with more repeats, and the current prompt kept its place in it (same phase, item and direction)
    const after = (await buildRunScript((await db.handsfreeRuns.get('run1'))!)).script
    expect(after.segments.length).toBeGreaterThan(before.segments.length)
    expect(findPrompt(after, promptKeyAt(before, 1), 1)).toBeGreaterThanOrEqual(1)
    await waitFor(() => expect(phase()).toBe('Introducing 2 of 3'))
    // playing on uses the new script, and a later resume lands on the same prompt
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(said.length).toBeGreaterThan(0))
    const saved = (await db.handsfreeRuns.get('run1'))!
    expect(saved.settings.repeats).toBe(3)
    expect(promptKeyAt(after, saved.position)).toBe(promptKeyAt(after, findPrompt(after, promptKeyAt(before, 1), 1)))
  })
})
