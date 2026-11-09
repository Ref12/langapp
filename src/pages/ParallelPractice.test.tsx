import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { loadParallel, resetParallel, type ParallelLanguage, glossOf } from '../core/parallel/data'
import { parallelKnown } from '../core/parallel/practice'

beforeEach(async () => { localStorage.clear(); resetParallel(); await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(cleanup)

type User = ReturnType<typeof userEvent.setup>
const instruction = () => document.querySelector('[data-instruction]')?.getAttribute('data-instruction')

/** Plays the whole session: always the right answers, reading them from the lesson data. */
async function play(user: User, language: ParallelLanguage) {
  const data = await loadParallel(language)
  const lesson = data.lessons[0]
  const seen: string[] = []
  for (let step = 0; step < 60; step++) {
    if (screen.queryByText(/right the first time/)) break
    await waitFor(() => expect(instruction()).toBeTruthy())
    const form = instruction()!
    if (!seen.includes(form)) seen.push(form)
    if (form === 'intro') { await user.click(screen.getByRole('button', { name: /Got it/ })); continue }
    if (form === 'choice' || form === 'listen-pick') {
      const options = within(document.querySelector('.answer-options') as HTMLElement).getAllByRole('radio')
      const text = document.querySelector('.practice-prompt.native')?.textContent ?? ''
      const entry = Object.values(data.entries).find(item => text.includes(item.target) && lesson.words.some(word => data.entries[word.entry] === item))
      let right = -1
      if (entry) right = [...options].findIndex(option => (option.closest('label')?.textContent ?? '').trim() !== '' && glossOf(entry).toLowerCase().includes((option.closest('label')?.textContent ?? '').replace(/\u2026$/, '').trim().toLowerCase().slice(0, 12)))
      await user.click(options[right >= 0 ? right : 0])
      await user.click(screen.getByRole('button', { name: 'Check answer' }))
      await user.click(screen.getByRole('button', { name: 'Next' }))
      continue
    }
    if (form === 'match') {
      const left = within(screen.getByRole('group', { name: 'First column' })).getAllByRole('button')
      const rightCol = () => within(screen.getByRole('group', { name: 'Second column' })).getAllByRole('button')
      for (const cell of left) {
        const word = Object.values(data.entries).find(item => (cell.textContent ?? '').startsWith(item.target))
        await user.click(cell)
        const target = rightCol().find(button => !button.hasAttribute('disabled') && word && glossOf(word).toLowerCase().includes((button.textContent ?? '').toLowerCase().slice(0, 10)))
        await user.click(target ?? rightCol().find(button => !button.hasAttribute('disabled'))!)
      }
      await user.click(screen.getByRole('button', { name: 'Next' }))
      continue
    }
    if (form === 'tiles') {
      const cue = document.querySelector('.practice-prompt')?.textContent
      const phrase = lesson.phrases.find(item => item.en === cue)!
      for (const token of phrase.tokens.filter(item => /[\p{L}]/u.test(item.t))) {
        const bank = within(screen.getByRole('group', { name: 'Available tiles' })).getAllByRole('button')
        await user.click(bank.find(button => !button.hasAttribute('disabled') && (button.textContent ?? '').startsWith(token.t))!)
      }
      await user.click(screen.getByRole('button', { name: 'Check answer' }))
      await user.click(screen.getByRole('button', { name: 'Next' }))
      continue
    }
    throw new Error('Unexpected form ' + form)
  }
  return seen
}

describe('Practise a Japanese or Korean lesson', () => {
  it.each<[ParallelLanguage, string, string]>([['ja', 'Japanese', 'ja:w:'], ['ko', 'Korean', 'ko:w:']])('runs %s lesson 1 end to end: meet, recognise, use', async (language, name, prefix) => {
    const user = userEvent.setup()
    window.location.hash = `#lessons/${language}/1`
    render(<App />)
    await user.click(await screen.findByRole('link', { name: /Practise/ }, { timeout: 5000 }))
    await waitFor(() => expect(instruction()).toBe('intro'), { timeout: 5000 })
    expect(screen.getByText('Learn the new word', { exact: false })).toBeInTheDocument()
    const seen = await play(user, language)
    expect(seen).toEqual(expect.arrayContaining(['intro', 'choice', 'match', 'listen-pick', 'tiles']))
    expect(await screen.findByText(/right the first time/)).toBeInTheDocument()
    const known = [...await parallelKnown(language)]
    expect(known.length).toBeGreaterThan(0)
    expect(known.every(ref => ref.startsWith(language + ':'))).toBe(true)
    expect(known.some(ref => ref.startsWith(prefix))).toBe(true)
    expect((await loadWorkspace()).knowledge).toEqual([])
    expect(name.length).toBeGreaterThan(0)
  }, 60_000)

  it('words every instruction per language', async () => {
    const user = userEvent.setup()
    window.location.hash = '#lessons/ja/1/practise'
    render(<App />)
    await waitFor(() => expect(instruction()).toBe('intro'), { timeout: 5000 })
    await user.click(screen.getByRole('button', { name: /Got it/ }))
    await user.click(screen.getByRole('button', { name: /Got it/ }))
    await user.click(screen.getByRole('button', { name: /Got it/ }))
    for (let index = 0; index < 4; index++) await user.click(screen.getByRole('button', { name: /Got it/ }))
    await waitFor(() => expect(instruction()).toBe('choice'))
    expect(screen.getByText('Choose the meaning of the Japanese word')).toBeInTheDocument()
  }, 30_000)
})
