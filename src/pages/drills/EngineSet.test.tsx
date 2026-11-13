import { omit } from '../../core/omit'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { db } from '../../core/database'
import { whenContent } from '../../core/drills/content'
import { createDrillSet, finishEngineRun, getDrillSet, recordDrillResult, recordEngineResult, saveEngineAnswer } from '../../core/drills/store'
import { replayRunner, progressOf } from '../../core/session/runner'
import { engineStanding } from './Drills'
import { setBuildLanguageForTests } from '../../core/storage-names'
import { resetCatalogCache } from '../../core/study/catalog'
import { DRILL_TYPES } from '../../core/drills/contracts'
import * as speech from '../../core/assistant/speech'
import { ExerciseQuestion, type QuestionContext } from './EngineQuestion'
import type { SessionExercise } from '../../core/session/types'

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
    expect(screen.getByRole('heading', { name: 'Writing' })).toBeInTheDocument()
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

describe('Auto-play sound', () => {
  const gap = { id: 'g', refs: ['a'], stage: 'use', round: 0, form: 'gap', sentence: '下午上课前喝茶。', gapped: '下午上课____喝茶。', options: ['好', '前', '和', '天'], answer: 1, translation: 'Drink tea before class in the afternoon.', explanation: '' } as unknown as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>
  const reveal = async (user: ReturnType<typeof userEvent.setup>) => {
    const autoPlay = (await db.preferences.get('workspace'))?.promptAutoPlay === true
    const ctx: QuestionContext = { readings: new Map(), pinyin: false, speak: false, autoPlay, busy: false, forms: new Set(), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
    render(<ExerciseQuestion exercise={gap} ctx={ctx} onDone={() => undefined} />)
    await user.click(screen.getByRole('radio', { name: '前' }))
    await user.click(screen.getByRole('button', { name: /Check answer/ }))
  }
  it('is off by default on the Ready page; switching it on is saved, and the sentence then plays on reveal; off again, it does not', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    window.location.hash = `#practice/set/${id}`
    const user = userEvent.setup()
    render(<App />)
    const toggle = await screen.findByRole('switch', { name: 'Auto-play sound' })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.promptAutoPlay).toBe(true))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Auto-play sound' })).toBeChecked())
    cleanup()
    await reveal(user)
    expect(speech.playBrowserSpeech).toHaveBeenCalledTimes(1)
    expect(speech.playBrowserSpeech).toHaveBeenCalledWith(expect.any(String), '下午上课前喝茶。', 'zh-Hans')
    cleanup(); vi.mocked(speech.playBrowserSpeech).mockClear()
    window.location.hash = `#practice/set/${id}`
    render(<App />)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Auto-play sound' })).toBeChecked())
    await user.click(screen.getByRole('switch', { name: 'Auto-play sound' }))
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.promptAutoPlay).toBe(false))
    cleanup()
    await reveal(user)
    expect(speech.playBrowserSpeech).not.toHaveBeenCalled()
  }, 40000)
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

  it('a hinted result is recorded as right, scheduled as Needed a hint', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    const ref = (await getDrillSet(id))!.refs[0]
    expect((await recordEngineResult(id, ref, ['reading'], 'pinyin', true, true)).graded).toBe(true)
    expect((await getDrillSet(id))!.engine).toMatchObject({ total: 1, correct: 1 })
  })

  it('does not record into a set that has no engine state', async () => {
    const id = await createDrillSet({ kind: 'new' })
    const classic = omit((await getDrillSet(id))!, 'engine')
    await db.drillSets.put(classic)
    expect((await recordEngineResult(id, classic.refs[0], ['reading'], 'choice', true)).graded).toBe(false)
    void recordDrillResult
  })
})

describe('after a run', () => {
  it('a finished engine set reopens on its Start screen with the last run, never the old drill-type view', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await finishEngineRun(id, { correct: 6, total: 20 }, new Date(2026, 10, 7).getTime())
    expect((await getDrillSet(id))!).toMatchObject({ status: 'completed', engine: { lastRun: { correct: 6, total: 20 }, answers: [] } })
    window.location.hash = `#practice/set/${id}`
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Ready when you are' })).toBeInTheDocument()
    expect(screen.getByText('Last run: 6 of 20 right, 7 Nov')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Pick a practice type' })).toBeNull()
  }, 40000)

  it('names where a set stands and offers Resume only for a run in progress', async () => {
    const id = await createDrillSet({ kind: 'new' })
    expect(engineStanding((await getDrillSet(id))!)).toBe('Practice session · not started')
    await saveEngineAnswer(id, true, 1, 26)
    await saveEngineAnswer(id, false, 14, 26)
    expect(engineStanding((await getDrillSet(id))!)).toBe('Practice session · in progress, 14 of 26')
    await finishEngineRun(id, { correct: 6, total: 20 })
    expect(engineStanding((await getDrillSet(id))!)).toBe('Practice session · finished, 6/20')
    expect(engineStanding(omit((await getDrillSet(id))!, 'engine'))).toBeUndefined()
  })

  it('a started set opens with Resume and the saved progress; Start over clears it', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await saveEngineAnswer(id, true, 3, 26)
    window.location.hash = `#practice/set/${id}`
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText(/In progress: 3 of 26/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume session' })).toBeEnabled(), { timeout: 20000 })
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await waitFor(async () => expect((await getDrillSet(id))!.engine).toMatchObject({ answers: [], done: 0 }))
  }, 40000)

  it('the Recent sessions row says what the set is and Resume leads', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await saveEngineAnswer(id, true, 14, 26)
    render(<App />)
    expect(await screen.findByText(/Practice session · in progress, 14 of 26/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Resume / })).toBeInTheDocument()
  })
})

describe('replay', () => {
  it('replays saved answers over the same plan', () => {
    const exercise = (id: string, round = 0) => ({ id, stage: 'recognise', form: 'choice', refs: ['r'], round }) as never
    const plan = { stages: [{ stage: 'recognise', exercises: [exercise('a'), exercise('b'), exercise('c')] }], uncovered: [] } as never
    const state = replayRunner(plan, [true, false])
    expect(progressOf(state)).toEqual({ done: 2, total: 3 })
    expect(state.missed.map(entry => entry.id)).toEqual(['b'])
    expect(replayRunner(plan, [true, true, true, true, true]).done).toBe(true)
  })
})


describe('the set page after the tidy-up', () => {
  const open = async (id: string) => { window.location.hash = `#practice/set/${id}`; render(<App />); await screen.findByRole('heading', { name: 'Ready when you are' }) }

  it('shows the two Hands-free rows, which open the right Hands-free route', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    const user = userEvent.setup()
    await open(id)
    expect(screen.getByRole('heading', { name: 'Hands-free' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start Hands-free introduction' }))
    await waitFor(() => expect(window.location.hash).toBe(`#practice/set/${id}/handsfree`))
    expect((await getDrillSet(id))!.handsfree).toBeTruthy()
    cleanup()
    window.location.hash = '#practice'
    await open(id)
    expect(screen.getByRole('button', { name: /^Continue Hands-free introduction|^Start Hands-free introduction/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start Hands-free recall' }))
    await waitFor(() => expect(window.location.hash).toBe(`#practice/set/${id}/recall`))
  }, 40000)

  it('does not show Hands-free for a phrase set', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await db.drillSets.put({ ...(await getDrillSet(id))!, source: 'phrases' })
    await open(id)
    expect(screen.queryByRole('heading', { name: 'Hands-free' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Hands-free/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Writing' })).toBeNull()
  }, 40000)

  it('does not show Hands-free in a build without it', async () => {
    setBuildLanguageForTests('ja'); resetCatalogCache()
    try {
      const id = await createDrillSet({ kind: 'new' })
      await whenContent(id)
      await open(id)
      expect(screen.queryByRole('heading', { name: 'Hands-free' })).toBeNull()
    } finally { setBuildLanguageForTests(undefined); resetCatalogCache() }
  }, 40000)

  it('a completed set offers Back to session, which opens the session', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await finishEngineRun(id, { correct: 6, total: 20 })
    const user = userEvent.setup()
    await open(id)
    const button = await screen.findByRole('button', { name: 'Start session' })
    expect(button).toHaveTextContent('Back to session')
    expect(document.body.textContent).not.toMatch(/practise/i)
    await waitFor(() => expect(button).toBeEnabled(), { timeout: 20000 })
    await user.click(button)
    expect(window.location.hash).toBe(`#practice/set/${id}/engine`)
  }, 40000)

  it('the skill section lists only Learn to write and Write it', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    await open(id)
    const section = screen.getByRole('heading', { name: 'Writing' }).closest('section') as HTMLElement
    expect(within(section).getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent)).toEqual(['Learn to write', 'Write it'])
    for (const gone of ['Word meanings', 'Match pairs', 'Say the pinyin', 'Translate sentences', 'Repeat after me', 'Listen and answer', 'Read and answer']) expect(screen.queryByText(gone)).toBeNull()
  }, 40000)

  it('an old route to a removed drill type still opens', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    expect(DRILL_TYPES.some(entry => entry.id === 'meanings')).toBe(true)
    window.location.hash = `#practice/set/${id}/run/meanings`
    render(<App />)
    expect(await screen.findByRole('group', { name: 'Style' })).toBeInTheDocument()
  }, 40000)
})
