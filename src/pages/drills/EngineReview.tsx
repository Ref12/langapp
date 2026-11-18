import { useEffect, useRef } from 'react'
import { ExerciseQuestion, type Outcome, type QuestionContext } from './EngineQuestion'
import { RunNavContext, type RunNav } from '../../components/AnswerButton'
import type { SessionExercise } from '../../core/session/types'

type Question = Exclude<SessionExercise, { form: 'intro' | 'repeat' }>

/** One answered question of this sitting, kept in memory: what was asked, how it went, and where the run stood. The learner's own answer stays in the question that was answered (see QuestionSlot). */
export interface Answered { key: number; exercise: Question; outcome: Outcome; /** Exercises done once this one was answered: the "n" of "Reviewing n of total". */ number: number }

/** How many answered questions of a sitting stay mounted for review; older ones are let go. */
export const REVIEW_LIMIT = 30

const KEEP = '.play-button, .snippet-button, .engine-pinyin, [data-review-nav] button'

/** What would change a mark or result: Check/Next and the answer-another-way row, and the self-mark ("I was right"). Hidden in review (the review row, Back and Next, stays). */
const CHANGES = '.answer-actions:not([data-review-nav]), .link-button[aria-pressed]'

/** Locks everything inside except the play buttons: inputs, tiles and pickers are disabled and the controls that change marks are hidden, so nothing can be answered or recorded again. */
function lock(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(CHANGES).forEach(element => { if (!element.hidden) element.hidden = true })
  root.querySelectorAll<HTMLElement>('input, textarea, select, button').forEach(element => { if (!element.matches(KEEP) && !(element as HTMLInputElement).disabled) (element as HTMLInputElement).disabled = true })
}

/**
 * A question of this sitting. While waiting it is live. Once answered it stays mounted (so it keeps the learner's answer, the right
 * answer and the feedback exactly as they were) but locked and read only; it is shown only while the learner reviews it.
 */
export function QuestionSlot({ exercise, ctx, locked, hidden, nav, onDone }: { exercise: Question; ctx: QuestionContext; locked: boolean; hidden: boolean; nav: RunNav; onDone: (outcome: Outcome) => void }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = root.current
    if (!locked || !node) return
    lock(node)
    const watch = new MutationObserver(() => lock(node))
    watch.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] })
    return () => watch.disconnect()
  }, [locked])
  return <div ref={root} hidden={hidden} className={locked ? 'engine-reviewed' : undefined} data-review={locked ? 'true' : undefined}>
    <RunNavContext.Provider value={nav}><ExerciseQuestion exercise={exercise} ctx={ctx} onDone={outcome => { if (!locked) onDone(outcome) }} /></RunNavContext.Provider>
  </div>
}
