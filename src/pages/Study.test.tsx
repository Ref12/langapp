import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { loadCatalog } from '../core/study/catalog'
import type { Exercise } from '../core/study/contracts'
import { addToKnowledge, nextGroup } from '../core/study/knowledge'

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
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function seedExercise(type: Exercise['type']) {
  const refs = ['vocabulary:wo3--me', 'vocabulary:xue2-xi2--study']
  await addToKnowledge(refs)
  const exercise: Exercise = type === 'choice'
    ? { id: 'choice', type, targets: refs, direction: 'zh-to-en', question: '我', options: ['I', 'you'], answer: 0, explanation: 'The answer means I.' }
    : { id: 'tiles', type, targets: refs, translation: 'I study.', tiles: ['我', '学习'], distractors: [], shuffled: [1, 0], explanation: 'The subject comes before the verb.' }
  const session = {
    id: 'saved-exercise', mode: 'review' as const, domain: 'reading' as const, targetRefs: refs, reviewRefs: [],
    exercises: [exercise], cursor: 0, status: 'active' as const, model: 'fixture', rejected: [], createdAt: Date.now(),
  }
  await db.exerciseSessions.add(session)
  window.location.hash = `#lessons/session/${session.id}`
  return session
}

async function chooseAnswer(user: ReturnType<typeof userEvent.setup>, type: Exercise['type'], correct = true) {
  if (type === 'choice') {
    await user.click(screen.getByRole('radio', { name: correct ? 'I' : 'you' }))
  } else {
    const bank = screen.getByRole('group', { name: 'Available tiles' })
    for (const tile of correct ? ['我', '学习'] : ['学习', '我']) await user.click(within(bank).getByRole('button', { name: tile }))
  }
}

function expectResultAction(button: HTMLElement, result: 'correct' | 'incorrect') {
  expect(screen.getByRole('button', { name: 'Next' })).toBe(button)
  expect(button).toHaveClass(`answer-result-${result}`)
  expect(button).toHaveAttribute('data-result', result)
  const actions = button.closest('.answer-actions')
  const feedback = document.querySelector('.practice-player .notice')
  expect(actions).toBeInTheDocument()
  expect(feedback).toBeInTheDocument()
  expect(actions).not.toContainElement(feedback as HTMLElement)
  expect(actions!.compareDocumentPosition(feedback!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
}

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
    const firstAction = screen.getByRole('button', { name: 'Check answer' })
    expect(firstAction).toBeEnabled()
    await user.click(firstAction)
    await screen.findByText('Not quite.')
    expectResultAction(firstAction, 'incorrect')
    expect(screen.getByText('Exercise 1 of 4')).toBeInTheDocument()
    expect(screen.getByText('Identity with 是.')).toBeInTheDocument()
    cleanup()
    render(<App />)
    await screen.findByText('Not quite.')
    expectResultAction(screen.getByRole('button', { name: 'Next' }), 'incorrect')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Arrange the tiles to translate this.' })
    const bank = screen.getByRole('group', { name: 'Available tiles' })
    for (const tile of ['我', '是', '学生']) await user.click(within(bank).getByRole('button', { name: tile }))
    const tileAction = screen.getByRole('button', { name: 'Check answer' })
    await user.click(tileAction)
    await screen.findByText('Correct.')
    expectResultAction(tileAction, 'correct')
    expect(screen.getByText('Exercise 2 of 4')).toBeInTheDocument()
    expect(screen.getByText('Subject, 是, noun.')).toBeInTheDocument()
    await user.click(tileAction)
    await screen.findByRole('heading', { name: 'Which Mandarin matches?' })
    expect(screen.queryByText('Correct.')).not.toBeInTheDocument()
    expect(screen.queryByText('Subject, 是, noun.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: '我学习。' }))
    const chineseAction = screen.getByRole('button', { name: 'Check answer' })
    await user.click(chineseAction)
    await screen.findByText('Correct.')
    expectResultAction(chineseAction, 'correct')
    expect(screen.getByText('Exercise 3 of 4')).toBeInTheDocument()
    expect(screen.getByText('学习 means study.')).toBeInTheDocument()
    await user.click(chineseAction)
    await screen.findByRole('heading', { name: 'What does this mean?' })
    expect(screen.queryByText('Correct.')).not.toBeInTheDocument()
    expect(screen.queryByText('学习 means study.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'student' }))
    const finalAction = screen.getByRole('button', { name: 'Check answer' })
    await user.click(finalAction)
    await screen.findByText('Correct.')
    expectResultAction(finalAction, 'correct')
    expect(screen.getByText('Exercise 4 of 4')).toBeInTheDocument()
    expect((await db.exerciseSessions.toArray())[0].status).toBe('active')
    await user.click(finalAction)
    await screen.findByRole('heading', { name: 'One more step forward.' })
    expect(screen.getByText('3 / 4')).toBeInTheDocument()
    expect(screen.getByText('1 proposed exercises were discarded')).toBeInTheDocument()
    const session = (await db.exerciseSessions.toArray())[0]
    expect(session.status).toBe('completed')
    expect(await db.exerciseAttempts.count()).toBe(4)
    expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(1)
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

  it.each(['choice', 'tiles'] as const)('retries failed %s advancement after reload without saving or grading twice', async type => {
    const user = userEvent.setup()
    const session = await seedExercise(type)
    const save = vi.spyOn(db.exerciseAttempts, 'add')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start exercises' }))
    const action = screen.getByRole('button', { name: 'Check answer' })
    expect(action).toBeDisabled()
    await chooseAnswer(user, type)
    await user.click(action)
    await screen.findByText('Correct.')
    expectResultAction(action, 'correct')
    expect(screen.getByText(session.exercises[0].explanation)).toBeInTheDocument()
    expect((await db.exerciseSessions.get(session.id))!.status).toBe('active')
    const advance = vi.spyOn(db.exerciseSessions, 'put').mockRejectedValueOnce(new Error('Advance failed'))
    await user.click(action)
    expect(await screen.findByRole('alert')).toHaveTextContent('Advance failed')
    expectResultAction(action, 'correct')
    expect(action).toBeEnabled()
    expect(advance).toHaveBeenCalledTimes(1)
    expect((await db.exerciseSessions.get(session.id))!.cursor).toBe(0)
    const attempts = await db.exerciseAttempts.toArray()
    expect(attempts).toHaveLength(1)
    expect(attempts[0].correct).toBe(true)
    const cards = await db.studyCards.toArray()
    cleanup()
    render(<App />)
    const resumedAction = await screen.findByRole('button', { name: 'Next' })
    expectResultAction(resumedAction, 'correct')
    expect(screen.getByText(session.exercises[0].explanation)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check answer' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'One more step forward.' })
    expect(await db.exerciseAttempts.toArray()).toEqual(attempts)
    expect(await db.studyCards.toArray()).toEqual(cards)
    expect(save).toHaveBeenCalledTimes(1)
    expect((await db.exerciseSessions.get(session.id))!.exercises).toEqual(session.exercises)
    expect(structured.requestStructuredJSON).not.toHaveBeenCalled()
  })

  it.each(['choice', 'tiles'] as const)('keeps an unsaved %s answer available when saving fails', async type => {
    const user = userEvent.setup()
    const session = await seedExercise(type)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start exercises' }))
    await chooseAnswer(user, type)
    vi.spyOn(db.exerciseAttempts, 'add').mockRejectedValueOnce(new Error('Save failed'))
    const action = screen.getByRole('button', { name: 'Check answer' })
    await user.click(action)
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
    expect(await db.exerciseAttempts.count()).toBe(0)
    expect((await db.exerciseSessions.get(session.id))!.status).toBe('active')
    expect(screen.queryByText(session.exercises[0].explanation)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check answer' })).toBe(action)
    expect(action).toBeEnabled()
    expect(action).not.toHaveAttribute('data-result')
    expect(action).not.toHaveClass('answer-result-correct', 'answer-result-incorrect')
    await user.click(action)
    await screen.findByText('Correct.')
    expectResultAction(action, 'correct')
    expect((await db.exerciseSessions.get(session.id))!.status).toBe('active')
    await user.click(action)
    await screen.findByRole('heading', { name: 'One more step forward.' })
    expect(await db.exerciseAttempts.count()).toBe(1)
    expect((await db.studyCards.toArray()).every(card => card.reps === 1)).toBe(true)
    expect(structured.requestStructuredJSON).not.toHaveBeenCalled()
  })

  it('keeps a wrong final tile sentence for review and resumes it without another grade', async () => {
    const user = userEvent.setup()
    const session = await seedExercise('tiles')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start exercises' }))
    await chooseAnswer(user, 'tiles', false)
    const action = screen.getByRole('button', { name: 'Check answer' })
    await user.click(action)
    await screen.findByText('Not quite.')
    expectResultAction(action, 'incorrect')
    expect(screen.getByText(session.exercises[0].explanation)).toBeInTheDocument()
    expect(within(document.querySelector('.practice-player .notice')!).getByText('我学习')).toBeInTheDocument()
    expect((await db.exerciseSessions.get(session.id))!.status).toBe('active')
    const attempts = await db.exerciseAttempts.toArray()
    const cards = await db.studyCards.toArray()
    cleanup()
    render(<App />)
    await screen.findByText('Not quite.')
    expectResultAction(screen.getByRole('button', { name: 'Next' }), 'incorrect')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'One more step forward.' })
    expect(screen.getByText('0 / 1')).toBeInTheDocument()
    expect(await db.exerciseAttempts.toArray()).toEqual(attempts)
    expect(await db.studyCards.toArray()).toEqual(cards)
  })
})
