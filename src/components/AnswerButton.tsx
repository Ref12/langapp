import { createContext, useContext, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, XCircle } from 'lucide-react'

/**
 * The practice run's navigation, shared with every question form's answer row: Back stands beside Check answer. In review (a past
 * question, locked) the row shows Back and Next instead, Next in the colour of the past outcome.
 */
export interface RunNav {
  back: () => void
  /** False while nothing has been answered yet in this sitting (or on the first past question). */
  canBack: boolean
  review?: { outcome: { correct: boolean; hint?: boolean }; next: () => void }
}
export const RunNavContext = createContext<RunNav | undefined>(undefined)

/** The Back button of the bottom row. */
export function BackButton({ nav }: { nav: RunNav }) {
  return <button type="button" className="button secondary answer-back" aria-label="Previous exercise" disabled={!nav.canBack} onClick={nav.back}><ArrowLeft size={16} /> Previous</button>
}

const outcomeClass = (checked: boolean, hint?: boolean, result?: boolean) => checked ? hint ? ' answer-result-hint' : result ? ' answer-result-correct' : ' answer-result-incorrect' : ''

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
  const nav = useContext(RunNavContext)
  if (nav?.review) {
    const past = nav.review.outcome
    return <div className="answer-actions has-back" data-review-nav="true">
      <BackButton nav={nav} />
      <button type="button" className={`button primary check-answer-button${outcomeClass(true, past.hint, past.correct)}`} data-result={past.hint ? 'hint' : past.correct ? 'correct' : 'incorrect'} onClick={nav.review.next}>Next <ArrowRight size={16} /></button>
    </div>
  }
  const checked = result !== undefined
  return <div className={`answer-actions${nav ? ' has-back' : ''}`}>
    {nav && <BackButton nav={nav} />}
    {secondary ?? (nav ? null : <span aria-hidden="true" />)}
    <button type="button" className={`button primary check-answer-button${outcomeClass(checked, hint, result)}`}
      data-result={checked ? hint ? 'hint' : result ? 'correct' : 'incorrect' : undefined}
      aria-description={checked ? hint ? 'Right with a hint. Continue to the next exercise.' : result ? 'Correct answer. Continue to the next exercise.' : 'Incorrect answer. Review the explanation, then continue.' : undefined}
      disabled={busy || (!checked && !ready)} onClick={checked ? onNext : onCheck}>
      {result === false && !hint ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
      {checked ? nextLabel : 'Check answer'}
    </button>
  </div>
}
