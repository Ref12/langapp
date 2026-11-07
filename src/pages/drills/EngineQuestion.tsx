import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic, PenLine, Type } from 'lucide-react'
import { AnswerButton } from '../../components/AnswerButton'
import { AnnotatedChinese } from '../../components/study/AnnotatedChinese'
import { HearButton } from '../../components/assistant/SnippetActions'
import { HandwritingPad } from '../../components/characters/HandwritingPad'
import { Pinyin } from '../../components/Pinyin'
import { speechCaptureSupported, startSpeechCapture, type SpeechCaptureSession } from '../../core/assistant/speech-capture'
import type { ChoiceExercise, ExerciseAttempt, MatchExercise, TilesExercise } from '../../core/study/contracts'
import { tidyPinyin } from '../../core/drills/items'
import { gradeChinese, gradeMeaning, gradeSimple, type ChineseGrade, type MeaningGrade } from '../../core/session/grade'
import type { AnswerMode, GapItem, ListenItem, SessionExercise, TextItem, TilesItem, ChoiceItem, MatchItem } from '../../core/session/types'
import { ChoiceQuestion, MatchQuestion, TilesQuestion } from '../Study'

export interface QuestionContext {
  readings: Map<string, Set<string>>
  pinyin: boolean
  speak: boolean
  busy: boolean
  /** Han forms the segmenter knows, and the characters handwriting may offer. */
  forms: ReadonlySet<string>
  characters: ReadonlySet<string>
  /** The standing answer mode (Settings), and whether handwriting is offered at all. */
  mode: AnswerMode
  writing: boolean
  chinese: (ref: string) => string
}

/** What a finished question reports: right or wrong, and for a match the items missed. */
export interface Outcome { correct: boolean; missed?: string[] }

const attemptOf = (exercise: SessionExercise, response: string, correct: boolean): ExerciseAttempt => ({ id: exercise.id, sessionId: 'engine', index: 0, refs: exercise.refs.slice(0, 6), response, correct, createdAt: 0 })
const MODE_LABEL: Record<AnswerMode, string> = { type: 'Type', speak: 'Speak', write: 'Handwrite' }

function Flag({ exercise }: { exercise: SessionExercise }) {
  const unknown = 'unknown' in exercise ? exercise.unknown : undefined
  return unknown ? <p className="small notice engine-flag" role="note">New word in this sentence: <strong lang="zh-Hans">{unknown.form}</strong>. You have not learned it yet, so it is flagged.</p> : null
}

/** A multiple-choice exercise from the lesson's ChoiceQuestion (choice, fill the gap and listen and pick all use it). */
function PickQuestion({ exercise, shape, header, ctx, onDone }: { exercise: ChoiceItem | GapItem | ListenItem; shape: ChoiceExercise; header?: React.ReactNode; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const [selected, setSelected] = useState(-1)
  const [result, setResult] = useState<boolean>()
  const attempt = result === undefined ? undefined : attemptOf(exercise, String(selected), result)
  return <>
    <Flag exercise={exercise} />
    {header}
    <ChoiceQuestion exercise={shape} attempt={attempt} submit={() => undefined} next={() => undefined} busy={ctx.busy} readings={ctx.readings} pinyin={ctx.pinyin} speak={ctx.speak} bare onSelect={setSelected} name={exercise.id} />
    {result !== undefined && <div className="notice answer-feedback" role="status"><p>{exercise.explanation}</p></div>}
    <AnswerButton result={result} busy={ctx.busy} ready={selected >= 0} onCheck={() => setResult(selected === shape.answer)} onNext={() => onDone({ correct: result === true })} />
  </>
}

function Tiles({ exercise, ctx, onDone }: { exercise: TilesItem; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const [attempt, setAttempt] = useState<{ grade: ChineseGrade; answer: string[] }>()
  const [counted, setCounted] = useState(false)
  const shape = exercise as unknown as TilesExercise
  const correct = attempt ? attempt.grade.verdict === 'correct' || counted : undefined
  return <>
    <TilesQuestionBridge exercise={shape} attempt={attempt && attemptOf(exercise, JSON.stringify(attempt.answer), correct === true)} ctx={ctx}
      submit={answer => setAttempt({ answer, grade: gradeChinese(answer.join(''), exercise.accepted, ctx.forms) })} next={() => onDone({ correct: correct === true })} />
    {attempt && <div className="notice answer-feedback engine-diff" role="status">
      {attempt.grade.verdict === 'correct' ? <p>{attempt.grade.alternative ? 'Also correct. The model answer: ' : 'Correct: '}<span lang="zh-Hans">{exercise.model}</span></p>
        : <><p>Not the model answer. {attempt.grade.messages.length ? attempt.grade.messages.join('; ') + '.' : ''}</p><p>Closest: <span lang="zh-Hans">{attempt.grade.closest}</span></p>
          <button type="button" className="button secondary small" aria-pressed={counted} onClick={() => setCounted(!counted)}>{counted ? 'Counted as correct' : 'Count it as correct'}</button></>}
      <p className="small muted">{exercise.explanation}</p></div>}
  </>
}

/** The lesson's tiles question with its own Check/Next button, which is the engine's button. */
function TilesQuestionBridge({ exercise, attempt, ctx, submit, next }: { exercise: TilesExercise; attempt?: ExerciseAttempt; ctx: QuestionContext; submit: (answer: string[]) => void; next: () => void }) {
  return <TilesQuestion exercise={exercise} attempt={attempt} submit={response => submit(response as string[])} next={next} busy={ctx.busy} readings={ctx.readings} pinyin={ctx.pinyin} speak={ctx.speak} />
}

function Match({ exercise, ctx, onDone }: { exercise: MatchItem; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const [misses, setMisses] = useState<string[]>()
  const shape = exercise as unknown as MatchExercise
  return <MatchQuestion exercise={shape} attempt={misses && attemptOf(exercise, JSON.stringify(misses), misses.length === 0)} submit={response => setMisses(response as string[])} next={() => onDone({ correct: !misses?.length, missed: misses ?? [] })}
    busy={ctx.busy} readings={ctx.readings} pinyin={ctx.pinyin} speak={ctx.speak} chinese={ctx.chinese} />
}

/** A typed, spoken or handwritten answer: graded locally, a difference is shown and the learner marks it themselves. */
function Text({ exercise, ctx, onDone }: { exercise: TextItem; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const chinese = exercise.answerLang === 'zh'
  const [mode, setMode] = useState<AnswerMode>(chinese || ctx.mode === 'type' ? ctx.mode : 'type')
  const [text, setText] = useState('')
  const [listening, setListening] = useState('')
  const [checked, setChecked] = useState<{ correct: boolean; grade?: ChineseGrade; meaning?: MeaningGrade; self?: boolean }>()
  const [counted, setCounted] = useState(false)
  const capture = useRef<SpeechCaptureSession>()
  useEffect(() => () => capture.current?.cancel(), [])
  const modes = (['type', 'speak', 'write'] as const).filter(value => value !== mode && (value !== 'write' || (ctx.writing && chinese)) && (value !== 'speak' || chinese || exercise.answerLang === 'en'))
  const check = () => {
    if (chinese) { const grade = gradeChinese(text, exercise.accepted, ctx.forms); setChecked({ correct: grade.verdict === 'correct', grade }) }
    else if (exercise.answerLang === 'en') { const meaning = gradeMeaning(text, exercise.accepted); setChecked({ correct: meaning.verdict === 'correct' || meaning.verdict === 'near', meaning, self: meaning.verdict === 'self' }) }
      else setChecked({ correct: gradeSimple(text, exercise.accepted, 'py') === 'correct', self: true })
  }
  const listen = () => {
    capture.current?.cancel(); setListening('Listening…')
    capture.current = startSpeechCapture(next => {
      if (next.phase === 'error') setListening(next.error ?? 'Speech capture failed.')
      else if (next.phase === 'finished') { setListening(''); if (next.transcript) setText(next.transcript) }
    })
  }
  const result = checked ? checked.correct || counted : undefined
  const locked = checked !== undefined
  return <>
    <Flag exercise={exercise} />
    {exercise.prompt && (exercise.promptLang === 'zh' ? <p className="practice-prompt native"><AnnotatedChinese text={exercise.prompt} readings={ctx.readings} pinyin={ctx.pinyin} /></p> : <p className="practice-prompt" lang="en">{exercise.prompt}</p>)}
    {exercise.hearText && <p><HearButton text={exercise.hearText} locale="zh-Hans" label="Hear it" /></p>}
    <label className="engine-answer dr-free"><span className="visually-hidden">Your answer</span>
      <input type="text" value={text} disabled={locked || ctx.busy} lang={chinese ? 'zh-Hans' : exercise.answerLang === 'py' ? undefined : 'en'} autoComplete="off" autoCapitalize="off" spellCheck={false}
        placeholder={chinese ? 'Type the Chinese' : exercise.answerLang === 'py' ? 'Type the pinyin' : 'Type the meaning'} onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && text.trim() && !locked) check() }} /></label>
    {!locked && mode === 'speak' && <div className="button-row">{speechCaptureSupported() ? <button type="button" className="button secondary" onClick={listen}><Mic size={16} /> {listening || 'Start speaking'}</button> : <p className="small muted">Speech recognition is not available in this browser. Type instead.</p>}</div>}
    {!locked && mode === 'write' && <HandwritingPad allowed={ctx.characters} onPick={character => setText(text + character)} onClose={() => setMode('type')} />}
    {checked && <div className={`notice answer-feedback engine-diff${checked.correct ? ' success' : ''}`} role="status">
      {checked.correct ? <p>{checked.meaning?.verdict === 'near' ? checked.meaning.note : <>{checked.grade?.alternative ? 'Also correct. The model answer: ' : 'Correct: '}<span lang={chinese ? 'zh-Hans' : undefined}>{exercise.model}</span></>}</p>
        : <><p>{checked.grade ? (checked.grade.messages.length ? `Differences: ${checked.grade.messages.join('; ')}.` : 'Not the model answer.') : checked.meaning?.verdict === 'wrong' ? (checked.meaning.note ?? 'Not a meaning of this word.') : checked.meaning?.verdict === 'self' ? 'Partly right. Compare with the answer and mark it yourself.' : 'Compare with the answer and mark it yourself.'}</p>
          <p>{chinese ? 'Closest answer: ' : 'Answer: '}<span lang={chinese ? 'zh-Hans' : undefined}>{checked.grade?.closest ?? exercise.model}</span></p></>}
      {checked.grade?.ignored.length ? <p className="small muted">{checked.grade.ignored.join(', ')} left out or added: optional here.</p> : null}
      {exercise.modelPinyin && chinese && <p className="small"><Pinyin text={tidyPinyin(exercise.modelPinyin)} /></p>}
      {!checked.correct && <button type="button" className="button secondary small" aria-pressed={counted} onClick={() => setCounted(!counted)}>{counted ? 'Counted as correct' : 'I was right: count it'}</button>}
      <p className="small muted">{exercise.explanation}</p></div>}
    <AnswerButton result={result} busy={ctx.busy} ready={text.trim().length > 0} onCheck={check} onNext={() => onDone({ correct: result === true })}
      secondary={!locked && modes.length ? <span className="engine-another" role="group" aria-label="Answer another way"><span className="small muted">Answer another way:</span>
        {modes.map(value => <button key={value} type="button" className="button secondary small" onClick={() => setMode(value)}>{value === 'type' ? <Type size={14} /> : value === 'speak' ? <Mic size={14} /> : <PenLine size={14} />} {MODE_LABEL[value]}</button>)}</span> : undefined} />
  </>
}

export function ExerciseQuestion({ exercise, ctx, onDone }: { exercise: Exclude<SessionExercise, { form: 'intro' | 'repeat' }>; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const choiceShape = useMemo((): ChoiceExercise | undefined => {
    if (exercise.form === 'choice') return { id: exercise.id, type: 'choice', targets: exercise.refs, direction: exercise.direction, question: exercise.question, options: exercise.options, answer: exercise.answer, explanation: exercise.explanation }
    if (exercise.form === 'gap') return { id: exercise.id, type: 'choice', targets: exercise.refs, direction: 'en-to-zh', question: exercise.translation, options: exercise.options, answer: exercise.answer, explanation: exercise.explanation }
    if (exercise.form === 'listen-pick') return { id: exercise.id, type: 'choice', targets: exercise.refs, direction: 'zh-to-en', question: '', options: exercise.options, answer: exercise.answer, explanation: exercise.explanation }
    return undefined
  }, [exercise])
  if (choiceShape && (exercise.form === 'choice' || exercise.form === 'gap' || exercise.form === 'listen-pick')) {
    const header = exercise.form === 'gap' ? <p className="practice-prompt native" lang="zh-Hans">{exercise.gapped}</p> : exercise.form === 'listen-pick' ? <p><HearButton text={exercise.hearText} locale="zh-Hans" label="Hear it" /></p> : undefined
    return <PickQuestion exercise={exercise} shape={choiceShape} header={header} ctx={ctx} onDone={onDone} />
  }
  if (exercise.form === 'tiles') return <Tiles exercise={exercise} ctx={ctx} onDone={onDone} />
  if (exercise.form === 'match') return <Match exercise={exercise} ctx={ctx} onDone={onDone} />
  return <Text exercise={exercise as TextItem} ctx={ctx} onDone={onDone} />
}
