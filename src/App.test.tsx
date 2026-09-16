import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { db } from './core/database'
import { getWord } from './data/mandarin'
import { trackWord } from './core/learning'

beforeEach(async () => {
  window.location.hash = ''
  document.documentElement.dataset.theme = 'dark'
  await db.delete()
  await db.open()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

describe('Mandarin learning loop', () => {
  it('starts with real zero progress, persists a word from reading, and resumes its bookmark', async () => {
    const user = userEvent.setup()
    const view = render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    expect(await db.words.count()).toBe(0)
    await user.click(screen.getByRole('link', { name: 'Start reading' }))
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

  it('resumes a saved answer after reload and shares lesson practice with Dictionary', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Make the language yours.' })
    await go('lesson/zh:greetings')
    await screen.findByRole('heading', { name: 'Greet someone and say thanks' })
    await user.click(screen.getByRole('button', { name: 'Start lesson practice' }))
    await screen.findByRole('heading', { name: 'What does this word mean?' })
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
    await go('dictionary')
    await screen.findByRole('heading', { name: 'Your learning set.' })
    const card = screen.getByRole('heading', { name: getWord(session.questions[0].wordId).native }).closest('article')!
    await user.click(within(card).getByText('Skill progress'))
    expect(within(card).getAllByText('Practicing').length).toBeGreaterThan(0)
    expect(within(card).getAllByText('Not studied')).toHaveLength(3)
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
    await user.type(screen.getByRole('searchbox', { name: 'Search dictionary' }), 'cha')
    expect(screen.getByRole('heading', { name: getWord('zh:tea').native })).toBeInTheDocument()
    cleanup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Your learning set.' })
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
