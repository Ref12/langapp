import type { ReactNode } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

export function AnswerButton({ result, busy, ready, onCheck, onNext, secondary }: {
  result?: boolean
  busy: boolean
  ready: boolean
  onCheck: () => void
  onNext: () => void
  secondary?: ReactNode
}) {
  const checked = result !== undefined
  return <div className="answer-actions">
    {secondary ?? <span aria-hidden="true" />}
    <button type="button" className={`button primary check-answer-button${checked ? result ? ' answer-result-correct' : ' answer-result-incorrect' : ''}`}
      data-result={checked ? result ? 'correct' : 'incorrect' : undefined}
      aria-description={checked ? result ? 'Correct answer. Continue to the next exercise.' : 'Incorrect answer. Review the explanation, then continue.' : undefined}
      disabled={busy || (!checked && !ready)} onClick={checked ? onNext : onCheck}>
      {result === false ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
      {checked ? 'Next' : 'Check answer'}
    </button>
  </div>
}
