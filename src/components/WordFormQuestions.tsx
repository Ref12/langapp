import { useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { AnswerButton } from './AnswerButton'
import type { ConjugateResult } from '../core/forms/conjugate'
import type { ConjugateItem, FormPickItem } from '../core/session/types'

// The two word-form questions of Practice, moved from ParallelQuestions.tsx: Conjugate (build the form of a word from tiles) and Which form is this? (pick the word and form of an inflected word).
// A screen gives them what differs: the language tag of the text, how a written form is drawn with its reading, the Hear button and how a built form is marked. The engine's question screen (pages/drills) and the
// older parallel screen (until step 4) both render these; there is no second copy.

export interface WordFormContext {
  /** The language tag of the learned text: "ja", "ko". */
  lang: string
  busy: boolean
  /** A written form with its reading, as the screen draws words. */
  written(text: string, reading?: string): ReactNode
  /** The Hear button for a text, with its label. */
  hear(text: string, label: string): ReactNode
  /** What "almost" means here, as the feedback says it. */
  almost: string
  /** Marks a built form against the form asked for. */
  grade(given: string, answer: { surface: string; reading?: string }): ConjugateResult
}
export interface WordFormDone { correct: boolean }

/** Conjugate: build the form of a known word from tiles (its stem and ending pieces, plus distractor endings). The answer shows the reading, the rule and, for an irregular form, the item. */
export function ConjugateQuestion({ exercise, ctx, onDone }: { exercise: ConjugateItem; ctx: WordFormContext; onDone: (done: WordFormDone) => void }) {
  const all = [...exercise.tiles, ...exercise.distractors]
  const [placed, setPlaced] = useState<number[]>([])
  const [result, setResult] = useState<ConjugateResult>()
  const locked = ctx.busy || result !== undefined
  const ok = result === 'right' || result === 'almost'
  const tile = (index: number) => ctx.written(all[index], exercise.tileReadings[index])
  return <>
    <p className="practice-prompt" data-testid="conjugate-prompt">{ctx.written(exercise.lemma, exercise.lemmaReading)} <span aria-hidden="true">{'\u2192'}</span> <span lang="en">{exercise.label}</span></p>
    <p className="small muted" lang="en">{exercise.gloss}</p>
    <div className="tile-answer" lang={ctx.lang} role="group" aria-label="Your form">
      {placed.length ? placed.map(index => <button key={index} type="button" className={`tile${result ? ok ? ' match-locked' : ' match-wrong' : ''}`} disabled={locked} onClick={() => setPlaced(placed.filter(item => item !== index))}>{tile(index)}</button>)
        : <span className="small muted">Tap the tiles in order to build the form.</span>}</div>
    <div className="tile-bank" lang={ctx.lang} role="group" aria-label="Available tiles">
      {exercise.shuffled.map(index => <button key={index} type="button" className={`tile ${placed.includes(index) ? 'tile-used' : ''}`} disabled={locked || placed.includes(index)} onClick={() => setPlaced([...placed, index])}>{tile(index)}</button>)}</div>
    <AnswerButton result={result === undefined ? undefined : ok} busy={ctx.busy} ready={placed.length >= 1} onCheck={() => setResult(ctx.grade(placed.map(index => all[index]).join(''), { surface: exercise.answer, reading: exercise.answerReading }))} onNext={() => onDone({ correct: ok })} />
    {result && <div className={`notice answer-feedback engine-diff${ok ? ' success' : ''}`} role="status" data-testid="conjugate-result">
      <p>{result === 'right' ? 'Correct.' : result === 'almost' ? ctx.almost : 'Not quite.'}</p>
      <p className="engine-answer-line parallel-answer">{ctx.written(exercise.answer, exercise.answerReading)} {ctx.hear(exercise.answer, 'Hear the answer')}</p>
      <p className="small" data-testid="conjugate-rule">Rule: <span lang={ctx.lang}>{exercise.rule}</span></p>
      {exercise.irregular && <p className="small" data-testid="conjugate-irregular"><span className="tag">irregular</span>{exercise.itemRef ? <> item <span lang={ctx.lang}>{exercise.itemRef}</span></> : null}</p>}</div>}
  </>
}

/** Which form is this?: an inflected word from the lessons; pick its word and form. */
export function FormPickQuestion({ exercise, ctx, onDone }: { exercise: FormPickItem; ctx: WordFormContext; onDone: (done: WordFormDone) => void }) {
  const [selected, setSelected] = useState(-1)
  const [result, setResult] = useState<boolean>()
  return <>
    <p className="practice-prompt native" data-testid="form-pick-prompt">{ctx.written(exercise.surface, exercise.reading)} {ctx.hear(exercise.surface, 'Hear the form')}</p>
    <fieldset className="answer-options" disabled={ctx.busy || result !== undefined}><legend className="visually-hidden">Choose the word and form</legend>
      {exercise.options.map((option, index) => <label key={index} className={`answer-option ${selected === index ? 'selected' : ''} ${result !== undefined && index === exercise.answer ? 'correct-option' : ''}`}>
        <input type="radio" name={exercise.id} checked={selected === index} onChange={() => setSelected(index)} />
        <span>{ctx.written(option.lemma, option.reading)} <span lang="en">{'\u00B7'} {option.label}</span><span className="small muted" lang="en"> {'\u2014'} {option.gloss}</span></span>
        <span className="answer-option-mark">{result !== undefined && index === exercise.answer && <Check size={18} aria-label="Correct answer" />}</span></label>)}
    </fieldset>
    <AnswerButton result={result} busy={ctx.busy} ready={selected >= 0} onCheck={() => setResult(selected === exercise.answer)} onNext={() => onDone({ correct: result === true })} />
    {result !== undefined && <div className="notice answer-feedback" role="status"><p lang="en">{exercise.explanation}</p><p className="small">Rule: <span lang={ctx.lang}>{exercise.rule}</span></p>
      {exercise.phrase && <p className="small"><span lang={ctx.lang}>{exercise.phrase.text}</span> {'\u2014'} {exercise.phrase.en}</p>}</div>}
  </>
}
