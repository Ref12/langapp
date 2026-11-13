import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { whenContent } from '../../core/drills/content'
import { createDrillSet, getDrillSet } from '../../core/drills/store'
import { availability, applicable, buildQuestions, DEFAULT_OPTIONS } from './tasks'
import { loadCatalog } from '../../core/study/catalog'
import { loadItems } from '../../core/drills/items'
import { loadWriteSentences } from '../../core/drills/write-sentences'
import { drillTypeOffered } from '../../core/drills/offered'
import { DRILL_TYPES } from '../../core/drills/contracts'
import { metaFor } from '../../core/language/meta'
import { storageNames } from '../../core/storage-names'
import * as speech from '../../core/assistant/speech'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../../core/ai/structured', () => structured)
// A pad that reports a chosen result at once, so the tests decide what the stroke check said.
const pad = vi.hoisted(() => ({ result: { misses: 0, hinted: true } as { misses: number; hinted: boolean } }))
vi.mock('./StrokePad', () => ({ StrokePad: ({ onDone }: { onDone: (result: { misses: number; hinted: boolean }) => void }) => <button type="button" onClick={() => onDone(pad.result)}>Finish the strokes</button> }))

beforeEach(async () => {
  localStorage.clear()
  window.location.hash = '#practice'
  await db.delete()
  await db.open()
  structured.requestStructuredJSON.mockReset()
  pad.result = { misses: 0, hinted: true }
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false })
  vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function newSet() {
  const id = await createDrillSet({ kind: 'new' })
  await whenContent(id)
  return (await getDrillSet(id))!
}

describe('Write it without AI', () => {
  it('is offered with no AI connection, and every item has a shipped sentence or the word alone, with no model request', async () => {
    expect(await db.aiConnections.count()).toBe(0)
    expect(DRILL_TYPES.find(entry => entry.id === 'write')!.needs).toBe('none')
    const set = await newSet()
    structured.requestStructuredJSON.mockClear()
    const catalog = await loadCatalog()
    const items = await loadItems(set.refs, catalog)
    expect(availability('write', items, { state: 'no-ai', sentences: {}, conversations: [] }).state).toBe('ready')
    const sentences = await loadWriteSentences(catalog, items, set.refs)
    const queue = buildQuestions('write', { setId: set.id, items, catalog, known: new Set(), content: { state: 'no-ai', sentences, conversations: [] }, options: DEFAULT_OPTIONS })
    expect(queue.length).toBe(applicable('write', items, { sentences, conversations: [] }).length)
    expect(queue.length).toBeGreaterThan(0)
    for (const q of queue) {
      if (q.data.t !== 'write') throw new Error('not a write question')
      expect(q.data.sentence === undefined || q.data.sentence.zh.includes(q.data.item.zh)).toBe(true)
    }
    expect(structured.requestStructuredJSON).not.toHaveBeenCalled()
  }, 40000)

  it('is offered by every build that has writing on', () => {
    const entry = DRILL_TYPES.find(item => item.id === 'write')!
    for (const id of ['zh', 'ja', 'ko'] as const) expect(drillTypeOffered(entry, { ...metaFor(id), modelExercises: false })).toBe(metaFor(id).features.writing)
    expect(['zh', 'ja', 'ko'].filter(id => metaFor(id as 'zh').features.writing)).toEqual(['zh', 'ja', 'ko'])
  })

  it('starts on the handwriting pad and shows a sentence or the word alone', async () => {
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}/run/write`
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Handwriting pad', pressed: true }, { timeout: 8000 })).toBeInTheDocument()
    expect(document.querySelector('.dr-pinyin-prompt')).not.toBeNull()
    expect(document.querySelector('.dr-write-line')!.textContent).toMatch(/^Write /)
    expect(structured.requestStructuredJSON).not.toHaveBeenCalled()
  }, 40000)

  it('keeps a remembered Write elsewhere choice over the default', async () => {
    localStorage.setItem(storageNames().local.writeDrill, JSON.stringify({ mode: 'paper' }))
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}/run/write`
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Write elsewhere', pressed: true }, { timeout: 8000 })).toBeInTheDocument()
  }, 40000)
})

describe('Mark correct', () => {
  async function toHint(user: ReturnType<typeof userEvent.setup>) {
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}/run/write`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Finish the strokes' }, { timeout: 8000 }))
    expect(await screen.findByRole('status')).toHaveTextContent('Needed a hint')
    return set
  }
  it('after Needed a hint records Got it once, and Next stays where it was', async () => {
    const user = userEvent.setup()
    const set = await toHint(user)
    const row = document.querySelector('.answer-actions')!
    const next = within(row as HTMLElement).getByRole('button', { name: /^(Next|Finish)$/ })
    const above = () => { const out: string[] = []; for (let node = row.previousElementSibling; node; node = node.previousElementSibling) out.push(node.tagName + '.' + node.className); return out }
    const before = above()
    // held until the learner decides: nothing is recorded yet
    expect((await getDrillSet(set.id))!.progress.write).toBeUndefined()
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Mark correct' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Got it')
    expect(document.querySelector('.answer-actions')).toBe(row)
    expect(within(row as HTMLElement).getByRole('button', { name: /^(Next|Finish)$/ })).toBe(next)
    expect(above()).toEqual(before)
    expect(screen.queryByRole('button', { name: 'Mark correct' })).toBeNull()
    await user.click(next)
    await waitFor(async () => expect(Object.values((await getDrillSet(set.id))!.progress.write!.results)).toEqual(['got']))
    expect(await db.journal.count()).toBeLessThanOrEqual(1)
  }, 40000)

  it('without it, Next records the hint', async () => {
    const user = userEvent.setup()
    const set = await toHint(user)
    expect(screen.getByRole('button', { name: 'Mark correct' }).closest('.answer-actions')).toBe(document.querySelector('.answer-actions'))
    await user.click(screen.getByRole('button', { name: /^(Next|Finish)$/ }))
    await waitFor(async () => expect(Object.values((await getDrillSet(set.id))!.progress.write!.results)).toEqual(['hint']))
  }, 40000)

  it('is offered after a Missed result and not after Got it', async () => {
    const user = userEvent.setup()
    pad.result = { misses: 0, hinted: false }
    const set = await newSet()
    window.location.hash = `#practice/set/${set.id}/run/write`
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Finish the strokes' }, { timeout: 8000 }))
    expect(await screen.findByRole('status')).toHaveTextContent('Got it')
    expect(screen.queryByRole('button', { name: 'Mark correct' })).toBeNull()
  }, 40000)
})
