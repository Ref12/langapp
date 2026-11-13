import { useEffect, useMemo, useRef, useState } from 'react'
import { getPack } from '../../core/language'
import { joinNotes } from '../../core/language/note-text'
import { zhPractice } from '../../core/language/practice-wording'
import { Mic, PenLine, Type } from 'lucide-react'
import { AnswerButton } from '../../components/AnswerButton'
import { AnnotatedChinese } from '../../components/study/AnnotatedChinese'
import { HearButton } from '../../components/assistant/SnippetActions'
import { HandwritingPad } from '../../components/characters/HandwritingPad'
import { Pinyin } from '../../components/Pinyin'
import { speechCaptureSupported, startSpeechCapture, type SpeechCaptureSession } from '../../core/assistant/speech-capture'
import type { ChoiceExercise, ExerciseAttempt, MatchExercise, TilesExercise } from '../../core/study/contracts'
import { tidyPinyin } from '../../core/drills/items'
import { gradeSentenceMeaning, type ChineseGrade, type MeaningGrade } from '../../core/session/grade'
import type { ReadingGrade } from '../../core/language/reading-input'
import { ModelReading, ReadingText } from '../../components/display-context'
import type { AnswerMode, ConjugateItem, Form, FormPickItem, GapItem, ListenItem, SessionExercise, TextItem, TilesItem, ChoiceItem, MatchItem } from '../../core/session/types'
import { ChoiceQuestion, MatchQuestion, TilesQuestion } from '../Study'
import { ConversationQuestion, ExchangePick, WhichCorrect } from './DatasetQuestions'
import { ConjugateQuestion, FormPickQuestion, type WordFormContext } from '../../components/WordFormQuestions'
import { useShowsReading } from '../../components/display-settings'
import { SentenceAudio } from './SentenceAudio'
import { ToneHold, ToneText } from '../../components/ToneText'
import { WhichTones } from './WhichTones'

export interface QuestionContext {
  readings: Map<string, Set<string>>
  pinyin: boolean
  speak: boolean
  /** The learner's prompt auto-play preference: the whole sentence plays by itself when an answer is revealed. */
  autoPlay?: boolean
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
export interface Outcome { correct: boolean; missed?: string[]; /** Right with help: the tones were off. Counts as Needed a hint: it is not a first-try right, but never a miss to self-mark. */ hint?: boolean }

/** What to do, in action words: one line between the stage header and the prompt, for every form. */
export const INSTRUCTION: Record<Form, string> = zhPractice.instructions
export function Instruction({ form }: { form: Form }) { return <p className="engine-instruction small" data-instruction={form}>{getPack().practiceWording.instructions[form]}</p> }

const attemptOf = (exercise: SessionExercise, response: string, correct: boolean): ExerciseAttempt => ({ id: exercise.id, sessionId: 'engine', index: 0, refs: exercise.refs.slice(0, 6), response, correct, createdAt: 0 })
const MODE_LABEL: Record<AnswerMode, string> = { type: 'Type', speak: 'Speak', write: 'Handwrite' }

function Flag({ exercise }: { exercise: SessionExercise }) {
  const unknown = 'unknown' in exercise ? exercise.unknown : undefined
  return unknown ? <p className="small notice engine-flag" role="note">New word in this sentence: <strong lang={getPack().learningTag}>{unknown.form}</strong>. You have not learned it yet, so it is flagged.</p> : null
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
    <AnswerButton result={result} busy={ctx.busy} ready={selected >= 0} onCheck={() => setResult(selected === shape.answer)} onNext={() => onDone({ correct: result === true })} />
    {result !== undefined && <div className="notice answer-feedback" role="status"><p>{exercise.explanation}</p>{(exercise.form === 'gap' || exercise.form === 'listen-pick') && <SentenceAudio text={exercise.form === 'gap' ? exercise.sentence : exercise.hearText} autoPlay={ctx.autoPlay} />}</div>}
  </>
}

function Tiles({ exercise, ctx, onDone }: { exercise: TilesItem; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const [attempt, setAttempt] = useState<{ grade: ChineseGrade; answer: string[] }>()
  const shape = exercise as unknown as TilesExercise
  // The tiles are a fixed set and the grade is exact: there is no "I was right" override here.
  const correct = attempt ? attempt.grade.verdict === 'correct' : undefined
  const grade = attempt?.grade
  const swapped = grade?.differences.length === 1 && grade.differences[0].kind === 'swapped' ? grade.differences[0] as { a: string; b: string } : undefined
  return <>
    <TilesQuestionBridge exercise={shape} attempt={attempt && attemptOf(exercise, JSON.stringify(attempt.answer), correct === true)} ctx={ctx}
      submit={answer => setAttempt({ answer, grade: getPack().gradeSentence({ text: answer.join(''), placed: answer, accepted: exercise.accepted, spelled: exercise.spelled, forms: ctx.forms, optional: exercise.optional, english: exercise.translation }) })} next={() => onDone({ correct: correct === true })} />
    {grade && <div className={`notice answer-feedback engine-diff${correct ? ' success' : ''}`} role="status">
      {correct ? (grade.alternative ? <p>Also correct. The model answer:</p> : null) : <p>{swapped ? `Word order: ${swapped.a} comes before ${swapped.b}.` : `Not the model answer.${grade.messages.length ? ' ' + joinNotes(grade.messages) : ''}`}</p>}
      <p className="engine-answer-line"><span lang={getPack().learningTag}>{exercise.model}</span>{ctx.pinyin && exercise.modelPinyin ? <ModelReading text={tidyPinyin(exercise.modelPinyin)} /> : null}</p>
      <SentenceAudio text={exercise.model} autoPlay={ctx.autoPlay} /></div>}
  </>
}

/** The lesson's tiles question with its own Check/Next button, which is the engine's button. */
function TilesQuestionBridge({ exercise, attempt, ctx, submit, next }: { exercise: TilesExercise; attempt?: ExerciseAttempt; ctx: QuestionContext; submit: (answer: string[]) => void; next: () => void }) {
  return <TilesQuestion exercise={exercise} attempt={attempt} submit={response => submit(response as string[])} next={next} busy={ctx.busy} readings={ctx.readings} pinyin={ctx.pinyin} speak={ctx.speak} />
}

function Match({ exercise, ctx, onDone }: { exercise: MatchItem; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const [misses, setMisses] = useState<string[]>()
  const shape = exercise as unknown as MatchExercise
  return <>
    <MatchQuestion exercise={shape} attempt={misses && attemptOf(exercise, JSON.stringify(misses), misses.length === 0)} submit={response => setMisses(response as string[])} next={() => onDone({ correct: !misses?.length, missed: misses ?? [] })}
    busy={ctx.busy} readings={ctx.readings} pinyin={ctx.pinyin} speak={ctx.speak} chinese={ctx.chinese} bare />
    <AnswerButton result={misses ? misses.length === 0 : undefined} busy={ctx.busy} ready={false} onCheck={() => undefined} onNext={() => onDone({ correct: !misses?.length, missed: misses ?? [] })} />
  </>
}

/** A typed, spoken or handwritten answer: graded locally, a difference is shown and the learner marks it themselves. */
function Text({ exercise, ctx, onDone }: { exercise: TextItem; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const chinese = exercise.answerLang === 'zh'
  const [mode, setMode] = useState<AnswerMode>(chinese || ctx.mode === 'type' ? ctx.mode : 'type')
  const pack = getPack()
  const reading = pack.readingInput
  const [text, setText] = useState('')
  const [listening, setListening] = useState('')
  const [checked, setChecked] = useState<{ correct: boolean; grade?: ChineseGrade; meaning?: MeaningGrade; self?: boolean; pinyin?: ReadingGrade }>()
  const [counted, setCounted] = useState(false)
  const [meaning, setMeaning] = useState(false)
  const capture = useRef<SpeechCaptureSession>()
  useEffect(() => () => capture.current?.cancel(), [])
  const modes = (['type', 'speak', 'write'] as const).filter(value => value !== mode && (value !== 'write' || (ctx.writing && chinese)) && (value !== 'speak' || chinese || exercise.answerLang === 'en'))
  const check = () => {
    if (chinese) { const grade = pack.gradeSentence({ text, accepted: exercise.accepted, spelled: exercise.spelled, forms: ctx.forms, optional: exercise.optional, english: exercise.replyEn ?? (exercise.promptLang === 'en' ? exercise.prompt : '') }); setChecked({ correct: grade.verdict === 'correct', grade }) }
    else if (exercise.answerLang === 'en') { const meaning = gradeSentenceMeaning(text, exercise.accepted, !!exercise.phrase && !!pack.subjectOpen?.(exercise.phrase.zh), !!pack.englishNumberFree); setChecked({ correct: meaning.verdict === 'correct' || meaning.verdict === 'near', meaning, self: meaning.verdict === 'self' }) }
      else { const pinyin = pack.readingInput.grade(text, exercise.accepted, pack.romaji); setChecked({ correct: pinyin.verdict === 'correct' || pinyin.verdict === 'tones', self: pinyin.verdict === 'self', pinyin }) }
  }
  const listen = () => {
    capture.current?.cancel(); setListening('Listening…')
    capture.current = startSpeechCapture(next => {
      if (next.phase === 'error') setListening(next.error ?? 'Speech capture failed.')
      else if (next.phase === 'finished') { setListening(''); if (next.transcript) setText(next.transcript) }
    }, { locale: exercise.answerLang === 'en' && pack.writing.speechLocale !== 'zh-Hans' ? 'en-US' : pack.writing.speechLocale })
  }
  const result = checked ? checked.correct || counted : undefined
  const locked = checked !== undefined
  const pinyinMode = exercise.answerLang === 'py'
  // A pack whose typed reading is what the audio says keeps the Hear button back until the answer is checked.
  // Only a form whose answer is a whole sentence gets Play sentence: the model answer, or the Chinese prompt when the answer is its meaning.
  const sentence = exercise.form === 'translate-zh-en' ? (exercise.hearText ?? (exercise.promptLang === 'zh' ? exercise.prompt : undefined)) : exercise.form === 'translate-en-zh' || exercise.form === 'dictation' || exercise.form === 'exchange-reply' ? exercise.model : undefined
  const hearNow = !(pinyinMode && reading.audioIsAnswer) || locked
  return <ToneHold when={pinyinMode && !locked}>
    <Flag exercise={exercise} />
    {exercise.prompt && (exercise.promptLang === 'zh' ? <p className="practice-prompt native"><AnnotatedChinese text={exercise.prompt} readings={ctx.readings} pinyin={ctx.pinyin && (exercise.answerLang !== 'py' || locked)} /></p> : <p className="practice-prompt" lang="en">{exercise.prompt}</p>)}
    {exercise.form === 'exchange-reply' && exercise.replyEn && <p className="engine-cue" lang="en">Reply: “{exercise.replyEn}”</p>}
    {exercise.form === 'exchange-reply' && exercise.questionEn && <p className="small engine-meaning"><button type="button" className="link-button" aria-expanded={meaning} onClick={() => setMeaning(!meaning)}>{meaning ? 'Hide meaning' : 'Show meaning'}</button>{meaning && <span lang="en"> “{exercise.questionEn}”</span>}</p>}
    {exercise.hearText && hearNow && <p><HearButton text={exercise.hearText} locale={getPack().speechLocale} kind={exercise.form === 'recall' || exercise.form === 'pinyin' ? 'word' : 'sentence'} reading={exercise.form === 'recall' || exercise.form === 'pinyin' ? exercise.modelPinyin : undefined} label="Hear it" /></p>}
    <label className="engine-answer dr-free"><span className="visually-hidden">Your answer</span>
      <input type="text" value={text} disabled={locked || ctx.busy} lang={chinese ? getPack().learningTag : exercise.answerLang === 'py' ? (reading.takesLearningScript ? pack.learningTag : undefined) : 'en'} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" aria-describedby={pinyinMode ? 'pinyin-hint' : undefined}
        placeholder={chinese ? exercise.form === 'exchange-reply' ? getPack().practiceWording.replyNative : getPack().practiceWording.typeNative : exercise.answerLang === 'py' ? getPack().practiceWording.readingPlaceholder : 'Type the meaning'} onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && text.trim() && !locked) check() }} /></label>
    {pinyinMode && <p id="pinyin-hint" className="small muted engine-pinyin-hint">{getPack().practiceWording.readingHelp}</p>}
    {pinyinMode && reading.preview && <p className="engine-pinyin-preview" aria-live="polite" aria-label="Preview" style={locked ? { visibility: 'hidden' } : undefined} aria-hidden={locked}>{reading.preview(text, exercise.accepted) || '\u00a0'}</p>}
    {mode === 'speak' && <div className="button-row" style={locked ? { visibility: 'hidden' } : undefined} aria-hidden={locked}>{speechCaptureSupported() ? <button type="button" className="button secondary" onClick={listen}><Mic size={16} /> {listening || 'Start speaking'}</button> : <p className="small muted">Speech recognition is not available in this browser. Type instead.</p>}</div>}
    {mode === 'write' && <div style={locked ? { visibility: 'hidden' } : undefined} aria-hidden={locked}><HandwritingPad allowed={ctx.characters} onPick={character => setText(text + character)} onClose={() => setMode('type')} /></div>}
    <AnswerButton result={result} hint={checked?.pinyin?.verdict === 'tones'} busy={ctx.busy} ready={text.trim().length > 0} onCheck={check} onNext={() => onDone({ correct: result === true, ...(checked?.pinyin?.verdict === 'tones' ? { hint: true } : {}) })}
      secondary={modes.length ? <span className="engine-another" style={locked ? { visibility: 'hidden' } : undefined} aria-hidden={locked} role="group" aria-label="Answer another way"><span className="small muted">Answer another way:</span>
        {modes.map(value => <button key={value} type="button" className="button secondary small" onClick={() => setMode(value)}>{value === 'type' ? <Type size={14} /> : value === 'speak' ? <Mic size={14} /> : <PenLine size={14} />} {MODE_LABEL[value]}</button>)}</span> : undefined} />
    {checked && <div className={`notice answer-feedback engine-diff${checked.correct ? ' success' : ''}`} role="status">
      {checked.pinyin?.verdict === 'tones' ? <p>{reading.nearNote} {checked.pinyin.syllables ? checked.pinyin.syllables.map((entry, index) => <span key={index}>{index > 0 && ' '}{entry.off ? <strong className="engine-tone-off" aria-label={`${entry.marked}, tone to fix`}>{entry.marked}</strong> : entry.marked}</span>) : <ReadingText kana={checked.pinyin.kana ?? exercise.model} />} <span className="small muted">Counted as Needed a hint.</span></p>
      : checked.correct ? <p>{checked.meaning?.verdict === 'near' ? checked.meaning.note : checked.grade?.note ? <>{checked.grade.note}{checked.grade.written ? <> <span lang={getPack().learningTag}>{checked.grade.written}</span></> : null}</> : <>{checked.grade?.alternative ? 'Also correct. The model answer: ' : 'Correct: '}{pinyinMode && reading.marks ? <ReadingText kana={exercise.model} /> : <span lang={chinese ? getPack().learningTag : undefined}>{exercise.model}</span>}</>}</p>
      : checked.pinyin?.verdict === 'wrong' ? <><p>Not the reading.</p><p>{pack.practiceWording.readingIs} <strong><ReadingText kana={checked.pinyin.kana ?? exercise.model} /></strong>.</p></>
        : <><p>{checked.grade ? (checked.grade.messages.length ? (checked.grade.differences.length === 1 && checked.grade.differences[0].kind === 'swapped' ? `Word order: ${(checked.grade.differences[0] as { a: string; b: string }).a} comes before ${(checked.grade.differences[0] as { a: string; b: string }).b}.` : `Differences: ${joinNotes(checked.grade.messages)}`) : 'Not the model answer.') : checked.meaning?.verdict === 'wrong' ? (checked.meaning.note ?? 'Not a meaning of this word.') : checked.meaning?.verdict === 'self' ? 'Partly right. Compare with the answer and mark it yourself.' : 'Compare with the answer and mark it yourself.'}</p>
          <p>{chinese ? 'Closest answer: ' : 'Answer: '}<span lang={chinese ? getPack().learningTag : undefined}>{checked.grade?.closest ?? exercise.model}</span></p></>}
      {checked.grade?.ignored.length ? <p className="small muted">{checked.grade.ignored.join(', ')} left out or added: optional here.</p> : null}
      {exercise.modelPinyin && chinese && <p className="small"><Pinyin text={tidyPinyin(exercise.modelPinyin)} /></p>}
      {!checked.correct && <button type="button" className="link-button" aria-pressed={counted} onClick={() => setCounted(!counted)}>{counted ? 'Counted as correct' : 'I was right: count it'}</button>}
      {sentence && <SentenceAudio text={sentence} autoPlay={ctx.autoPlay} />}
      {exercise.explanation && exercise.explanation.trim() !== exercise.prompt?.trim() && <p className="small muted">{exercise.explanation}</p>}</div>}
  </ToneHold>
}

/** The word-form questions (components/WordFormQuestions.tsx) in the engine: the pack's tag, voice and marking, and the reading line in the learner's Readings setting. */
function WordForm({ exercise, ctx, onDone }: { exercise: ConjugateItem | FormPickItem; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const shows = useShowsReading()
  const pack = getPack()
  const shared: WordFormContext = {
    lang: pack.learningTag, busy: ctx.busy, almost: pack.wordForms.almost,
    written: (text, reading) => ctx.pinyin && shows(reading, text) ? <ruby className="mandarin-word" lang={pack.learningTag}><ToneText text={text} reading={reading} /><rt aria-hidden="true" data-assistant-exclude><ReadingText kana={reading!} /></rt></ruby> : <span lang={pack.learningTag}>{text}</span>,
    hear: (text, label, reading) => <HearButton text={text} locale={pack.speechLocale} kind="word" reading={reading} label={label} iconOnly />,
    grade: (given, answer) => pack.wordForms.grade(given, answer, pack.romaji),
  }
  return exercise.form === 'conjugate' ? <ConjugateQuestion exercise={exercise} ctx={shared} onDone={onDone} /> : <FormPickQuestion exercise={exercise} ctx={shared} onDone={onDone} />
}

export function ExerciseQuestion(props: { exercise: Exclude<SessionExercise, { form: 'intro' | 'repeat' }>; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  return <><Instruction form={props.exercise.form} /><ExerciseBody {...props} /></>
}

function ExerciseBody({ exercise, ctx, onDone }: { exercise: Exclude<SessionExercise, { form: 'intro' | 'repeat' }>; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const choiceShape = useMemo((): ChoiceExercise | undefined => {
    if (exercise.form === 'choice') return { id: exercise.id, type: 'choice', targets: exercise.refs, direction: exercise.direction, question: exercise.question, options: exercise.options, answer: exercise.answer, explanation: exercise.explanation }
    if (exercise.form === 'gap') return { id: exercise.id, type: 'choice', targets: exercise.refs, direction: 'en-to-zh', question: exercise.translation, options: exercise.options, answer: exercise.answer, explanation: exercise.explanation }
    if (exercise.form === 'listen-pick') return { id: exercise.id, type: 'choice', targets: exercise.refs, direction: 'zh-to-en', question: '', options: exercise.options, answer: exercise.answer, explanation: exercise.explanation }
    return undefined
  }, [exercise])
  if (choiceShape && (exercise.form === 'choice' || exercise.form === 'gap' || exercise.form === 'listen-pick')) {
    const header = exercise.form === 'gap' ? <p className="practice-prompt native" lang={getPack().learningTag}>{exercise.gapped}</p> : exercise.form === 'listen-pick' ? <p><HearButton text={exercise.hearText} locale={getPack().speechLocale} kind="sentence" label="Hear it" /></p> : undefined
    return <PickQuestion exercise={exercise} shape={choiceShape} header={header} ctx={ctx} onDone={onDone} />
  }
  if (exercise.form === 'conjugate' || exercise.form === 'form-pick') return <WordForm exercise={exercise} ctx={ctx} onDone={onDone} />
  if (exercise.form === 'which-tones') return <WhichTones exercise={exercise} ctx={ctx} onDone={onDone} />
  if (exercise.form === 'exchange-pick') return <ExchangePick exercise={exercise} ctx={ctx} onDone={onDone} />
  if (exercise.form === 'which-correct') return <WhichCorrect exercise={exercise} ctx={ctx} onDone={onDone} />
  if (exercise.form === 'conversation') return <ConversationQuestion exercise={exercise} ctx={ctx} onDone={onDone} />
  if (exercise.form === 'tiles') return <Tiles exercise={exercise} ctx={ctx} onDone={onDone} />
  if (exercise.form === 'match') return <Match exercise={exercise} ctx={ctx} onDone={onDone} />
  return <Text exercise={exercise as TextItem} ctx={ctx} onDone={onDone} />
}
