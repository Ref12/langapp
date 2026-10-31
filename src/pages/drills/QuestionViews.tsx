import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Eye, Mic, PenLine, Pause, Play, RotateCcw, SkipForward, Square, Volume2 } from 'lucide-react'
import { HearButton } from '../../components/assistant/SnippetActions'
import { HandwritingPad } from '../../components/characters/HandwritingPad'
import { openWritingSheet } from '../../core/characters/writing-sheet'
import { createGuidedAudio, type GuidedAudioState } from '../../core/guided-audio'
import { getPlaybackState, playBrowserSpeechToEnd, stopBrowserSpeech } from '../../core/assistant/speech'
import { startSpeechCapture, speechCaptureSupported, type SpeechCaptureSession } from '../../core/assistant/speech-capture'
import { MARK_LABEL, MARKS, type Mark } from '../../core/drills/contracts'
import type { ExerciseAttempt } from '../../core/study/contracts'
import { Pinyin } from '../../components/Pinyin'
import { tidyPinyin } from '../../core/drills/items'
import { ChoiceQuestion, MatchQuestion } from '../Study'
import type { Workspace } from '../../core/model'
import { markCharactersWritten } from '../../core/drills/store'
import { StrokeOrder } from './StrokeOrder'
import { StrokePad } from './StrokePad'
import { type ConvoAnswer, type Outcome, type Q, type QData, type TextAnswer, type WriteAnswer } from './tasks'

export interface QState { answer?: unknown; status: 'open' | 'marking' | 'done'; outcome?: Outcome }
export interface ViewContext { readings: Map<string, Set<string>>; pinyinOn: boolean; catalogChars: Set<string>; workspace: Workspace }
export interface ViewProps { q: Q; quiz: boolean; state: QState; ctx: ViewContext; onAnswer: (answer: unknown) => void; onMark: (mark: Mark) => void }

const noop = () => undefined

export function SelfMark({ onMark, chosen }: { onMark: (mark: Mark) => void; chosen?: Mark }) {
  return <div className="dr-selfmark" role="group" aria-label="Mark your answer">
    {MARKS.map(mark => <button key={mark} type="button" aria-pressed={chosen === mark} className={`button secondary dr-mark dr-mark-${mark}`} onClick={() => onMark(mark)}>{MARK_LABEL[mark]}</button>)}
  </div>
}

/** What the result was, shown once a question is checked. */
function Result({ state, children }: { state: QState; children?: ReactNode }) {
  if (state.status !== 'done' || !state.outcome) return null
  const marks = Object.values(state.outcome.marks)
  const mark: Mark = marks.includes('missed') ? 'missed' : marks.includes('hint') ? 'hint' : 'got'
  return <div className={`notice answer-feedback dr-result${state.outcome.correct ? ' success' : ''}`} role="status"><strong>{MARK_LABEL[mark]}</strong>{children}</div>
}

const fakeAttempt = (q: Q, state: QState): ExerciseAttempt | undefined => state.status === 'open' ? undefined
  : { id: q.key, sessionId: 'drill', index: 0, refs: q.refs.slice(0, 6), response: String(state.answer ?? ''), correct: Boolean(state.outcome?.correct), createdAt: 0 }

function ChoiceView({ q, data, state, ctx, onAnswer }: ViewProps & { data: Extract<QData, { t: 'choice' }> }) {
  return <>
    <ChoiceQuestion bare name={q.key} exercise={data.exercise} attempt={fakeAttempt(q, state)} submit={noop} next={noop} busy={false} readings={ctx.readings} pinyin={ctx.pinyinOn} speak={false} onSelect={onAnswer} />
    <Result state={state}><p className="small">{data.exercise.explanation}</p></Result>
  </>
}

function MatchView({ q, data, state, ctx, onAnswer }: ViewProps & { data: Extract<QData, { t: 'match' }> }) {
  return <>
    <MatchQuestion bare exercise={data.exercise} attempt={fakeAttempt(q, state)} submit={misses => onAnswer(misses)} next={noop} busy={false} readings={ctx.readings} pinyin={ctx.pinyinOn} speak={false} chinese={() => ''} />
    <Result state={state}><p className="small">Pairs matched with {(state.answer as string[] | undefined)?.length ?? 0} wrong tries.</p></Result>
  </>
}

function TextInput({ label, value, disabled, onChange, placeholder, lang }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; placeholder?: string; lang?: string }) {
  return <label className="dr-free"><span className="small muted">{label}</span>
    <input type="text" value={value} disabled={disabled} lang={lang} placeholder={placeholder} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={event => onChange(event.target.value)} /></label>
}

function FreeView({ data, state, onAnswer }: ViewProps & { data: Extract<QData, { t: 'free' }> }) {
  const [text, setText] = useState((state.answer as TextAnswer | undefined)?.text ?? '')
  const [hinted, setHinted] = useState(false)
  const zh = data.direction === 'zh-to-en'
  const set = (value: string, hint = hinted) => { setText(value); onAnswer(value.trim() ? { text: value, hinted: hint } : undefined) }
  const locked = state.status !== 'open'
  return <>
    {zh ? <p className="practice-prompt native dr-center" lang="zh-Hans">{data.item.zh}</p> : <p className="practice-prompt dr-center" lang="en">{data.item.en}</p>}
    <TextInput label={zh ? 'Type the English meaning' : 'Type the Chinese, or its pinyin'} value={text} disabled={locked} lang={zh ? 'en' : undefined} onChange={value => set(value)} />
    {!locked && <div className="button-row"><button type="button" className="button secondary" aria-pressed={hinted} onClick={() => { setHinted(true); onAnswer(text.trim() ? { text, hinted: true } : undefined) }}><Eye size={16} /> Hint</button>
      {hinted && <span className="small" lang="zh-Hans"><Pinyin text={data.item.py} />{zh ? '' : ''}</span>}</div>}
    <Result state={state}><p lang="zh-Hans">{data.item.zh} <Pinyin text={data.item.py} /> <span lang="en" className="muted">{data.item.en}</span></p></Result>
  </>
}

function PinyinView({ data, state, onAnswer }: ViewProps & { data: Extract<QData, { t: 'pinyin' }> }) {
  const [text, setText] = useState((state.answer as TextAnswer | undefined)?.text ?? '')
  const [hinted, setHinted] = useState(false)
  const locked = state.status !== 'open'
  const toneless = data.item.py.normalize('NFD').replace(/\p{M}/gu, '')
  return <>
    <p className="practice-prompt native dr-center" lang="zh-Hans">{data.item.zh}</p>
    <p className="small muted dr-center" lang="en">{data.item.en}</p>
    <TextInput label="Type the pinyin with tone marks or numbers (ni3 hao3)" value={text} disabled={locked} placeholder="nǐ hǎo" onChange={value => { setText(value); onAnswer(value.trim() ? { text: value, hinted } : undefined) }} />
    {!locked && <div className="button-row"><button type="button" className="button secondary" aria-pressed={hinted} onClick={() => { setHinted(true); onAnswer(text.trim() ? { text, hinted: true } : undefined) }}><Eye size={16} /> Hint</button>
      {hinted && <span className="small">Letters only: <strong>{toneless}</strong></span>}</div>}
    <Result state={state}><p>The pinyin is <strong><Pinyin text={data.item.py} /></strong>.</p></Result>
  </>
}

/** The pinyin sentence with the target accented: one syllable of the cue word (`syllable`), or the whole word when it is unset. The rest reads as plain sentence text. */
function PinyinSentence({ py: raw, target, syllable }: { py: string; target: string; syllable?: number }) {
  const py = tidyPinyin(raw)
  const at = target ? py.toLowerCase().indexOf(target.toLowerCase()) : -1
  if (at < 0) return <p className="dr-pinyin-prompt" lang="zh-Latn-pinyin">{py}</p>
  const word = py.slice(at, at + target.length)
  const parts = word.split(/(\s+)/)
  const syllables = parts.filter((_, index) => index % 2 === 0).length
  let seen = -1
  return <p className="dr-pinyin-prompt" lang="zh-Latn-pinyin">{py.slice(0, at)}{syllable === undefined || syllables < 2 ? <mark className="dr-target">{word}</mark>
    : parts.map((part, index) => { if (index % 2) return part; seen++; return seen === syllable ? <mark key={index} className="dr-target">{part}</mark> : part })}{py.slice(at + target.length)}</p>
}

function WriteView({ data, state, ctx, onAnswer, onMark, quiz }: ViewProps & { data: Extract<QData, { t: 'write' }> }) {
  const [hinted, setHinted] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const locked = state.status !== 'open'
  const [written, setWritten] = useState(false)
  const [taught, setTaught] = useState(false)
  const showChars = revealed || locked
  const [stroke, setStroke] = useState<{ index: number; total: number }>()
  const onStep = useCallback((index: number, total: number) => setStroke({ index, total }), [])
  const syllableList = data.item.py.trim().split(/\s+/)
  const target = data.char ?? data.item.zh
  const aligned = syllableList.length === Array.from(data.item.zh).filter(character => /\p{Script=Han}/u.test(character)).length
  // Characters mode: the one syllable. Whole words on the pad: the syllable of the character being written. Whole words elsewhere: the whole word.
  const syllable = data.char !== undefined ? (aligned ? data.index : undefined)
    : data.mode === 'pad' && !locked && syllableList.length > 1 && aligned ? (stroke && stroke.total === syllableList.length ? stroke.index : 0) : undefined
  const prompt = syllable === undefined ? data.item.py : syllableList[syllable]
  const hint = () => setHinted(true)
  const done = (result: { misses: number; hinted: boolean }) => onAnswer({ misses: result.misses, hinted: hinted || result.hinted, taught } satisfies WriteAnswer)
  return <>
    <PinyinSentence py={data.sentence.py} target={data.item.py} syllable={syllable} />
    <div className="dr-center"><HearButton text={data.sentence.zh} locale="zh-Hans" label="Play the sentence" iconOnly /> <span className="small muted" lang="en">{data.sentence.en}</span></div>
    <p className="small dr-center dr-write-line">Write <mark className="dr-target">{prompt}</mark></p>
    {data.mode === 'pad' && !locked && <StrokePad key={target} text={target} teach={data.fresh} workspace={ctx.workspace} onTaught={character => { setTaught(true); void markCharactersWritten([character]) }} onStep={onStep} onDone={done} />}
    {data.mode === 'paper' && !locked && <div className="dr-pad" role="note"><p className="small muted">Write it anywhere, then check your answer.</p>
      {quiz ? <button type="button" className="button secondary" aria-pressed={written} onClick={() => { setWritten(!written); onAnswer(written ? undefined : { misses: 0, hinted, paper: true } satisfies WriteAnswer) }}>{written ? 'Written ✓' : 'I have written it'}</button>
        : <button type="button" className="button primary" onClick={() => onAnswer({ misses: 0, hinted, paper: true } satisfies WriteAnswer)}>Check answer</button>}</div>}
    {!locked && <div className="button-row dr-hints"><span className="small muted">Hints (counts as Needed a hint):</span>
      <button type="button" className="button secondary" aria-pressed={revealed} onClick={() => { setRevealed(true); hint() }}><Eye size={16} /> Reveal</button>
      <button type="button" className="button secondary" onClick={() => { hint(); openWritingSheet(target, { remember: false }) }}><PenLine size={16} /> Writing practice</button>
      {data.mode === 'pad' && <button type="button" className="button secondary" onClick={() => onAnswer({ misses: 0, hinted, skipped: true } satisfies WriteAnswer)}>Give up</button>}</div>}
    {showChars && (data.mode === 'paper' && locked ? <StrokeOrder text={target} /> : <p className="dr-reveal"><span className="dr-zh" lang="zh-Hans">{target}</span></p>)}
    {state.status === 'marking' && <SelfMark onMark={onMark} />}
    <Result state={state} />
  </>
}

const LANG_NOTE = 'Type Chinese characters or pinyin.'
function TranslateView({ data, state, ctx, onAnswer, onMark }: ViewProps & { data: Extract<QData, { t: 'translate' }> }) {
  const [text, setText] = useState((state.answer as TextAnswer | undefined)?.text ?? '')
  const [method, setMethod] = useState<'type' | 'speak' | 'write'>('type')
  const [listening, setListening] = useState('')
  const capture = useRef<SpeechCaptureSession>()
  useEffect(() => () => capture.current?.cancel(), [])
  const locked = state.status !== 'open'
  const set = (value: string) => { setText(value); onAnswer(value.trim() ? { text: value } : undefined) }
  const speak = () => {
    capture.current?.cancel()
    setListening('Listening…')
    capture.current = startSpeechCapture(next => {
      if (next.phase === 'error') setListening(next.error ?? 'Speech capture failed.')
      else if (next.phase === 'finished') { setListening(''); if (next.transcript) set(next.transcript) }
    })
  }
  const allowed = useMemo(() => new Set([...ctx.catalogChars, ...Array.from(data.sentence.zh)]), [ctx.catalogChars, data.sentence.zh])
  return <>
    <p className="practice-prompt dr-center" lang="en">{data.sentence.en}</p>
    {!locked && <div className="segmented dr-modes" role="group" aria-label="How to answer">
      {(['type', 'speak', 'write'] as const).map(value => <button key={value} type="button" aria-pressed={method === value} onClick={() => setMethod(value)}>{value === 'type' ? 'Type' : value === 'speak' ? 'Speak' : 'Handwrite'}</button>)}</div>}
    {!locked && <TextInput label={LANG_NOTE} value={text} disabled={false} lang="zh-Hans" onChange={set} />}
    {!locked && method === 'speak' && <div className="button-row">
      {speechCaptureSupported() ? <button type="button" className="button secondary" onClick={speak}><Mic size={16} /> {listening || 'Start speaking'}</button> : <p className="small muted">Speech recognition is not available in this browser.</p>}</div>}
    {!locked && method === 'write' && <HandwritingPad allowed={allowed} onPick={character => set(text + character)} onClose={() => setMethod('type')} />}
    {state.status !== 'open' && <div className="dr-model-box"><p className="small muted">Model answer</p>
      <p className="dr-model" lang="zh-Hans">{data.sentence.zh}</p><p className="small"><Pinyin text={tidyPinyin(data.sentence.py)} /></p>
      {text && <p className="small muted">You wrote: <span lang="zh-Hans">{text}</span></p>}</div>}
    {state.status === 'marking' && <SelfMark onMark={onMark} />}
    <Result state={state}>{state.outcome && state.outcome.correct && sentenceExact(text, data) ? <p className="small">Exact match, marked automatically.</p> : null}</Result>
  </>
}
const sentenceExact = (text: string, data: Extract<QData, { t: 'translate' }>) => text.replace(/[^\p{L}\p{M}]/gu, '').toLowerCase() === data.sentence.zh.replace(/[^\p{L}\p{M}]/gu, '').toLowerCase() || false

/** A timed audio-first loop: the English prompt, a pause, the Chinese spoken, a pause to repeat. Big controls, nothing is checked. */
function RepeatView({ data, quiz, state, onAnswer }: ViewProps & { data: Extract<QData, { t: 'repeat' }> }) {
  const id = useId()
  const [audio, setAudio] = useState<GuidedAudioState>({ status: 'idle', index: 0 })
  const player = useRef<ReturnType<typeof createGuidedAudio>>()
  const seconds = Math.min(8, Math.max(3, Math.ceil(data.sentence.zh.length * 0.6)))
  useEffect(() => {
    const next = createGuidedAudio(id, [
      { kind: 'speech', modelId: 'prompt', text: data.sentence.en, locale: 'en-US' },
      { kind: 'response', modelId: 'prompt', seconds: 3 },
      { kind: 'speech', modelId: 'answer', text: data.sentence.zh, locale: 'zh-Hans' },
      { kind: 'response', modelId: 'repeat', seconds },
    ], setAudio)
    player.current = next
    return () => { next.dispose?.(); if (getPlaybackState().activeId === id) stopBrowserSpeech() }
  }, [id, data.sentence, seconds])
  useEffect(() => { if (audio.status === 'completed' && !quiz) onAnswer(true) }, [audio.status, quiz, onAnswer])
  const phase = ['Listen to the English', 'Think of the Chinese', 'Listen to the Chinese', 'Say it aloud'][Math.min(audio.index, 3)]
  const playing = audio.status === 'playing' || audio.status === 'responding'
  return <>
    <div className="dr-speak" aria-live="polite"><p className="dr-phase">{audio.status === 'idle' ? 'Press play and listen. You do not need to look.' : audio.status === 'completed' ? 'Done. Press play to hear it again.' : phase}</p></div>
    {audio.error && <p className="small error-text" role="alert">{audio.error}</p>}
    <div className="dr-big">
      <button type="button" className="button secondary" aria-label="Replay" onClick={() => player.current?.start()}><RotateCcw size={28} /></button>
      <button type="button" className="button primary" aria-label={playing ? 'Pause' : 'Play'} onClick={() => playing ? player.current?.pause() : audio.status === 'paused' ? player.current?.resume() : player.current?.start()}>{playing ? <Pause size={40} /> : <Play size={40} />}</button>
      <button type="button" className="button secondary" aria-label="Skip to the end" onClick={() => { player.current?.stop?.(); onAnswer(true) }}><SkipForward size={28} /></button>
    </div>
    {quiz && state.status === 'open' && <label className="dr-check"><input type="checkbox" checked={Boolean(state.answer)} onChange={event => onAnswer(event.target.checked ? true : undefined)} /> I said it aloud</label>}
    <Result state={state}><p lang="zh-Hans">{data.sentence.zh} <Pinyin text={tidyPinyin(data.sentence.py)} /> <span lang="en" className="muted">{data.sentence.en}</span></p><p className="small muted">Repeating is practice only; nothing was checked.</p></Result>
  </>
}

/** A conversation with checkpoint questions: played aloud (Listen) or shown as text with pinyin (Read). */
function ConvoView({ data, quiz, state, ctx, onAnswer }: ViewProps & { data: Extract<QData, { t: 'convo' }> }) {
  const { conversation: talk, mode } = data
  const listen = mode === 'listen'
  const saved = (state.answer as ConvoAnswer | undefined)?.picked ?? []
  const [picked, setPicked] = useState<number[]>(saved)
  const [shown, setShown] = useState(false)
  const [playing, setPlaying] = useState(-1)
  const [step, setStep] = useState(0)
  const [hinted, setHinted] = useState(false)
  const token = useRef(0)
  const locked = state.status !== 'open'
  useEffect(() => () => { token.current++; stopBrowserSpeech() }, [])
  const upTo = quiz || locked ? talk.lines.length : (talk.questions[Math.min(step, talk.questions.length - 1)].after + 1)
  const from = quiz || step === 0 ? 0 : talk.questions[step - 1].after + 1
  const play = async () => {
    const mine = ++token.current
    for (let index = from; index < upTo; index++) {
      if (mine !== token.current) return
      setPlaying(index)
      const result = await playBrowserSpeechToEnd(`${talk.title}-${index}`, talk.lines[index].zh, 'zh-Hans', 0.85)
      if (result.status !== 'completed') break
    }
    if (mine === token.current) setPlaying(-1)
  }
  const choose = (question: number, option: number) => {
    const next = [...picked]; next[question] = option
    setPicked(next)
    const complete = talk.questions.every((_item, index) => next[index] !== undefined)
    onAnswer(complete ? { picked: next, hinted } satisfies ConvoAnswer : undefined)
    if (!quiz && question === step && step < talk.questions.length - 1) setStep(step + 1)
  }
  const visible = (index: number) => !listen || shown || locked ? index < upTo : false
  const questionsShown = quiz ? talk.questions.map((_item, index) => index) : talk.questions.map((_item, index) => index).filter(index => index <= step)
  return <>
    <p className="small muted">{talk.title}</p>
    {listen && <div className="button-row"><button type="button" className="button primary" onClick={() => void play()} disabled={locked}><Volume2 size={16} /> {playing >= 0 ? 'Playing…' : quiz ? 'Play the conversation' : step === 0 ? 'Play' : 'Play the next part'}</button>
      {playing >= 0 && <button type="button" className="button secondary" onClick={() => { token.current++; stopBrowserSpeech(); setPlaying(-1) }}><Square size={16} /> Stop</button>}
      {!locked && <button type="button" className="button secondary" aria-pressed={shown} onClick={() => { setShown(!shown); setHinted(true) }}>{shown ? 'Hide transcript' : 'Show transcript (hint)'}</button>}</div>}
    {(!listen || shown || locked) && <ul className="dr-lines">{talk.lines.map((line, index) => visible(index) || (!listen) && index < upTo ? <li key={index}>
      <strong>{line.who}</strong><span lang="zh-Hans">{line.zh}</span><span className="small muted">{ctx.pinyinOn || listen ? <Pinyin text={tidyPinyin(line.py)} /> : null}{' '}{(locked || listen) && line.en}</span></li> : null)}</ul>}
    {questionsShown.map(index => { const item = talk.questions[index]; return <fieldset key={index} className="answer-options dr-inline" disabled={locked}><legend className="small">{item.question}</legend>
      {item.options.map((option, optionIndex) => <label key={optionIndex} className={`answer-option ${picked[index] === optionIndex ? 'selected' : ''} ${locked && optionIndex === item.answer ? 'correct-option' : ''}`}>
        <input type="radio" name={`q${index}`} checked={picked[index] === optionIndex} onChange={() => choose(index, optionIndex)} /><span lang="en">{option}</span></label>)}</fieldset> })}
    <Result state={state} />
  </>
}

export function QuestionView(props: ViewProps) {
  const data = props.q.data
  switch (data.t) {
    case 'choice': return <ChoiceView {...props} data={data} />
    case 'match': return <MatchView {...props} data={data} />
    case 'free': return <FreeView {...props} data={data} />
    case 'pinyin': return <PinyinView {...props} data={data} />
    case 'write': return <WriteView {...props} data={data} />
    case 'translate': return <TranslateView {...props} data={data} />
    case 'repeat': return <RepeatView {...props} data={data} />
    case 'convo': return <ConvoView {...props} data={data} />
  }
}

