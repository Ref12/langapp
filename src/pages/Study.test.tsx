import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { openPhraseActions } from '../test/phrase-actions'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { loadCatalog } from '../core/study/catalog'
import type { Exercise } from '../core/study/contracts'
import * as speech from '../core/assistant/speech'
import { savePreferences } from '../core/learning'
import { addToKnowledge, nextGroup } from '../core/study/knowledge'

// These tests cover the AI path alone; the programmatic opening set has its own tests (local-exercises.test.ts, local-lesson.test.ts).
vi.mock('../core/study/local-exercises', async importOriginal => ({ ...await importOriginal<typeof import('../core/study/local-exercises')>(), localVocabularyExercises: () => [], fillLocalExercises: () => [] }))

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

async function seedExercise(type: 'choice' | 'tiles') {
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

async function chooseAnswer(user: ReturnType<typeof userEvent.setup>, type: 'choice' | 'tiles', correct = true) {
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
  it('Start makes a new session; a redo row does not trigger the New card note', async () => {
    const user = userEvent.setup()
    await db.aiConnections.add(connection)
    const group = nextGroup(await loadCatalog(), new Set())!
    const refs = group.units.map(unit => unit.ref)
    await db.exerciseSessions.add({ id: 'old-redo', mode: 'new', domain: 'reading', groupId: group.group.id, targetRefs: refs, reviewRefs: [], exercises: [], cursor: 0,
      status: 'active', model: 'm', rejected: [], createdAt: 1, redoOf: 'x' })
    structured.requestStructuredJSON.mockImplementation(async (_c, request) => {
      const targets = JSON.parse(request.user).targets.map((target: { ref: string }) => target.ref)
      return { exercises: [
        { id: 'c1', type: 'choice', targets: targets.slice(0, 1), direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'x' },
        { id: 'c2', type: 'choice', targets: targets.slice(0, 2), direction: 'en-to-zh', question: 'I study.', options: ['我学习。', '我是学生。'], answer: 0, explanation: 'x' },
        { id: 't1', type: 'tiles', targets, translation: 'I am a student.', tiles: ['我', '是', '学生'], distractors: ['学习'], explanation: 'x' },
        { id: 't2', type: 'tiles', targets: targets.slice(-1), translation: 'I study.', tiles: ['我', '学习'], distractors: [], explanation: 'x' },
      ] }
    })
    render(<App />)
    expect(await screen.findByText(/^Redo: lesson of /)).toBeInTheDocument()
    expect(screen.queryByText('Your unfinished lesson is in Pick up where you left off.')).not.toBeInTheDocument()
    const start = screen.getByRole('button', { name: 'Start new items' })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    await waitFor(async () => expect(await db.exerciseSessions.count()).toBe(2))
    expect(window.location.hash).not.toContain('old-redo')
    expect((await db.exerciseSessions.get('old-redo'))!.status).toBe('active')
  })

  it('lists unfinished lessons by origin and Discard abandons one after confirming', async () => {
    const user = userEvent.setup()
    const base = { domain: 'reading' as const, targetRefs: [], reviewRefs: [], exercises: [], cursor: 0, status: 'active' as const, model: 'm', rejected: [] }
    await db.collections.add({ id: 'c1', name: 'My phrases', kind: 'user', createdAt: 1, updatedAt: 1 })
    await db.exerciseSessions.bulkAdd([
      { ...base, id: 'n', mode: 'new', createdAt: 3 }, { ...base, id: 'col', mode: 'review', collectionId: 'c1', createdAt: 2 }, { ...base, id: 'rd', mode: 'new', redoOf: 'gone', createdAt: 1 },
    ])
    render(<App />)
    await screen.findByRole('button', { name: 'Discard My phrases · Review' })
    const labels = (await screen.findAllByRole('button', { name: /^Discard / })).map(button => button.getAttribute('aria-label') ?? '')
    expect(labels.slice(0, 2)).toEqual(['Discard New items', 'Discard My phrases · Review'])
    expect(labels[2]).toMatch(/^Discard Redo: lesson of /)
    expect(screen.getByText('Your unfinished lesson is in Pick up where you left off.')).toBeInTheDocument()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Discard My phrases · Review' }))
    expect((await db.exerciseSessions.get('col'))!.status).toBe('active')
    await user.click(screen.getByRole('button', { name: 'Discard My phrases · Review' }))
    await waitFor(async () => expect((await db.exerciseSessions.get('col'))!.status).toBe('abandoned'))
    expect(confirm).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Discard My phrases · Review' })).not.toBeInTheDocument())
  })

  it('asks for an AI connection before any session can start', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Learn something new, or keep what you know.' })
    await screen.findByRole('heading', { name: /new items$/ })
    expect(await screen.findByRole('link', { name: 'Connect a model in Settings' })).toHaveAttribute('href', '#settings')
    expect(screen.getByRole('button', { name: 'Start new items' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start new items' })).toHaveTextContent(/^Start$/)
    expect(screen.getByRole('button', { name: 'Review due items' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: '0 items due' })).toBeInTheDocument()
    // The predefined blurbs show before any session exists, no AI wait.
    const preview = within(screen.getByRole('region', { name: 'New items' })).getByRole('list', { name: 'Items in this group' })
    expect(within(preview).getByText('我')).toBeInTheDocument()
    expect(within(preview).getByText('I, me, my')).toBeInTheDocument()
    expect(await db.knowledge.count()).toBe(0)
  })

  it('shows the item cards at once with a disabled "Generating with AI…" footer, then Start; a failure offers Try again', async () => {
    const user = userEvent.setup()
    await db.aiConnections.add(connection)
    const group = nextGroup(await loadCatalog(), new Set())!
    const refs = group.units.map(unit => unit.ref)
    let release: (value: unknown) => void = () => undefined
    let fail: (reason: Error) => void = () => undefined
    structured.requestStructuredJSON.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    render(<App />)
    const newCard = await screen.findByRole('region', { name: 'New items' })
    await within(newCard).findByRole('heading', { name: `${refs.length} new items` })
    const start = screen.getByRole('button', { name: 'Start new items' })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    await screen.findByRole('heading', { name: 'Meet your new items.' })
    expect(screen.queryByText(/Preparing your/)).not.toBeInTheDocument()
    const footer = screen.getByRole('region', { name: 'Start the exercises' })
    expect(within(footer).getByRole('button', { name: 'Generating with AI…' })).toBeDisabled()
    await waitFor(() => expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(1))
    fail(new Error('Model unavailable'))
    expect(await within(footer).findByText('Model unavailable')).toBeInTheDocument()
    structured.requestStructuredJSON.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await user.click(within(footer).getByRole('button', { name: /Try again/ }))
    expect(await within(footer).findByRole('button', { name: 'Generating with AI…' })).toBeDisabled()
    await waitFor(() => expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(2))
    release({ exercises: [
      { id: 'c1', type: 'choice', targets: [refs[0]], direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'x' },
      { id: 'c2', type: 'choice', targets: [refs[1]], direction: 'en-to-zh', question: 'I study.', options: ['我学习。', '我是学生。'], answer: 0, explanation: 'x' },
      { id: 'c3', type: 'choice', targets: [refs[2]], direction: 'zh-to-en', question: '学生', options: ['student', 'teacher'], answer: 0, explanation: 'x' },
      { id: 'c4', type: 'choice', targets: [refs[0]], direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'y' },
    ] })
    expect(await within(footer).findByRole('button', { name: 'Start' })).toBeEnabled()
    expect(await within(footer).findByText(/4 exercises in 1 part/)).toBeInTheDocument()
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
    // The button stays disabled until the AI connection's live query has resolved (disabled={... || !connection}); a click before
    // that is silently ignored and the heading never appears, so wait for the enabled state that gates the click.
    const start = screen.getByRole('button', { name: 'Start new items' })
    await waitFor(() => expect(start).toBeEnabled())
    await user.click(start)
    await screen.findByRole('heading', { name: 'Meet your new items.' })
    await screen.findByRole('button', { name: 'Start' }, { timeout: 5000 })
    expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(1)
    expect(await db.knowledge.count()).toBe(refs.length)
    // Starting added every item, so the per-card knowledge-set state is not repeated on this page.
    expect(screen.queryByRole('button', { name: /knowledge set/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Eligible for review')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Start the exercises' })).toContainElement(screen.getByRole('button', { name: 'Start' }))
    // Each example row has its own Hear icon and "…" menu (Ask, Practice, Write); it opens the practice playlist for that phrase.
    const hearButtons = screen.getAllByRole('button', { name: /^Hear/ })
    const menus = screen.getAllByRole('button', { name: 'Phrase actions' })
    expect(menus).toHaveLength(hearButtons.length)
    expect(hearButtons.length).toBeGreaterThan(0)
    expect(screen.getAllByText('I am a student.').length).toBeGreaterThan(0)
    await user.click(openPhraseActions().getByRole('button', { name: 'Practice' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await screen.findByRole('heading', { name: 'What does this mean?' })
    expect(screen.getByText('Exercise 1 of 4')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'I study.' }))
    const firstAction = screen.getByRole('button', { name: 'Check answer' })
    expect(firstAction).toBeEnabled()
    await user.click(firstAction)
    await screen.findByText('Not quite.')
    expectResultAction(firstAction, 'incorrect')
    expect(await screen.findByText('Exercise 1 of 5 · 1 to redo')).toBeInTheDocument()
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
    expect(screen.getByText('Exercise 2 of 5 · 1 to redo')).toBeInTheDocument()
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
    expect(screen.getByText('Exercise 3 of 5 · 1 to redo')).toBeInTheDocument()
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
    expect(screen.getByText('Exercise 4 of 5 · 1 to redo')).toBeInTheDocument()
    expect((await db.exerciseSessions.toArray())[0].status).toBe('active')
    await user.click(finalAction)
    // The missed first exercise comes back at the end as a redo.
    expect(await screen.findByText('Redo')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'I am a student.' }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByText('Correct.')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Items in this session' })
    expect(screen.getByText('3 / 4')).toBeInTheDocument()
    expect(screen.getByText('1 proposed exercises were discarded')).toBeInTheDocument()
    const session = (await db.exerciseSessions.toArray())[0]
    expect(session.status).toBe('completed')
    const knowledgeLink = screen.getByRole('link', { name: 'See your knowledge set' })
    expect(knowledgeLink).toHaveAttribute('href', '#dictionary/vocabulary/knowledge')
    await act(async () => { window.location.hash = knowledgeLink.getAttribute('href')!.slice(1); window.dispatchEvent(new HashChangeEvent('hashchange')) })
    expect(await screen.findByRole('button', { name: /^My knowledge set \(/ })).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { window.location.hash = `lessons/session/${session.id}`; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    await screen.findByRole('heading', { name: 'Items in this session' })
    expect(await db.exerciseAttempts.count()).toBe(5) // four first tries and one redo
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
    await user.click(await screen.findByRole('button', { name: 'Start' }))
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
    await screen.findByRole('heading', { name: 'Items in this session' })
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
    await user.click(await screen.findByRole('button', { name: 'Start' }))
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
    await screen.findByRole('heading', { name: 'Items in this session' })
    expect(await db.exerciseAttempts.count()).toBe(1)
    expect((await db.studyCards.toArray()).every(card => card.reps === 1)).toBe(true)
    expect(structured.requestStructuredJSON).not.toHaveBeenCalled()
  })

  it('renders each Mandarin option as one card with radio, text and Hear button inside it (jsdom cannot measure boxes; the Playwright shots cover that)', async () => {
    const user = userEvent.setup()
    const session = await seedExercise('choice')
    await db.exerciseSessions.put({ ...session, exercises: [{ id: 'zh', type: 'choice', targets: session.targetRefs, direction: 'en-to-zh', question: 'I study.', options: ['我学习', '学习我', '我我', '学习'], answer: 0, explanation: 'x' }] })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    const cards = document.querySelectorAll('.answer-option')
    expect(cards).toHaveLength(4)
    cards.forEach((card, index) => {
      expect(card.tagName).toBe('LABEL')
      expect(card.querySelector(':scope > input[type="radio"]')).not.toBeNull()
      expect(card.querySelector(':scope > .snippet-button')).toHaveAccessibleName(`Hear option ${index + 1}`)
    })
  })

  it('keeps a wrong final tile sentence for review and resumes it without another grade', async () => {
    const user = userEvent.setup()
    const session = await seedExercise('tiles')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
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
    expect(await db.exerciseAttempts.toArray()).toEqual(attempts)
    expect(await db.studyCards.toArray()).toEqual(cards)
    // The miss comes back at the end as a redo: not scored again, and the summary keeps the first-try result.
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Redo')
    await chooseAnswer(user, 'tiles', true)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByText('Correct.')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Items in this session' })
    expect(screen.getByText('0 / 1')).toBeInTheDocument()
    expect(await db.studyCards.toArray()).toEqual(cards)
  })

  it.each(['choice', 'tiles'] as const)('shows no "PRACTICES" hint while answering a %s exercise, and the practised items after the answer', async type => {
    const user = userEvent.setup()
    await seedExercise(type)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    await screen.findByRole('heading', { level: 2 })
    expect(screen.queryByText(/PRACTICES/)).not.toBeInTheDocument()
    expect(document.querySelector('.practice-context')).toBeNull()
    expect(screen.queryByText(/Practiced:/)).not.toBeInTheDocument()
    expect(screen.getByText('Exercise 1 of 1')).toBeInTheDocument()
    expect(screen.queryByText('Redo')).not.toBeInTheDocument()
    await chooseAnswer(user, type, true)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByText('Practiced: 我 / 学习')).toBeInTheDocument()
  })

  it('shows the redo queue in the header and a Redo badge on the redo card, and a second miss comes back once more', async () => {
    const user = userEvent.setup()
    const session = await seedExercise('tiles')
    const second: Exercise = { id: 'c2', type: 'choice', targets: ['vocabulary:wo3--me'], direction: 'zh-to-en', question: '我', options: ['I', 'you'], answer: 0, explanation: 'Means I.' }
    await db.exerciseSessions.put({ ...session, exercises: [...session.exercises, second] })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    await chooseAnswer(user, 'tiles', false)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByText('Not quite.')
    expect(await screen.findByText(/Exercise 1 of 3 · 1 to redo/)).toBeInTheDocument()
    expect(screen.getByText(/comes back at the end for a redo/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('radio', { name: 'I' }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await user.click(await screen.findByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Redo')).toBeInTheDocument()
    expect(screen.getByText(/Exercise 3 of 3 · 1 to redo/)).toBeInTheDocument()
    expect(screen.queryByText(/PRACTICES/)).not.toBeInTheDocument()
    await chooseAnswer(user, 'tiles', false)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByText(/comes back once more at the end/)).toBeInTheDocument()
    expect(await screen.findByText(/Exercise 3 of 4 · 2 to redo/)).toBeInTheDocument()
  })

  it('accepts an alternative answer and shows the main one as "Also:"', async () => {
    const user = userEvent.setup()
    const session = await seedExercise('tiles')
    const tiles = session.exercises[0] as Extract<Exercise, { type: 'tiles' }>
    await db.exerciseSessions.put({ ...session, exercises: [{ ...tiles, acceptedAnswers: ['学习我'] }] })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    await chooseAnswer(user, 'tiles', false)
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect(await screen.findByText('Correct.')).toBeInTheDocument()
    expect(screen.getByText(/another good way to say it/)).toBeInTheDocument()
    expect(within(document.querySelector('.practice-player .notice')!).getByText(/Also:/)).toBeInTheDocument()
    expect(within(document.querySelector('.practice-player .notice')!).getByText('我学习')).toBeInTheDocument()
    expect((await db.exerciseSessions.get(session.id))!.redos).toBeUndefined()
  })

  it('keeps each Mandarin option\'s radio, text and Hear button inside its own card', async () => {
    // jsdom does no layout, so bounding boxes are checked in the Playwright shots; this pins the structure the CSS relies on.
    const user = userEvent.setup()
    const session = await seedExercise('choice')
    await db.exerciseSessions.put({ ...session, exercises: [{ id: 'zh', type: 'choice', targets: session.targetRefs, direction: 'en-to-zh', question: 'Chinese-language teacher', options: ['汉语学生', '老师汉语', '学生汉语', '汉语老师'], answer: 1, explanation: 'x' }] })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    const cards = [...document.querySelectorAll('.answer-option')]
    expect(cards).toHaveLength(4)
    cards.forEach((card, index) => {
      expect(card.querySelectorAll('input[type="radio"]')).toHaveLength(1)
      expect(card.querySelectorAll('.snippet-button')).toHaveLength(1)
      expect(within(card as HTMLElement).getByRole('button', { name: `Hear option ${index + 1}` })).toBeInTheDocument()
    })
  })

  it('speaks a tile when tapped and still moves it, from the bank and the answer row', async () => {
    const user = userEvent.setup()
    const play = vi.mocked(speech.playBrowserSpeech)
    await seedExercise('tiles')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    const bank = screen.getByRole('group', { name: 'Available tiles' })
    await user.click(within(bank).getByRole('button', { name: '我' }))
    expect(play).toHaveBeenLastCalledWith(expect.any(String), '我', 'zh-Hans')
    const answer = screen.getByRole('group', { name: 'Your sentence' })
    await user.click(within(answer).getByRole('button', { name: '我' }))
    expect(play).toHaveBeenCalledTimes(2)
    expect(play).toHaveBeenLastCalledWith(expect.any(String), '我', 'zh-Hans')
    expect(within(answer).queryByRole('button', { name: '我' })).not.toBeInTheDocument()
    await user.click(within(bank).getByRole('button', { name: '学习' }))
    expect(within(answer).getByRole('button', { name: '学习' })).toBeInTheDocument()
  })

  it('stays silent but still moves tiles when the tile speech toggle is off, and remembers it', async () => {
    const user = userEvent.setup()
    const play = vi.mocked(speech.playBrowserSpeech)
    await seedExercise('tiles')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    await user.click(screen.getByRole('button', { name: 'Mute tiles' }))
    await screen.findByRole('button', { name: 'Speak tiles' })
    expect((await db.preferences.get('workspace'))!.tileAutoSpeak).toBe(false)
    await user.click(within(screen.getByRole('group', { name: 'Available tiles' })).getByRole('button', { name: '我' }))
    expect(play).not.toHaveBeenCalled()
    expect(within(screen.getByRole('group', { name: 'Your sentence' })).getByRole('button', { name: '我' })).toBeInTheDocument()
  })
})

describe('Speech toggles', () => {
  const zhToEn = (id: string, question: string): Exercise => ({ id, type: 'choice', targets: [], direction: 'zh-to-en', question, options: ['I', 'you'], answer: 0, explanation: 'x' })
  async function seedTwo() {
    const session = await seedExercise('choice')
    await db.exerciseSessions.put({ ...session, exercises: [zhToEn('a', '我'), zhToEn('b', '你')] })
  }
  const prompts = () => vi.mocked(speech.playBrowserSpeech).mock.calls.map(call => call[1])

  it('does not auto-play the prompt by default', async () => {
    const user = userEvent.setup()
    await seedTwo()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    await screen.findByRole('button', { name: 'Auto-play off' })
    expect(prompts()).toEqual([])
  })

  it('plays the prompt once on entry, not after Check, and again on the next exercise', async () => {
    const user = userEvent.setup()
    await seedTwo()
    render(<App />)
    const start = await screen.findByRole('button', { name: 'Start' })
    await savePreferences({ promptAutoPlay: true })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) }) // let the live workspace query pick it up
    await user.click(start)
    await screen.findByRole('button', { name: 'Auto-play' })
    expect(prompts()).toEqual(['我'])
    await user.click(screen.getByRole('radio', { name: 'I' }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByText('Correct.')
    expect(prompts()).toEqual(['我'])
    await user.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(prompts()).toEqual(['我', '你']))
  })

  it('shows the auto-play toggle only on Chinese-prompt exercises', async () => {
    const user = userEvent.setup()
    const session = await seedExercise('tiles')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    await screen.findByRole('button', { name: 'Mute tiles' })
    expect(screen.queryByRole('button', { name: /Auto-play/ })).not.toBeInTheDocument()
    cleanup()
    await db.exerciseSessions.put({ ...session, exercises: [{ id: 'zh', type: 'choice', targets: session.targetRefs, direction: 'en-to-zh', question: 'teacher', options: ['老师', '学生'], answer: 0, explanation: 'x' }] })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    await screen.findByRole('button', { name: 'Mute choices' })
    expect(screen.queryByRole('button', { name: /Auto-play/ })).not.toBeInTheDocument()
  })

  it('speaks a selected Chinese option unless choices are muted', async () => {
    const user = userEvent.setup()
    const play = vi.mocked(speech.playBrowserSpeech)
    const session = await seedExercise('choice')
    await db.exerciseSessions.put({ ...session, exercises: [{ id: 'zh', type: 'choice', targets: session.targetRefs, direction: 'en-to-zh', question: 'teacher', options: ['老师', '学生'], answer: 0, explanation: 'x' }] })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Start' }))
    await user.click(screen.getAllByRole('radio')[1])
    expect(play).toHaveBeenLastCalledWith(expect.any(String), '学生', 'zh-Hans')
    await user.click(screen.getByRole('button', { name: 'Mute choices' }))
    await screen.findByRole('button', { name: 'Speak choices' })
    play.mockClear()
    await user.click(screen.getAllByRole('radio')[0])
    expect(play).not.toHaveBeenCalled()
  })
})

describe('Finished lesson session', () => {
  const refs = ['vocabulary:wo3--me', 'vocabulary:xue2-xi2--study']
  async function seedFinished() {
    await addToKnowledge(refs)
    const exercise: Exercise = { id: 'choice', type: 'choice', targets: refs, direction: 'zh-to-en', question: '我', options: ['I', 'you'], answer: 0, explanation: 'The answer means I.' }
    await db.exerciseSessions.add({
      id: 'done-1', mode: 'review', domain: 'reading', targetRefs: [refs[0]], reviewRefs: [refs[1]], exercises: [exercise], cursor: 0,
      status: 'completed', model: 'fixture', rejected: [], createdAt: 1000, completedAt: 2000,
    })
    await db.exerciseAttempts.add({ id: 'done-1:0', sessionId: 'done-1', index: 0, refs, response: '0', correct: true, createdAt: 1500 } as never)
    window.location.hash = '#lessons/session/done-1'
  }

  it('lists the items with the phrase actions and redoes the session with the same items', async () => {
    const user = userEvent.setup()
    await seedFinished()
    await db.aiConnections.add(connection)
    structured.requestStructuredJSON.mockResolvedValueOnce({ exercises: ['c1', 'c2', 'c3', 'c4'].map(id => (
      { id, type: 'choice', targets: refs, direction: 'zh-to-en', question: '我', options: ['I', 'you'], answer: 0, explanation: 'The answer means I.' })) })
    render(<App />)
    const results = await screen.findByRole('region', { name: 'Results' })
    expect(results).toHaveTextContent('1 / 1 correct')
    expect(results).toHaveTextContent('2 items')
    expect(within(results).getByRole('link', { name: 'See your knowledge set' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Items in this session' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Hear/ }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Back to Lessons/ })).toBeInTheDocument()
    const redo = screen.getByRole('button', { name: /Redo exercises/ })
    await waitFor(() => expect(redo).toBeEnabled())
    await user.click(redo)
    await waitFor(() => expect(window.location.hash).not.toBe('#lessons/session/done-1'))
    const created = (await db.exerciseSessions.toArray()).find(item => item.id !== 'done-1')!
    expect(created).toMatchObject({ mode: 'review', targetRefs: [refs[0]], reviewRefs: [refs[1]], redoOf: 'done-1', status: 'active' })
    expect(window.location.hash).toBe(`#lessons/session/${created.id}`)
    expect(await db.exerciseSessions.get('done-1')).toMatchObject({ status: 'completed' })
    expect(await db.exerciseAttempts.count()).toBe(1)
  })

  it('disables Redo without an AI connection and shows "no answers" when nothing was answered', async () => {
    await seedFinished()
    await db.exerciseAttempts.clear()
    render(<App />)
    const results = await screen.findByRole('region', { name: 'Results' })
    expect(results).toHaveTextContent('no answers')
    await waitFor(() => expect(screen.getByRole('link', { name: 'Connect a model in Settings' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Redo exercises/ })).toBeDisabled()
  })
})
