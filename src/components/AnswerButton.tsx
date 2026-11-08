import type { ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

export function AnswerButton({ result, hint, busy, ready, onCheck, onNext, secondary, nextLabel = 'Next' }: {
  result?: boolean
  /** Right with help (Needed a hint): one amber colour wherever it happens, neither the green of right nor the red of wrong. */
  hint?: boolean
  busy: boolean
  ready: boolean
  onCheck: () => void
  onNext: () => void
  secondary?: ReactNode
  /** What the button says once checked (Finish on the last question of a run). */
  nextLabel?: string
}) {
  const checked = result !== undefined
  return <div className="answer-actions">
    {secondary ?? <span aria-hidden="true" />}
    <button type="button" className={`button primary check-answer-button${checked ? hint ? ' answer-result-hint' : result ? ' answer-result-correct' : ' answer-result-incorrect' : ''}`}
      data-result={checked ? hint ? 'hint' : result ? 'correct' : 'incorrect' : undefined}
      aria-description={checked ? hint ? 'Right with a hint. Continue to the next exercise.' : result ? 'Correct answer. Continue to the next exercise.' : 'Incorrect answer. Review the explanation, then continue.' : undefined}
      disabled={busy || (!checked && !ready)} onClick={checked ? onNext : onCheck}>
      {result === false && !hint ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
      {checked ? nextLabel : 'Check answer'}
    </button>
  </div>
}
