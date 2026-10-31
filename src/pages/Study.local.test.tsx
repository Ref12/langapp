import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { loadCatalog } from '../core/study/catalog'
import * as speech from '../core/assistant/speech'
import { nextGroup } from '../core/study/knowledge'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../core/ai/structured', () => structured)

const connection = {
  id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const,
}

beforeEach(async () => {
  window.location.hash = '#lessons'
  await db.delete()
  await db.open()
  structured.requestStructuredJSON.mockReset()
  vi.spyOn(speech, 'playBrowserSpeech').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function begin(user: ReturnType<typeof userEvent.setup>) {
  await db.aiConnections.add(connection)
  await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false, exercisesPerLesson: 8 })
  const refs = nextGroup(await loadCatalog(), new Set())!.units.map(unit => unit.ref)
  render(<App />)
  const start = await screen.findByRole('button', { name: 'Start new items' })
  await waitFor(() => expect(start).toBeEnabled())
  await user.click(start)
  await screen.findByRole('heading', { name: 'Meet your new items.' })
  return refs
}

describe('lessons that start on programmatic exercises', () => {
  it('plays local exercises while the AI is pending, adds its batch when it arrives, and plays a match with a miss', async () => {
    const user = userEvent.setup()
    let release: (value: unknown) => void = () => undefined
    structured.requestStructuredJSON.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const refs = await begin(user)
    const footer = screen.getByRole('region', { name: 'Start the exercises' })
    expect(await within(footer).findByText(/exercises ready, more coming/)).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: 'Start' })).toBeEnabled()
    await user.click(within(footer).getByRole('button', { name: 'Start' }))
    // A programmatic choice, with the counter saying more is coming.
    expect(await screen.findByText(/0 done · more coming/)).toBeInTheDocument()
    const options = screen.getAllByRole('radio')
    expect(options.length).toBeGreaterThanOrEqual(2)
    await waitFor(() => expect(structured.requestStructuredJSON).toHaveBeenCalled())
    const session = (await db.exerciseSessions.toArray())[0]
    const first = session.exercises[0]
    if (first.type !== 'choice') throw new Error('expected a choice first')
    await user.click(options[first.answer])
    await user.click(await screen.findByRole('button', { name: 'Check answer' }, { timeout: 8000 }))
    expect(await screen.findByText('Correct.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    // Play on to the first match.
    const matchPosition = session.exercises.findIndex(exercise => exercise.type === 'match')
    for (let position = 1; position < matchPosition; position++) {
      const exercise = session.exercises[position]
      if (exercise.type !== 'choice') throw new Error('expected a choice')
      // A fresh exercise has a disabled Check button; the one just answered shows Next.
      expect(await screen.findByRole('button', { name: 'Check answer' }, { timeout: 8000 })).toBeDisabled()
      await user.click(screen.getAllByRole('radio')[exercise.answer])
      await user.click(screen.getByRole('button', { name: 'Check answer' }))
      await user.click(await screen.findByRole('button', { name: 'Next' }))
    }
    const match = session.exercises[matchPosition]
    if (match.type !== 'match') throw new Error('expected a match')
    expect(await screen.findByRole('heading', { name: 'Match the pairs: tap one, then its partner.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pinyin/ })).toBeInTheDocument()
    const board = await screen.findByRole('group', { name: 'Pairs to match' })
    const first1 = within(board).getByRole('group', { name: 'First column' }), second = within(board).getByRole('group', { name: 'Second column' })
    const leftButtons = within(first1).getAllByRole('button'), rightButtons = within(second).getAllByRole('button')
    const rightFor = (index: number) => rightButtons.find(button => button.textContent === match.pairs[index].right)!
    // One right pair locks.
    await user.click(leftButtons[0]); await user.click(rightFor(0))
    expect(leftButtons[0]).toBeDisabled()
    expect(rightFor(0)).toBeDisabled()
    // A wrong pairing is flagged and counted; the pair stays open.
    await user.click(leftButtons[1]); await user.click(rightFor(2))
    expect(await screen.findByText('Not a pair. Try again.')).toBeInTheDocument()
    expect(leftButtons[1]).toBeEnabled()
    // No Check button on a match: the last pair locking finishes it.
    expect(screen.queryByRole('button', { name: 'Check answer' })).not.toBeInTheDocument()
    for (const index of [1, 2, 3]) { await user.click(leftButtons[index]); await user.click(rightFor(index)) }
    expect(await screen.findByText('Not quite.')).toBeInTheDocument()
    expect((await db.exerciseSessions.get(session.id))!.redos).toEqual([{ exercise: matchPosition, round: 1 }])
    expect((await db.exerciseAttempts.get(`${session.id}:${matchPosition}`))!.response).toBe(JSON.stringify([match.pairs[1].ref]))
    // The AI's batch joins the saved lesson when it resolves.
    const before = (await db.exerciseSessions.get(session.id))!.exercises.length
    await act(async () => { release({ exercises: [1, 2, 3, 4].map(number => ({ id: `ai${number}`, type: 'choice', targets: [refs[0]], direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'x' })) }) })
    await waitFor(async () => expect((await db.exerciseSessions.get(session.id))!.exercises).toHaveLength(before + 4))
    await waitFor(async () => expect((await db.exerciseSessions.get(session.id))!.generation).toBeUndefined())
  }, 30000)

  it('fills the shortfall with more programmatic exercises and shows the AI failure once, quietly', async () => {
    const user = userEvent.setup()
    structured.requestStructuredJSON.mockRejectedValue(new Error('Model unavailable'))
    await begin(user)
    await waitFor(async () => expect((await db.exerciseSessions.toArray())[0].generation).toBeUndefined())
    const session = (await db.exerciseSessions.toArray())[0]
    expect(session.aiNotice).toBe('Model unavailable')
    expect(session.exercises.length).toBe(8)
    const footer = screen.getByRole('region', { name: 'Start the exercises' })
    await user.click(await within(footer).findByRole('button', { name: 'Start' }))
    expect(await screen.findByText('Model unavailable', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/Exercise 1 of \d+/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Model unavailable', { exact: false })).not.toBeInTheDocument()
    await waitFor(async () => expect((await db.exerciseSessions.get(session.id))!.aiNotice).toBeUndefined())
  }, 30000)
})
