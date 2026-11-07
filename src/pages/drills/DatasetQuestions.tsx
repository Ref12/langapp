import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Square, Volume2 } from 'lucide-react'
import { AnswerButton } from '../../components/AnswerButton'
import { AnnotatedChinese } from '../../components/study/AnnotatedChinese'
import { HearButton } from '../../components/assistant/SnippetActions'
import { Pinyin } from '../../components/Pinyin'
import { playBrowserSpeechToEnd, stopBrowserSpeech } from '../../core/assistant/speech'
import { speakerOptions } from '../../core/assistant/speaker-voices'
import { tidyPinyin } from '../../core/drills/items'
import type { ConversationItem, ExchangePickItem, WhichCorrectItem } from '../../core/session/types'
import type { Outcome, QuestionContext } from './EngineQuestion'

type Done = (outcome: Outcome) => void
const optionClass = (selected: boolean, shown: boolean, right: boolean) => `answer-option ${selected ? 'selected' : ''} ${shown && right ? 'correct-option' : ''} ${shown && selected && !right ? 'wrong-option' : ''}`

/** Hear or read the question, pick the fitting reply. */
export function ExchangePick({ exercise, ctx, onDone }: { exercise: ExchangePickItem; ctx: QuestionContext; onDone: Done }) {
  const [selected, setSelected] = useState(-1)
  const [result, setResult] = useState<boolean>()
  const checked = result !== undefined
  return <>
    <p className="small muted">{exercise.question.speaker === 'male' ? 'He asks' : 'She asks'}:</p>
    <p className="practice-prompt native" lang="zh-Hans"><AnnotatedChinese text={exercise.question.zh} readings={ctx.readings} pinyin={ctx.pinyin} /> <HearButton text={exercise.question.zh} locale="zh-Hans" label="Hear the question" iconOnly /></p>
    <fieldset className="answer-options" disabled={ctx.busy || checked}><legend className="visually-hidden">Pick the reply</legend>
      {exercise.options.map((option, index) => <label key={index} className={optionClass(selected === index, checked, index === exercise.answer)}>
        <input type="radio" name={exercise.id} checked={selected === index} onChange={() => setSelected(index)} />
        <span><AnnotatedChinese text={option.zh} readings={ctx.readings} pinyin={ctx.pinyin} /></span>
        <HearButton text={option.zh} locale="zh-Hans" label={`Hear reply ${index + 1}`} iconOnly />
        <span className="answer-option-mark">{checked && index === exercise.answer && <CheckCircle2 size={18} aria-label="Correct answer" />}</span>
      </label>)}
    </fieldset>
    <AnswerButton result={result} busy={ctx.busy} ready={selected >= 0} onCheck={() => setResult(selected === exercise.answer)} onNext={() => onDone({ correct: result === true })} />
    {checked && <div className="notice answer-feedback" role="status"><p lang="en">“{exercise.question.en}”</p><ul className="engine-glosses">{exercise.options.map((option, index) => <li key={index}><span lang="zh-Hans">{option.zh}</span> <span className="muted" lang="en">{option.en}</span></li>)}</ul><p>{exercise.explanation}</p></div>}
  </>
}

/** The correct phrase against its near misses. After Check: why each wrong version is wrong, and the pattern's note. */
export function WhichCorrect({ exercise, ctx, onDone }: { exercise: WhichCorrectItem; ctx: QuestionContext; onDone: Done }) {
  const [selected, setSelected] = useState(-1)
  const [result, setResult] = useState<boolean>()
  const checked = result !== undefined
  return <>
    <p className="practice-prompt" lang="en">Which is correct? <span className="muted">“{exercise.en}”</span></p>
    <fieldset className="answer-options" disabled={ctx.busy || checked}><legend className="visually-hidden">Which is correct?</legend>
      {exercise.options.map((option, index) => <label key={index} className={optionClass(selected === index, checked, index === exercise.answer)}>
        <input type="radio" name={exercise.id} checked={selected === index} onChange={() => setSelected(index)} />
        <span lang="zh-Hans"><AnnotatedChinese text={option.zh} readings={ctx.readings} pinyin={ctx.pinyin} /></span>
        <span className="answer-option-mark">{checked && index === exercise.answer && <CheckCircle2 size={18} aria-label="Correct answer" />}</span>
      </label>)}
    </fieldset>
    <AnswerButton result={result} busy={ctx.busy} ready={selected >= 0} onCheck={() => setResult(selected === exercise.answer)} onNext={() => onDone({ correct: result === true })} />
    {checked && <div className="notice answer-feedback engine-why" role="status">
      {exercise.options.map((option, index) => exercise.whys[index] ? <p key={index}><strong lang="zh-Hans">{option.zh}</strong>: {exercise.whys[index]}</p> : null)}
      {exercise.note && <p className="small"><strong>Pattern:</strong> {exercise.note}</p>}</div>}
  </>
}

/** The Listen and answer screen for a dataset conversation: Play is always available, every line has its own play button, speakers are named and have a female or male voice. */
export function ConversationQuestion({ exercise, ctx, onDone }: { exercise: ConversationItem; ctx: QuestionContext; onDone: Done }) {
  const [picked, setPicked] = useState<number[]>([])
  const [result, setResult] = useState<boolean>()
  const [shown, setShown] = useState(false)
  const [playing, setPlaying] = useState(-1)
  const token = useRef(0)
  const checked = result !== undefined
  useEffect(() => () => { token.current++; stopBrowserSpeech() }, [])
  const say = (index: number) => playBrowserSpeechToEnd(`${exercise.id}-${index}`, exercise.lines[index].zh, 'zh-Hans', 0.85, speakerOptions(exercise.lines[index].speaker))
  const play = async () => {
    const mine = ++token.current
    for (let index = 0; index < exercise.lines.length; index++) {
      if (mine !== token.current) return
      setPlaying(index)
      if ((await say(index)).status !== 'completed') break
    }
    if (mine === token.current) setPlaying(-1)
  }
  const playLine = async (index: number) => { const mine = ++token.current; setPlaying(index); await say(index); if (mine === token.current) setPlaying(-1) }
  const complete = exercise.questions.every((_item, index) => picked[index] !== undefined)
  const transcript = shown
  return <>
    <p className="small muted">{exercise.title}</p>
    <div className="button-row">
      <button type="button" className="button primary" onClick={() => void play()}><Volume2 size={16} /> {playing >= 0 ? 'Playing…' : 'Play the conversation'}</button>
      {playing >= 0 && <button type="button" className="button secondary" onClick={() => { token.current++; stopBrowserSpeech(); setPlaying(-1) }}><Square size={16} /> Stop</button>}
      {<button type="button" className="button secondary" style={checked ? { visibility: 'hidden' } : undefined} tabIndex={checked ? -1 : undefined} aria-hidden={checked} aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? 'Hide transcript' : 'Show transcript (hint)'}</button>}</div>
    <ul className="dr-lines engine-convo-lines">{exercise.lines.map((line, index) => <li key={index} data-speaker={line.speaker}>
      <strong className="engine-speaker">{line.name}<span className="small muted"> ({line.speaker})</span></strong>
      <button type="button" className="button secondary icon-button dr-line-play" aria-label={`Play line ${index + 1}, ${line.name}`} onClick={() => void playLine(index)}><Volume2 size={14} /></button>
      {transcript && <><span lang="zh-Hans">{line.zh}</span><span className="small muted"><Pinyin text={tidyPinyin(line.py)} /> {checked && line.en}</span></>}</li>)}</ul>
    {exercise.questions.map((item, index) => <fieldset key={index} className="answer-options dr-inline" disabled={ctx.busy || checked}><legend className="small">{item.q}</legend>
      {item.options.map((option, optionIndex) => <label key={optionIndex} className={optionClass(picked[index] === optionIndex, checked, optionIndex === item.answer)}>
        <input type="radio" name={`${exercise.id}-q${index}`} checked={picked[index] === optionIndex} onChange={() => { const next = [...picked]; next[index] = optionIndex; setPicked(next) }} /><span lang="en">{option}</span></label>)}</fieldset>)}
    <AnswerButton result={result} busy={ctx.busy} ready={complete} onCheck={() => setResult(exercise.questions.every((item, index) => picked[index] === item.answer))} onNext={() => onDone({ correct: result === true })} />
    {checked && <div className="notice answer-feedback" role="status"><ul className="dr-lines engine-convo-lines">{exercise.lines.map((line, index) => <li key={index}><strong>{line.name}</strong> <span lang="zh-Hans">{line.zh}</span> <span className="small muted"><Pinyin text={tidyPinyin(line.py)} /> {line.en}</span></li>)}</ul></div>}
  </>
}
