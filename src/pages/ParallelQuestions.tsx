import { useState } from 'react'
import { Check } from 'lucide-react'
import { AnswerButton } from '../components/AnswerButton'
import { ParallelHear } from '../components/ParallelHear'
import { Form } from '../components/ParallelForm'
import { gradeTiles, type TilesGrade } from '../core/parallel/session'
import { gradeConjugate, type ConjugateResult } from '../core/parallel/conjugate'
import type { ParallelLanguage } from '../core/parallel/data'
import type { ChoiceItem, ConjugateItem, FormPickItem, ListenItem, MatchItem, TilesItem } from '../core/session/types'

const NAME: Record<ParallelLanguage, string> = { ja: 'Japanese', ko: 'Korean' }

/** What to do, per language: one line above every question. */
export const PARALLEL_INSTRUCTION = (language: ParallelLanguage): Record<'intro' | 'choice' | 'match' | 'listen-pick' | 'tiles' | 'conjugate' | 'form-pick', string> => ({
  intro: 'Learn the new word',
  choice: `Choose the meaning of the ${NAME[language]} word`,
  match: `Match the ${NAME[language]} words with their meanings`,
  'listen-pick': `Listen to the ${NAME[language]} and pick the meaning`,
  tiles: `Build the sentence in ${NAME[language]}`,
  conjugate: 'Conjugate',
  'form-pick': 'Which form is this?',
})

export interface ParallelContext { language: ParallelLanguage; readings: ReadonlyMap<string, string>; busy: boolean }
export interface Done { correct: boolean; missed?: string[] }

/** A Japanese or Korean form, its reading in the pinyin slot. */
export function Written({ text, ctx }: { text: string; ctx: ParallelContext }) {
  return <Form text={text} reading={ctx.readings.get(text)} language={ctx.language} />
}

/** A whole phrase from its own text (Korean keeps its word spaces): each word carries its reading in the pinyin slot, other characters stay as written. */
export function PhraseText({ text, tiles, ctx }: { text: string; tiles: { text: string; reading?: string }[]; ctx: ParallelContext }) {
  if (ctx.language === 'ko') return <span lang="ko">{text.split(' ').map((part, index) => <span key={index}>{index > 0 && ' '}<Form text={part} language="ko" /></span>)}</span>
  const out: React.ReactNode[] = []
  let at = 0
  for (const tile of tiles) {
    const found = text.indexOf(tile.text, at)
    if (found < 0) continue
    if (found > at) out.push(text.slice(at, found))
    out.push(<Form key={out.length} text={tile.text} reading={tile.reading} language="ja" />)
    at = found + tile.text.length
  }
  if (at < text.length) out.push(text.slice(at))
  return <span lang="ja">{out}</span>
}

export function ChoiceQuestion({ exercise, ctx, onDone }: { exercise: ChoiceItem; ctx: ParallelContext; onDone: (done: Done) => void }) {
  const [selected, setSelected] = useState(-1)
  const [result, setResult] = useState<boolean>()
  return <>
    <p className="practice-prompt native"><Written text={exercise.question} ctx={ctx} /> <ParallelHear text={exercise.question} language={ctx.language} label="Hear the word" /></p>
    <fieldset className="answer-options" disabled={ctx.busy || result !== undefined}><legend className="visually-hidden">Choose an answer</legend>
      {exercise.options.map((option, index) => <label key={index} className={`answer-option ${selected === index ? 'selected' : ''} ${result !== undefined && index === exercise.answer ? 'correct-option' : ''}`}>
        <input type="radio" name={exercise.id} checked={selected === index} onChange={() => setSelected(index)} /><span lang="en">{option}</span>
        <span className="answer-option-mark">{result !== undefined && index === exercise.answer && <Check size={18} aria-label="Correct answer" />}</span></label>)}
    </fieldset>
    <AnswerButton result={result} busy={ctx.busy} ready={selected >= 0} onCheck={() => setResult(selected === exercise.answer)} onNext={() => onDone({ correct: result === true })} />
    {result !== undefined && <div className="notice answer-feedback" role="status"><p>{exercise.explanation}</p></div>}
  </>
}

export function ListenQuestion({ exercise, ctx, onDone }: { exercise: ListenItem; ctx: ParallelContext; onDone: (done: Done) => void }) {
  const [selected, setSelected] = useState(-1)
  const [result, setResult] = useState<boolean>()
  return <>
    <p className="practice-prompt"><ParallelHear text={exercise.hearText} language={ctx.language} label="Hear it" /> <span className="small muted">Tap to hear the phrase</span></p>
    <fieldset className="answer-options" disabled={ctx.busy || result !== undefined}><legend className="visually-hidden">Choose an answer</legend>
      {exercise.options.map((option, index) => <label key={index} className={`answer-option ${selected === index ? 'selected' : ''} ${result !== undefined && index === exercise.answer ? 'correct-option' : ''}`}>
        <input type="radio" name={exercise.id} checked={selected === index} onChange={() => setSelected(index)} /><span lang="en">{option}</span>
        <span className="answer-option-mark">{result !== undefined && index === exercise.answer && <Check size={18} aria-label="Correct answer" />}</span></label>)}
    </fieldset>
    <AnswerButton result={result} busy={ctx.busy} ready={selected >= 0} onCheck={() => setResult(selected === exercise.answer)} onNext={() => onDone({ correct: result === true })} />
    {result !== undefined && <div className="notice answer-feedback" role="status"><p lang={ctx.language}>{exercise.explanation}</p></div>}
  </>
}

export function MatchQuestion({ exercise, ctx, onDone }: { exercise: MatchItem; ctx: ParallelContext; onDone: (done: Done) => void }) {
  const [locked, setLocked] = useState<string[]>([])
  const [selected, setSelected] = useState<{ ref: string; side: 'left' | 'right' }>()
  const [wrong, setWrong] = useState(false)
  const [misses, setMisses] = useState<string[]>([])
  const finished = locked.length === exercise.pairs.length
  const tap = (ref: string, side: 'left' | 'right') => {
    if (ctx.busy || finished || locked.includes(ref)) return
    setWrong(false)
    if (!selected || selected.side === side) { setSelected({ ref, side }); return }
    if (selected.ref === ref) { setLocked([...locked, ref]); setSelected(undefined); return }
    setMisses([...misses, selected.ref]); setWrong(true); setSelected(undefined)
  }
  const cell = (ref: string, side: 'left' | 'right', text: string) => <button key={ref + side} type="button" className={`tile match-cell ${locked.includes(ref) ? 'match-locked' : selected?.ref === ref && selected.side === side ? 'match-selected' : ''}`}
    aria-pressed={selected?.ref === ref && selected.side === side} disabled={ctx.busy || finished || locked.includes(ref)} lang={side === 'left' ? ctx.language : 'en'} onClick={() => tap(ref, side)}>
    {side === 'left' ? <Written text={text} ctx={ctx} /> : <span className="match-gloss">{text}</span>}{locked.includes(ref) && <Check className="match-check" size={16} aria-label="Matched" />}</button>
  return <>
    <div className="match-board" role="group" aria-label="Pairs to match">
      <div className="match-column" role="group" aria-label="First column">{exercise.pairs.map(pair => cell(pair.ref, 'left', pair.left))}</div>
      <div className="match-column" role="group" aria-label="Second column">{exercise.order.map(index => cell(exercise.pairs[index].ref, 'right', exercise.pairs[index].right))}</div></div>
    {wrong && <p className="small muted match-hint" role="status">Not a pair. Try again.</p>}
    <AnswerButton result={finished ? misses.length === 0 : undefined} busy={ctx.busy} ready={false} onCheck={() => undefined} onNext={() => onDone({ correct: misses.length === 0, missed: [...new Set(misses)] })} />
  </>
}

export function TilesQuestion({ exercise, ctx, onDone }: { exercise: TilesItem; ctx: ParallelContext; onDone: (done: Done) => void }) {
  const all = [...exercise.tiles, ...exercise.distractors]
  const [placed, setPlaced] = useState<number[]>([])
  const [grade, setGrade] = useState<TilesGrade>()
  const extra = exercise.parallel!
  const locked = ctx.busy || grade !== undefined
  const tile = (index: number) => <Written text={all[index]} ctx={ctx} />
  const wrongAt = new Set(grade?.wrong.map(item => item.position))
  return <>
    <p className="practice-prompt" lang="en">{exercise.translation}</p>
    <div className="tile-answer" lang={ctx.language} role="group" aria-label="Your sentence">
      {placed.length ? placed.map((index, position) => <button key={index} type="button" className={`tile${grade ? wrongAt.has(position) ? ' match-wrong' : ' match-locked' : ''}`} disabled={locked} onClick={() => setPlaced(placed.filter(item => item !== index))}>{tile(index)}</button>)
        : <span className="small muted">Tap the tiles in order to build the sentence.</span>}</div>
    <div className="tile-bank" lang={ctx.language} role="group" aria-label="Available tiles">
      {exercise.shuffled.map(index => <button key={index} type="button" className={`tile ${placed.includes(index) ? 'tile-used' : ''}`} disabled={locked || placed.includes(index)} onClick={() => setPlaced([...placed, index])}>{tile(index)}</button>)}</div>
    <AnswerButton result={grade?.correct} busy={ctx.busy} ready={placed.length >= 2} onCheck={() => setGrade(gradeTiles(ctx.language, placed.map(index => all[index]), [exercise.tiles]))} onNext={() => onDone({ correct: grade?.correct === true })} />
    {grade && <div className={`notice answer-feedback engine-diff${grade.correct ? ' success' : ''}`} role="status">
      <p>{grade.correct ? 'Correct.' : 'Not the model answer.'}{grade.messages.length > 0 && <> {grade.messages.join(' ')}</>}</p>
      <p className="engine-answer-line parallel-answer"><PhraseText text={extra.text} tiles={extra.tiles} ctx={ctx} /> <ParallelHear text={extra.text} language={ctx.language} label="Hear the answer" /></p>
      <p className="small">{exercise.translation}</p>
      {extra.zh && <p className="zh-original"><span lang="zh-Hans">{'\u4E2D'}</span> <span lang="zh-Hans">{extra.zh}</span></p>}
      {extra.tiles.filter(item => item.particle).length > 0 && !grade.correct && <ul className="small muted">{extra.tiles.filter(item => item.particle).map(item => <li key={item.text}><span lang={ctx.language}>{item.text}</span> {item.particle}</li>)}</ul>}</div>}
  </>
}

/** Conjugate: build the form of a known word from tiles (its stem and ending pieces, plus distractor endings). Graded exactly against forms(); the answer shows the reading, the rule and, for an irregular form, the item. */
export function ConjugateQuestion({ exercise, ctx, onDone }: { exercise: ConjugateItem; ctx: ParallelContext; onDone: (done: Done) => void }) {
  const all = [...exercise.tiles, ...exercise.distractors]
  const [placed, setPlaced] = useState<number[]>([])
  const [result, setResult] = useState<ConjugateResult>()
  const locked = ctx.busy || result !== undefined
  const ok = result === 'right' || result === 'almost'
  const tile = (index: number) => <Form text={all[index]} reading={exercise.tileReadings[index]} language={ctx.language} />
  return <>
    <p className="practice-prompt" data-testid="conjugate-prompt"><Form text={exercise.lemma} reading={exercise.lemmaReading} language={ctx.language} /> <span aria-hidden="true">{'\u2192'}</span> <span lang="en">{exercise.label}</span></p>
    <p className="small muted" lang="en">{exercise.gloss}</p>
    <div className="tile-answer" lang={ctx.language} role="group" aria-label="Your form">
      {placed.length ? placed.map(index => <button key={index} type="button" className={`tile${result ? ok ? ' match-locked' : ' match-wrong' : ''}`} disabled={locked} onClick={() => setPlaced(placed.filter(item => item !== index))}>{tile(index)}</button>)
        : <span className="small muted">Tap the tiles in order to build the form.</span>}</div>
    <div className="tile-bank" lang={ctx.language} role="group" aria-label="Available tiles">
      {exercise.shuffled.map(index => <button key={index} type="button" className={`tile ${placed.includes(index) ? 'tile-used' : ''}`} disabled={locked || placed.includes(index)} onClick={() => setPlaced([...placed, index])}>{tile(index)}</button>)}</div>
    <AnswerButton result={result === undefined ? undefined : ok} busy={ctx.busy} ready={placed.length >= 1} onCheck={() => setResult(gradeConjugate(ctx.language, placed.map(index => all[index]).join(''), { surface: exercise.answer, reading: exercise.answerReading }))} onNext={() => onDone({ correct: ok })} />
    {result && <div className={`notice answer-feedback engine-diff${ok ? ' success' : ''}`} role="status" data-testid="conjugate-result">
      <p>{result === 'right' ? 'Correct.' : result === 'almost' ? 'Almost: the letters are right, mind the spacing.' : 'Not quite.'}</p>
      <p className="engine-answer-line parallel-answer"><Form text={exercise.answer} reading={exercise.answerReading} language={ctx.language} /> <ParallelHear text={exercise.answer} language={ctx.language} label="Hear the answer" /></p>
      <p className="small" data-testid="conjugate-rule">Rule: <span lang={ctx.language}>{exercise.rule}</span></p>
      {exercise.irregular && <p className="small" data-testid="conjugate-irregular"><span className="tag">irregular</span>{exercise.itemRef ? <> item <span lang={ctx.language}>{exercise.itemRef}</span></> : null}</p>}</div>}
  </>
}

/** Form to meaning: an inflected form from the lessons; pick its word and form. */
export function FormPickQuestion({ exercise, ctx, onDone }: { exercise: FormPickItem; ctx: ParallelContext; onDone: (done: Done) => void }) {
  const [selected, setSelected] = useState(-1)
  const [result, setResult] = useState<boolean>()
  return <>
    <p className="practice-prompt native" data-testid="form-pick-prompt"><Form text={exercise.surface} reading={exercise.reading} language={ctx.language} /> <ParallelHear text={exercise.surface} language={ctx.language} label="Hear the form" /></p>
    <fieldset className="answer-options" disabled={ctx.busy || result !== undefined}><legend className="visually-hidden">Choose the word and form</legend>
      {exercise.options.map((option, index) => <label key={index} className={`answer-option ${selected === index ? 'selected' : ''} ${result !== undefined && index === exercise.answer ? 'correct-option' : ''}`}>
        <input type="radio" name={exercise.id} checked={selected === index} onChange={() => setSelected(index)} />
        <span><Form text={option.lemma} reading={option.reading} language={ctx.language} /> <span lang="en">{'\u00B7'} {option.label}</span><span className="small muted" lang="en"> {'\u2014'} {option.gloss}</span></span>
        <span className="answer-option-mark">{result !== undefined && index === exercise.answer && <Check size={18} aria-label="Correct answer" />}</span></label>)}
    </fieldset>
    <AnswerButton result={result} busy={ctx.busy} ready={selected >= 0} onCheck={() => setResult(selected === exercise.answer)} onNext={() => onDone({ correct: result === true })} />
    {result !== undefined && <div className="notice answer-feedback" role="status"><p lang="en">{exercise.explanation}</p><p className="small">Rule: <span lang={ctx.language}>{exercise.rule}</span></p>
      {exercise.phrase && <p className="small"><span lang={ctx.language}>{exercise.phrase.text}</span> {'\u2014'} {exercise.phrase.en}</p>}</div>}
  </>
}
