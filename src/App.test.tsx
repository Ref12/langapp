import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db, initializeWorkspace } from './core/database'
import { getWord } from './data/mandarin'
import { advancePractice, startPractice, submitAnswer, trackWord } from './core/learning'
import { curriculumLessons } from './data/curriculum'
import { seedRetiredLesson } from './test/retired-lesson'
import { resetProfileStorage } from './test/profile-storage'
import { resetProfilesForTests, SELECTED_PROFILE_KEY } from './core/profiles/store'

beforeEach(async () => {
  window.location.hash = ''
  document.documentElement.dataset.theme = 'dark'
  await resetProfileStorage()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

describe('Mandarin learning loop', () => {
  it('opens existing browser preferences as default without replacing them', async () => {
    await initializeWorkspace()
    await db.preferences.update('workspace', { name: 'Existing workspace', theme: 'light', defaultSpeechRate: 0.75 })
    await trackWord('zh:tea', 'test')
    const saved = await db.words.toArray()
    resetProfilesForTests()
    render(<App />)
    expect(await screen.findByRole('link', { name: 'Active profile: default' })).toBeInTheDocument()
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    expect(await db.preferences.get('workspace')).toMatchObject({ name: 'Existing workspace', theme: 'light', defaultSpeechRate: 0.75 })
    expect(await db.words.toArray()).toEqual(saved)
  })

  it('offers non-destructive default-profile recovery for an unavailable selection', async () => {
    await initializeWorkspace()
    await db.preferences.update('workspace', { name: 'Keep this workspace' })
    localStorage.setItem(SELECTED_PROFILE_KEY, '8185cd97-7797-468d-84e2-e4850279bf12')
    resetProfilesForTests()
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('selected profile is unavailable')
    expect(screen.getByRole('button', { name: 'Open default profile' })).toBeInTheDocument()
    expect(await db.preferences.get('workspace')).toMatchObject({ name: 'Keep this workspace' })
  })

  it('supports unfamiliar meaning prompts without leaking pinyin into character-selection questions', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    let id = ''
    await act(async () => { id = await startPractice('lesson', curriculumLessons[0].id) })
    await go(`practice/${id}`)
    await screen.findByRole('heading', { name: 'What does this word mean?' })
    expect(document.querySelector('.practice-prompt rt')).toBeInTheDocument()
    const session = (await db.sessions.get(id))!
    const formIndex = session.questions.findIndex(question => question.activity === 'form')
    expect(formIndex).toBeGreaterThanOrEqual(0)
    await act(async () => { await db.sessions.update(id, { cursor: formIndex }) })
    await screen.findByRole('heading', { name: 'Which Mandarin word matches?' })
    expect(document.querySelector('.practice-player rt')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show answer' }))
    await screen.findByText('Answer revealed. This question will be recorded as assisted.')
    expect(document.querySelector('.answer-options rt')).toBeNull()
    expect(document.querySelector('.practice-player .notice rt')).toHaveTextContent(getWord(session.questions[formIndex].wordId).pinyin)
    expect(await db.attempts.count()).toBe(0)
  })

  it('shows the practice activities without the modality disclaimer', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    await go('practice')
    await screen.findByRole('heading', { name: 'A little practice. A little closer.' })
    expect(screen.getByRole('button', { name: 'Review due words' })).toBeInTheDocument()
    expect(screen.queryByText('These are reading-recognition activities, not speaking, listening, handwriting, or HSK assessments. Those skills remain separate.')).not.toBeInTheDocument()
  })

  it('starts with real zero progress, persists a word from reading, and resumes its bookmark', async () => {
    const user = userEvent.setup()
    const view = render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    expect(await db.words.count()).toBe(0)
    await user.click(screen.getByRole('link', { name: 'Library' }))
    await screen.findByRole('heading', { name: 'Your next good read.' })
    await user.click(screen.getByRole('heading', { name: 'A morning at the tea house' }).closest('a')!)
    await screen.findByRole('button', { name: 'Word help: rain' })
    await user.click(screen.getByRole('button', { name: 'Add to learning set' }))
    await screen.findByRole('button', { name: 'In your learning set' })
    expect((await db.words.get('zh:rain'))?.introducedFrom).toBe('story:zh:tea-house')
    await user.click(screen.getByRole('button', { name: 'Read & continue' }))
    await screen.findByRole('button', { name: 'Word help: tea' })
    view.unmount()
    render(<App />)
    await screen.findByRole('button', { name: 'Word help: tea' })
    expect(await db.readings.get('zh:tea-house')).toMatchObject({ passage: 1, completed: [0] })
    await go('dictionary')
    await screen.findByRole('heading', { name: 'Your learning set.' })
    expect(screen.getByRole('heading', { name: getWord('zh:rain').native })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: getWord('zh:tea').native })).not.toBeInTheDocument()
  })

  it('resumes a saved answer after reload and records the attempt on the word', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    await go(`lesson/${curriculumLessons[0].id}`)
    await screen.findByRole('heading', { name: curriculumLessons[0].title })
    await user.click(screen.getByRole('link', { name: 'Go to reading practice' }))
    await screen.findByRole('heading', { name: 'Try the reading practice.' })
    await user.click(screen.getByRole('button', { name: 'Start lesson practice' }))
    await screen.findByRole('heading', { name: 'What does this word mean?' })
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByText('Read, recall, and give yourself room to learn.')).not.toBeInTheDocument()
    const session = (await db.sessions.toArray())[0]
    await user.click(screen.getByRole('button', { name: 'Show answer' }))
    await screen.findByText('Answer revealed. This question will be recorded as assisted.')
    await user.click(screen.getByRole('radio', { name: getWord(session.questions[0].wordId).meaning }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByText('Correct, with help.')
    cleanup()
    render(<App />)
    await screen.findByText('Correct, with help.')
    expect(screen.queryByRole('button', { name: 'Check answer' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next question' }))
    await waitFor(async () => expect((await db.sessions.get(session.id))?.cursor).toBe(1))
    expect((await db.words.get(session.questions[0].wordId))?.attempts).toBe(1)
  })

  it('shows a storage failure without pretending the word was added', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    await go('reader/zh:tea-house')
    await screen.findByRole('button', { name: 'Add to learning set' })
    vi.spyOn(db.words, 'add').mockRejectedValueOnce(new Error('Storage full'))
    await user.click(screen.getByRole('button', { name: 'Add to learning set' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage full')
    expect(await db.words.count()).toBe(0)
    expect(screen.getByRole('button', { name: 'Add to learning set' })).toBeEnabled()
  })

  it('saves appearance and searches tone-marked pinyin without requiring accents', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    await act(() => trackWord('zh:tea', 'test'))
    await go('dictionary')
    await screen.findByRole('searchbox', { name: 'Search dictionary' })
    await screen.findByText(/^\d+ items$/)
    await user.type(screen.getByRole('searchbox', { name: 'Search dictionary' }), 'cha2--tea')
    expect(await screen.findByRole('heading', { name: '茶' })).toBeInTheDocument()
    cleanup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Vocabulary and grammar, by band.' })
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('removes starter lesson routes and links while keeping saved vocabulary practice usable', async () => {
    const id = await seedRetiredLesson()
    render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    await go('lessons')
    await screen.findByRole('heading', { name: 'Learn something new, or keep what you know.' })
    await go('curriculum')
    await screen.findByRole('heading', { name: 'Your Mandarin path.' })
    expect(screen.queryByText('Original starter lessons')).not.toBeInTheDocument()
    expect(document.querySelector('a[href^="#lesson/zh:"]')).toBeNull()
    await go('reader/zh:tea-house')
    await screen.findByRole('button', { name: 'Word help: rain' })
    expect(screen.getByRole('link', { name: 'Explore Mandarin lessons' })).toHaveAttribute('href', '#lessons')
    expect(screen.queryByRole('link', { name: 'Open companion lesson' })).not.toBeInTheDocument()
    await go('lesson/zh:greetings')
    await screen.findByRole('heading', { name: 'This page is not available' })
    await go(`practice/${id}`)
    await screen.findByRole('heading', { name: 'What does this word mean?' })
    const saved = (await db.sessions.get(id))!
    await act(async () => {
      for (const [index, question] of saved.questions.entries()) {
        await submitAnswer(id, index, question.wordId)
        await advancePractice(id, index)
      }
    })
    await screen.findByRole('heading', { name: 'One more step forward.' })
    expect(screen.queryByRole('link', { name: 'Back to lesson' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '#overview')
    expect(await db.words.count()).toBe(2)
    expect((await db.words.get('zh:hello'))?.attempts).toBe(2)
    await go('overview')
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    expect(screen.getByText('lessons practiced').closest('strong')?.textContent).toMatch(/^0/)
  })

  it('prioritizes the next curriculum lesson over recent reading and resumes its practice', async () => {
    const user = userEvent.setup()
    const bookmark = { storyId: 'zh:tea-house', passage: 1, completed: [0], updatedAt: Date.now() }
    await db.readings.add(bookmark)
    render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    const focus = screen.getByRole('article', { name: 'Curriculum focus' })
    expect(within(focus).getByRole('heading', { name: curriculumLessons[0].title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'A morning at the tea house' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^(Start|Continue) reading$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar', { name: 'Story progress' })).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Beginner lesson practice' })).toHaveAttribute('value', '0')
    expect(screen.getByRole('link', { name: 'Start next lesson' })).toHaveAttribute('href', `#lesson/${curriculumLessons[0].id}`)
    await user.click(screen.getByRole('link', { name: 'Start next lesson' }))
    await screen.findByRole('heading', { name: curriculumLessons[0].title })
    await user.click(screen.getByRole('link', { name: 'Go to reading practice' }))
    await screen.findByRole('heading', { name: 'Try the reading practice.' })
    await user.click(screen.getByRole('button', { name: 'Start lesson practice' }))
    await screen.findByRole('heading', { name: 'What does this word mean?' })
    const session = (await db.sessions.toArray())[0]
    await go('overview')
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    expect(screen.getByRole('link', { name: 'Resume lesson' })).toHaveAttribute('href', `#practice/${session.id}`)
    expect(screen.getByText('practice sessions in progress').closest('strong')?.textContent).toMatch(/^1/)
    expect(await db.readings.get(bookmark.storyId)).toEqual(bookmark)
  })

  it('offers continued practice after all available curriculum lessons have been practiced', async () => {
    const now = Date.now()
    await db.lessons.bulkAdd(curriculumLessons.map(lesson => ({ lessonId: lesson.id, startedAt: now, completedAt: now })))
    render(<App />)
    await screen.findByRole('heading', { name: 'Keep your Mandarin growing.' })
    expect(screen.queryByRole('link', { name: 'Start next lesson' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Revisit your vocabulary' })).toHaveAttribute('href', '#practice')
    expect(screen.getByRole('progressbar', { name: 'Beginner lesson practice' })).toHaveAttribute('value', String(curriculumLessons.length))
    expect(screen.getByRole('progressbar', { name: 'Beginner lesson practice' })).toHaveAttribute('max', String(curriculumLessons.length))
    expect(screen.getByText('Practice is a step toward the course goals, not a fluency assessment.')).toBeInTheDocument()
  })
})
