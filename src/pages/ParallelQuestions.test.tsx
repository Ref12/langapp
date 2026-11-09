import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { loadParallel, resetParallel } from '../core/parallel/data'
import { createRng } from '../core/study/local-exercises'
import { tilesFor } from '../core/parallel/session'
import type { TilesItem } from '../core/session/types'
import { ReadingSettingsContext, type ReadingSettings } from '../components/pinyin-context'
import { TilesQuestion } from './ParallelQuestions'

afterEach(() => { cleanup(); resetParallel() })

async function checked(language: 'ja' | 'ko', pick: (text: string) => boolean, settings: ReadingSettings) {
  const data = await loadParallel(language)
  const phrase = data.lessons.flatMap(lesson => lesson.phrases).find(item => pick(item.text))!
  const built = tilesFor(language, data, phrase, createRng(1))!
  const exercise = { id: 'x', stage: 'use', form: 'tiles', language, round: 0, refs: [], ...built } as TilesItem
  const readings = new Map<string, string>()
  const user = userEvent.setup()
  render(<ReadingSettingsContext.Provider value={settings}><TilesQuestion exercise={exercise} ctx={{ language, readings, busy: false }} onDone={() => undefined} /></ReadingSettingsContext.Provider>)
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
    const { phrase, answer } = await checked('ko', text => text.includes(' '), { show: true, japanese: 'romaji' })
    expect(phrase.text).toContain(' ')
    const base = answer.cloneNode(true) as HTMLElement
    base.querySelectorAll('rt').forEach(item => item.remove())
    expect(base.textContent).toContain(phrase.text)
  })

  it('puts a Japanese word\'s romaji in the pinyin slot, a ruby like Chinese', async () => {
    const { answer } = await checked('ja', text => text.includes('学生'), { show: true, japanese: 'romaji' })
    const ruby = [...answer.querySelectorAll('ruby.mandarin-word')].find(item => item.firstChild?.textContent === '学生')!
    expect(ruby.querySelector('rt')?.textContent).toBe('gakusei')
  })

  it('shows the kana reading instead when the format is kana', async () => {
    const { answer } = await checked('ja', text => text.includes('学生'), { show: true, japanese: 'kana' })
    const ruby = [...answer.querySelectorAll('ruby.mandarin-word')].find(item => item.firstChild?.textContent === '学生')!
    expect(ruby.querySelector('rt')?.textContent).toBe('がくせい')
  })

  it('shows Korean Revised Romanization in the same slot', async () => {
    const { answer } = await checked('ko', () => true, { show: true, japanese: 'romaji' })
    expect(answer.querySelectorAll('ruby.mandarin-word rt').length).toBeGreaterThan(0)
  })

  it('shows no reading when the pinyin switch is off', async () => {
    const { answer } = await checked('ja', text => text.includes('学生'), { show: false, japanese: 'romaji' })
    expect(answer.querySelector('rt')).toBeNull()
  })
})
