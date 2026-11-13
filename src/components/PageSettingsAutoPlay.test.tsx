import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { whenContent } from '../core/drills/content'
import { createDrillSet } from '../core/drills/store'
import { setBuildLanguageForTests } from '../core/storage-names'
import * as speech from '../core/assistant/speech'
import { ExerciseQuestion, type QuestionContext } from '../pages/drills/EngineQuestion'
import type { SessionExercise } from '../core/session/types'

vi.mock('../core/ai/structured', () => ({ requestStructuredJSON: vi.fn() }))

beforeEach(async () => {
  localStorage.clear()
  window.location.hash = '#practice'
  await db.delete(); await db.open()
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false })
  vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); setBuildLanguageForTests(undefined) })

const gear = () => screen.findByRole('button', { name: 'Workspace settings' })
const sheetOf = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(await gear()); return screen.findByRole('dialog', { name: 'Page settings' }) }

describe('Auto-play sound in the quick settings', () => {
  it('shows on the Practice page and changes promptAutoPlay', async () => {
    const user = userEvent.setup()
    render(<App />)
    const sheet = await sheetOf(user)
    const toggle = within(sheet).getByRole('switch', { name: 'Auto-play sound' })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.promptAutoPlay).toBe(true))
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Page settings' })).getByRole('switch', { name: 'Auto-play sound' })).toBeChecked())
    await user.click(within(screen.getByRole('dialog', { name: 'Page settings' })).getByRole('switch', { name: 'Auto-play sound' }))
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.promptAutoPlay).toBe(false))
  })

  it('shows during a running session', async () => {
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    window.location.hash = `#practice/set/${id}`
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start session' })).toBeEnabled(), { timeout: 20000 })
    await user.click(screen.getByRole('button', { name: 'Start session' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull())
    const sheet = await sheetOf(user)
    await user.click(within(sheet).getByRole('switch', { name: 'Auto-play sound' }))
    await waitFor(async () => expect((await db.preferences.get('workspace'))?.promptAutoPlay).toBe(true))
  }, 40000)

  it.each(['#lessons', '#games/sudoku', '#practice/tones', '#overview'])('does not show on %s', async hash => {
    window.location.hash = hash
    const user = userEvent.setup()
    render(<App />)
    const sheet = await sheetOf(user)
    expect(within(sheet).getByText('Quick settings')).toBeInTheDocument()
    expect(within(sheet).queryByRole('switch', { name: 'Auto-play sound' })).toBeNull()
  })
})

describe('the small play button beside a sentence', () => {
  const make = (shape: object) => ({ id: 'x', refs: ['a'], stage: 'use', round: 0, ...shape }) as unknown as Exclude<SessionExercise, { form: 'intro' | 'repeat' }>
  const ctx: QuestionContext = { readings: new Map(), pinyin: false, speak: false, busy: false, forms: new Set(), characters: new Set(), mode: 'type', writing: false, chinese: ref => ref }
  const none = () => undefined

  it('is there before answering a Chinese-sentence question, and speaks the sentence', async () => {
    const user = userEvent.setup()
    render(<ExerciseQuestion exercise={make({ form: 'translate-zh-en', prompt: '我喜欢喝茶。', promptLang: 'zh', answerLang: 'en', accepted: ['I like tea.'], model: 'I like tea.', hearText: '我喜欢喝茶。', explanation: '' })} ctx={ctx} onDone={none} />)
    await user.click(screen.getByRole('button', { name: 'Play the sentence' }))
    await waitFor(() => expect(speech.playBrowserSpeech).toHaveBeenCalledWith(expect.any(String), '我喜欢喝茶。', 'zh-Hans'))
  })

  it('waits until the answer is checked in a gap question', async () => {
    const user = userEvent.setup()
    render(<ExerciseQuestion exercise={make({ form: 'gap', sentence: '下午上课前喝茶。', gapped: '下午上课____喝茶。', options: ['好', '前'], answer: 1, translation: 'Tea before class.', explanation: '' })} ctx={ctx} onDone={none} />)
    expect(screen.queryByRole('button', { name: 'Play the sentence' })).toBeNull()
    await user.click(screen.getByRole('radio', { name: '前' }))
    await user.click(screen.getByRole('button', { name: /Check answer/ }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Play the sentence' })).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Play the sentence' }))
    await waitFor(() => expect(speech.playBrowserSpeech).toHaveBeenCalledWith(expect.any(String), '下午上课前喝茶。', 'zh-Hans'))
  })

  const choice = make({ form: 'choice', direction: 'zh-to-en', question: '同学', options: ['classmate', 'teacher', 'tea', 'school'], answer: 0, explanation: '' })
  const typed = make({ form: 'pinyin', prompt: '同学', promptLang: 'zh', answerLang: 'py', accepted: ['tongxue'], model: 'tóngxué', modelPinyin: 'tóngxué', hearText: '同学', explanation: '' })
  const check = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(screen.getByRole('radio', { name: 'classmate' })); await user.click(screen.getByRole('button', { name: /Check answer/ })) }

  it('Choose the meaning has the word button before answering, and it speaks the word', async () => {
    const user = userEvent.setup()
    render(<ExerciseQuestion exercise={choice} ctx={ctx} onDone={none} />)
    await user.click(screen.getByRole('button', { name: 'Play the word' }))
    await waitFor(() => expect(speech.playBrowserSpeech).toHaveBeenCalledWith(expect.any(String), '童学', 'zh-Hans'))
  })

  it('Choose the meaning with auto-play on plays the word after checking and not before', async () => {
    const user = userEvent.setup()
    render(<ExerciseQuestion exercise={choice} ctx={{ ...ctx, autoPlay: true }} onDone={none} />)
    await user.click(screen.getByRole('radio', { name: 'classmate' }))
    expect(speech.playBrowserSpeech).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Check answer/ }))
    await waitFor(() => expect(speech.playBrowserSpeech).toHaveBeenCalledTimes(1))
    expect(speech.playBrowserSpeech).toHaveBeenCalledWith(expect.any(String), '童学', 'zh-Hans')
  })

  it('Choose the meaning with auto-play off stays quiet after checking', async () => {
    const user = userEvent.setup()
    render(<ExerciseQuestion exercise={choice} ctx={{ ...ctx, autoPlay: false }} onDone={none} />)
    await check(user)
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(speech.playBrowserSpeech).not.toHaveBeenCalled()
  })

  it('a typed-reading question has no sound before checking, and has it after', async () => {
    const user = userEvent.setup()
    render(<ExerciseQuestion exercise={typed} ctx={ctx} onDone={none} />)
    expect(screen.queryByRole('button', { name: /Play the word|Hear it/ })).toBeNull()
    await user.type(screen.getByRole('textbox'), 'tongxue')
    await user.click(screen.getByRole('button', { name: /Check answer/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Play the word|Hear it/ })).toBeInTheDocument())
  })
})
