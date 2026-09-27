import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AnswerButton } from './AnswerButton'

afterEach(cleanup)

it.each([true, false])('keeps the same button while showing a %s result and changing its action to Next', async result => {
  const user = userEvent.setup(), onCheck = vi.fn(), onNext = vi.fn()
  const props = { busy: false, ready: true, onCheck, onNext }
  const view = render(<AnswerButton {...props} />)
  const button = screen.getByRole('button', { name: 'Check answer' })
  await user.click(button)
  expect(onCheck).toHaveBeenCalledOnce()
  expect(onNext).not.toHaveBeenCalled()
  view.rerender(<AnswerButton {...props} ready={false} result={result} />)
  expect(screen.getByRole('button', { name: 'Next' })).toBe(button)
  expect(button).toHaveAttribute('data-result', result ? 'correct' : 'incorrect')
  expect(button).toHaveClass(result ? 'answer-result-correct' : 'answer-result-incorrect')
  expect(button).toBeEnabled()
  await user.click(button)
  expect(onNext).toHaveBeenCalledOnce()
  expect(onCheck).toHaveBeenCalledOnce()
})

it('disables checking without a response and preserves busy-state locking after grading', () => {
  const props = { onCheck: vi.fn(), onNext: vi.fn() }
  const view = render(<AnswerButton {...props} busy={false} ready={false} />)
  expect(screen.getByRole('button', { name: 'Check answer' })).toBeDisabled()
  view.rerender(<AnswerButton {...props} busy ready result />)
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
})
