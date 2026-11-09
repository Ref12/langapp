import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { loadParallel, resetParallel } from '../core/parallel/data'
import { createRng } from '../core/study/local-exercises'
import { tilesFor } from '../core/parallel/session'
import type { TilesItem } from '../core/session/types'
import { TilesQuestion } from './ParallelQuestions'

afterEach(() => { cleanup(); resetParallel() })

async function checked(language: 'ja' | 'ko', pick: (text: string) => boolean, aids: boolean) {
  const data = await loadParallel(language)
  const phrase = data.lessons.flatMap(lesson => lesson.phrases).find(item => pick(item.text))!
  const built = tilesFor(language, data, phrase, createRng(1))!
  const exercise = { id: 'x', stage: 'use', form: 'tiles', language, round: 0, refs: [], ...built } as TilesItem
  const readings = new Map<string, string>()
  const user = userEvent.setup()
  render(<TilesQuestion exercise={exercise} ctx={{ language, aids, readings, busy: false }} onDone={() => undefined} />)
  // tap the tiles in order, then Check
  for (const token of exercise.tiles) {
    const bank = screen.getByRole('group', { name: 'Available tiles' })
    const button = [...bank.querySelectorAll('button')].find(item => !item.hasAttribute('disabled') && (item.textContent ?? '').startsWith(token))!
    await user.click(button)
  }
  await user.click(screen.getByRole('button', { name: 'Check answer' }))
  return { phrase, answer: document.querySelector('.parallel-answer') as HTMLElement }
}

describe('The answer shown on a Japanese or Korean tiles result', () => {
  it('keeps the spaces of a Korean phrase (shown from its text, not joined tokens)', async () => {
    const { phrase, answer } = await checked('ko', text => text.includes(' '), false)
    expect(phrase.text).toContain(' ')
    expect(answer.textContent).toContain(phrase.text)
  })

  it('puts a Japanese word\'s reading over the whole word', async () => {
    const { answer } = await checked('ja', text => text.includes('学生'), true)
    const rubies = [...answer.querySelectorAll('ruby')].map(item => item.firstChild?.textContent)
    expect(rubies).toContain('学生')
    expect(answer.textContent).toContain('学生')
  })
})
