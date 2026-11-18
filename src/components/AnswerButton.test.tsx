import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AnswerButton, RunNavContext } from './AnswerButton'

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

it('stands Previous beside Check answer when a run provides navigation, disabled without history', async () => {
  const user = userEvent.setup(), back = vi.fn()
  const props = { busy: false, ready: true, onCheck: vi.fn(), onNext: vi.fn() }
  const view = render(<RunNavContext.Provider value={{ back, canBack: false }}><AnswerButton {...props} /></RunNavContext.Provider>)
  const row = screen.getByRole('button', { name: 'Check answer' }).closest('.answer-actions') as HTMLElement
  expect(within(row).getByRole('button', { name: 'Previous exercise' })).toBeDisabled()
  expect(row.firstElementChild).toBe(within(row).getByRole('button', { name: 'Previous exercise' }))
  view.rerender(<RunNavContext.Provider value={{ back, canBack: true }}><AnswerButton {...props} /></RunNavContext.Provider>)
  await user.click(screen.getByRole('button', { name: 'Previous exercise' }))
  expect(back).toHaveBeenCalledOnce()
})

it.each([[{ correct: true }, 'answer-result-correct'], [{ correct: false }, 'answer-result-incorrect'], [{ correct: true, hint: true }, 'answer-result-hint']])('in review shows Back and a Next that carries the past outcome %j', async (outcome, className) => {
  const user = userEvent.setup(), next = vi.fn()
  render(<RunNavContext.Provider value={{ back: vi.fn(), canBack: true, review: { outcome, next } }}><AnswerButton busy={false} ready={false} onCheck={vi.fn()} onNext={vi.fn()} /></RunNavContext.Provider>)
  const button = screen.getByRole('button', { name: /^Next/ })
  expect(button).toHaveClass(className)
  await user.click(button)
  expect(next).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: /Check answer/ })).toBeNull()
})
