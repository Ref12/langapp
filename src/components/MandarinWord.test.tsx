import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { WordState } from '../core/model'
import { applyAnswer } from '../core/progress'
import { getWord } from '../data/mandarin'
import { MandarinWord } from './MandarinWord'

afterEach(cleanup)

const word = getWord('zh:tea')
const state: WordState = {
  wordId: word.id, language: 'zh-Hans', introducedAt: 0, introducedFrom: 'test',
  attempts: 3, independentCorrect: 3, dueAt: 0,
  successfulDays: ['2026-09-14', '2026-09-15', '2026-09-16'], successfulActivities: ['meaning', 'form'],
}

it('shows pronunciation above unfamiliar words without changing their accessible names', () => {
  const { container } = render(<h2><MandarinWord word={word} /></h2>)
  expect(container.querySelector('ruby rt')).toHaveTextContent(word.pinyin)
  expect(screen.getByRole('heading', { name: word.native })).toBeInTheDocument()
  expect(container.querySelector('rt')).toHaveAttribute('data-assistant-exclude')
})

it('waits for both spaced practice and both activities before hiding pinyin', () => {
  const { container, rerender } = render(<MandarinWord word={word} state={{ ...state, successfulDays: state.successfulDays.slice(0, 2) }} />)
  expect(container.querySelector('rt')).toBeInTheDocument()
  rerender(<MandarinWord word={word} state={{ ...state, successfulActivities: ['meaning'] }} />)
  expect(container.querySelector('rt')).toBeInTheDocument()
  rerender(<MandarinWord word={word} state={state} />)
  expect(container.querySelector('rt')).not.toBeInTheDocument()
  rerender(<MandarinWord word={word} state={applyAnswer(state, 'form', false, false, Date.now())} />)
  expect(container.querySelector('rt')).toBeInTheDocument()
})

it('allows exercises and the manual preference to suppress pronunciation hints', () => {
  const { container } = render(<MandarinWord word={word} pinyin={false} />)
  expect(container.querySelector('ruby')).toHaveTextContent(word.native)
  expect(container.querySelector('rt')).not.toBeInTheDocument()
})
