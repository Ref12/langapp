import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { loadCatalog } from '../core/study/catalog'
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
})
afterEach(cleanup)

describe('New and Review', () => {
  it('asks for an AI connection before any session can start', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Learn something new, or keep what you know.' })
    await screen.findByRole('heading', { name: /new items$/ })
    expect(await screen.findByRole('link', { name: 'Connect a model in Settings' })).toHaveAttribute('href', '#settings')
    expect(screen.getByRole('button', { name: 'Start new items' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Review due items' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: '0 items due' })).toBeInTheDocument()
    expect(await db.knowledge.count()).toBe(0)
  })

  it('introduces the next group, plays generated exercises and records the results', async () => {
    const user = userEvent.setup()
    await db.aiConnections.add(connection)
    const group = nextGroup(await loadCatalog(), new Set())!
    const refs = group.units.map(unit => unit.ref)
    structured.requestStructuredJSON.mockResolvedValueOnce({ exercises: [
      { id: 'c1', type: 'choice', targets: [refs[0]], direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'Identity with 是.' },
      { id: 't1', type: 'tiles', targets: refs, translation: 'I am a student.', tiles: ['我', '是', '学生'], distractors: ['学习'], explanation: 'Subject, 是, noun.' },
      { id: 'c2', type: 'choice', targets: [refs[1]], direction: 'en-to-zh', question: 'I study.', options: ['我学习。', '我是学生。'], answer: 0, explanation: '学习 means study.' },
      { id: 'c3', type: 'choice', targets: [refs[2]], direction: 'zh-to-en', question: '学生', options: ['student', 'teacher'], answer: 0, explanation: 'x' },
      { id: 'bad', type: 'choice', targets: [refs[2]], direction: 'zh-to-en', question: '老师', options: ['teacher', 'student'], answer: 0, explanation: 'Unknown word.' },
    ] })
    render(<App />)
    await screen.findByRole('heading', { name: 'Learn something new, or keep what you know.' })
    const newCard = await screen.findByRole('region', { name: 'New items' })
    await within(newCard).findByRole('heading', { name: `${refs.length} new items` })
    expect(within(newCard).getByText('我')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start new items' }))
    await screen.findByRole('heading', { name: 'Meet your new items.' })
    expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(1)
    expect(await db.knowledge.count()).toBe(refs.length)
    expect(screen.getAllByRole('button', { name: 'In your knowledge set' })).toHaveLength(refs.length)
    expect(screen.getAllByText('I am a student.').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Start exercises' }))
    await screen.findByRole('heading', { name: 'What does this mean?' })
    expect(screen.getByText('Exercise 1 of 4')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'I study.' }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByText('Not quite.')
    expect(screen.getByText('Identity with 是.')).toBeInTheDocument()
    cleanup()
    render(<App />)
    await screen.findByText('Not quite.')
    await user.click(screen.getByRole('button', { name: 'Next exercise' }))
    await screen.findByRole('heading', { name: 'Arrange the tiles to translate this.' })
    const bank = screen.getByRole('group', { name: 'Available tiles' })
    for (const tile of ['我', '是', '学生']) await user.click(within(bank).getByRole('button', { name: tile }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByText('Correct.')
    await user.click(screen.getByRole('button', { name: 'Next exercise' }))
    await screen.findByRole('heading', { name: 'Which Mandarin matches?' })
    await user.click(screen.getByRole('radio', { name: '我学习。' }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByText('Correct.')
    await user.click(screen.getByRole('button', { name: 'Next exercise' }))
    await screen.findByRole('heading', { name: 'What does this mean?' })
    await user.click(screen.getByRole('radio', { name: 'student' }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByText('Correct.')
    await user.click(screen.getByRole('button', { name: 'Finish session' }))
    await screen.findByRole('heading', { name: 'One more step forward.' })
    expect(screen.getByText('3 / 4')).toBeInTheDocument()
    expect(screen.getByText('1 proposed exercises were discarded')).toBeInTheDocument()
    const session = (await db.exerciseSessions.toArray())[0]
    expect(session.status).toBe('completed')
    expect(await db.exerciseAttempts.count()).toBe(4)
    const cards = await db.studyCards.toArray()
    expect(cards.every(card => card.reps >= 1)).toBe(true)
    expect(cards.find(card => card.ref === refs[0])!.state).toBe('review')

    await act(async () => { window.location.hash = 'lessons'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await screen.findByRole('heading', { name: 'Learn something new, or keep what you know.' })
    await waitFor(() => expect(screen.getByRole('heading', { name: '0 items due' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Review due items' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Review anyway' })).toBeEnabled()
    await act(async () => { window.location.hash = 'dictionary'; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await screen.findByRole('button', { name: `My knowledge set (${refs.filter(ref => ref.startsWith('vocabulary:')).length})` })
  }, 20000)
})
