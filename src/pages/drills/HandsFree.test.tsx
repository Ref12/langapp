import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

async function openRun(settings = { pause: 'short', repeats: 1, grammar: true }) {
  const now = Date.now()
  await db.handsfreeRuns.put({ id: 'run1', title: 'Hands-free · 1 Nov', refs, source: 'review', seed: 5, settings, status: 'active', started: false, position: 0, createdAt: now, updatedAt: now } as never)
  window.location.hash = '#practice/handsfree/run1'
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const phase = () => screen.getByRole('status').textContent

describe('Hands-free player', () => {
  it('plays, advances through the prompts, and skips and goes back by prompt', async () => {
    await openRun()
    render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    expect(phase()).toBe('Introducing 1 of 3')
    fireEvent.click(play)
    await waitFor(() => expect(said[0]).toMatch(/^This is how you say /))
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(document.querySelector('.hf-prompt')).toHaveTextContent('我')
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

  it('exits pocket mode only on a long press, and keeps the screen awake meanwhile', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const request = vi.fn().mockResolvedValue({ release, addEventListener: vi.fn() })
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    await openRun()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Pocket mode/ }))
    const overlay = await screen.findByRole('dialog', { name: /Pocket mode/ })
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
    fireEvent.click(overlay)
    fireEvent.pointerDown(overlay); await advance(300); fireEvent.pointerUp(overlay)
    await advance(1500)
    expect(screen.getByRole('dialog', { name: /Pocket mode/ })).toBeInTheDocument()
    fireEvent.pointerDown(overlay); await advance(1100)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Pocket mode/ })).toBeNull())
    await waitFor(() => expect(release).toHaveBeenCalled())
    delete (navigator as unknown as Record<string, unknown>).wakeLock
  })

  it('resumes where it left off after leaving and coming back, and remembers the settings', async () => {
    await openRun()
    const first = render(<App />)
    const play = await screen.findByRole('button', { name: 'Play' })
    await waitFor(() => expect(play).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Pause length'), { target: { value: 'long' } })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('handsfree.settings')!)).toMatchObject({ pause: 'long' }))
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
    await waitFor(() => expect(said.at(-1)).toMatch(/^(And )?[Hh]ow do you say |^This is how you say /))
    expect(screen.getByLabelText('Pause length')).toHaveValue('long')
    expect(screen.getByLabelText('Repeats')).toBeDisabled()
    expect((await db.handsfreeRuns.get('run1'))!.status).toBe('active')
  })

  it('starts from Practice home with Learning from, and creates a run that is not yet in History', async () => {
    await db.knowledge.add({ ref: refs[0], addedAt: 1, source: 'new' } as never).catch(() => undefined)
    window.location.hash = '#practice'
    render(<App />)
    const start = await screen.findByRole('button', { name: 'Hands-free new items' })
    expect(screen.getByRole('heading', { name: 'Programs' })).toBeInTheDocument()
    await waitFor(() => expect(start).toBeEnabled())
    fireEvent.click(start)
    await waitFor(() => expect(window.location.hash).toMatch(/^#practice\/handsfree\//))
    const [run] = await db.handsfreeRuns.toArray()
    expect(run).toMatchObject({ source: 'new', started: false, status: 'active', settings: { pause: 'normal', repeats: 1, grammar: true } })
    expect(await createHandsfreeRun({ kind: 'new' })).toBeTruthy()
  })
})
