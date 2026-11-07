import { omit } from '../../core/omit'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { whenContent } from '../../core/drills/content'
import { createDrillSet, getDrillSet, recordDrillResult, recordEngineResult } from '../../core/drills/store'
import * as speech from '../../core/assistant/speech'

vi.mock('../../core/ai/structured', () => ({ requestStructuredJSON: vi.fn() }))

beforeEach(async () => {
  localStorage.clear()
  window.location.hash = '#practice'
  await db.delete(); await db.open()
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false })
  vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('practice-set entry', () => {
  it('a new set opens on the engine Start screen with the Default preset and Standard length', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    expect((await getDrillSet(id))!.engine).toMatchObject({ preset: 'default', length: 'standard' })
    window.location.hash = `#practice/set/${id}`
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Ready when you are' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Default' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('heading', { name: 'Pick a practice type' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Practise one skill' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled(), { timeout: 20000 })
    expect(screen.getByRole('status', { name: '' })).toBeTruthy()
  }, 40000)

  it('a set without engine state keeps the classic view', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    const classic = omit((await getDrillSet(id))!, 'engine')
    await db.drillSets.put(classic)
    window.location.hash = `#practice/set/${id}`
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Pick a practice type' })).toBeInTheDocument()
  })

  it('choosing a preset and a length changes the set and starts it fresh', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    window.location.hash = `#practice/set/${id}`
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Listening' }))
    await user.click(screen.getByRole('button', { name: 'Long' }))
    await waitFor(async () => expect((await getDrillSet(id))!.engine).toMatchObject({ preset: 'listening', length: 'long' }))
  })
})

describe('recording', () => {
  it('records a first attempt once per item and skill, in the schedule and the skill counts; a repeat adds nothing', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    const set = (await getDrillSet(id))!
    const ref = set.refs[0]
    await db.studyCards.put({ id: `${ref}::zh-Hans`, ref, domain: 'zh-Hans', state: 'new', due: 0, stability: 0, difficulty: 0, reps: 0, lapses: 0, createdAt: 1, updatedAt: 1 } as never).catch(() => undefined)
    expect((await recordEngineResult(id, ref, ['reading'], 'choice', true)).graded).toBe(true)
    expect((await recordEngineResult(id, ref, ['reading'], 'recall', false)).graded).toBe(false)
    expect((await recordEngineResult(id, ref, ['writing'], 'tiles', true)).graded).toBe(true)
    const after = (await getDrillSet(id))!
    expect(after.engine).toMatchObject({ total: 2, correct: 2, recorded: [`${ref}|reading`, `${ref}|writing`] })
    const rows = await db.skillPractice.toArray()
    expect(rows.filter(row => row.ref === ref).map(row => row.skill).sort()).toEqual(['reading', 'writing'])
    expect(rows.every(row => row.count === 1)).toBe(true)
  })

  it('does not record into a set that has no engine state', async () => {
    const id = await createDrillSet({ kind: 'new' })
    const classic = omit((await getDrillSet(id))!, 'engine')
    await db.drillSets.put(classic)
    expect((await recordEngineResult(id, classic.refs[0], ['reading'], 'choice', true)).graded).toBe(false)
    void recordDrillResult
  })
})
