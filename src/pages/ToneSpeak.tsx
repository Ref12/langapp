import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Mic, Play, Square, X } from 'lucide-react'
import { ToneCurveChart } from './ToneCurveChart'
import { toneClass, useToneColours } from '../components/tone-colour-context'
import { getPack } from '../core/language'
import { withTone } from '../core/pinyin'
import { calibrate, type PitchRange } from '../core/tone-trainer/calibration'
import { judgeRecording, type Judgement } from '../core/tone-trainer/judge'
import type { ToneManifest } from '../core/tone-trainer/manifest'
import type { LevelCurve } from '../core/tone-trainer/pitch'
import { clipPitchCurves, playClip, speechRatePreference } from '../core/tone-trainer/play'
import { MicError, recordSpeech, type Recorder } from '../core/tone-trainer/recorder'
import { pickSpeakRound, recordSpeakAnswer, SPEAK_ROUND_SIZE, SPEAK_STAGE_NAME, type SpeakStage } from '../core/tone-trainer/speaking'
import { saveSpeakAnswer, saveSpeakRange } from '../core/tone-trainer/store'
import type { TrainerProgress } from '../core/tone-trainer/engine'

export const YOU_COLOUR = '#e0a100'
export const CALIBRATION_SECONDS = 8
const MIC_NOTE = {
  denied: 'The microphone is blocked, so there is nothing to record. Allow it for this site in your browser, or practise with the listening stages.',
  missing: 'No microphone was found, so there is nothing to record. Connect one, or practise with the listening stages.',
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return <button type="button" className="icon-button tt-close" aria-label="Close the tone trainer" onClick={onClose}><X size={20} aria-hidden="true" /></button>
}

/** The microphone note, with the way out to the listening stages. */
function MicNote({ problem, onListening }: { problem: 'denied' | 'missing'; onListening: () => void }) {
  return <div className="notice" role="alert"><p>{MIC_NOTE[problem]}</p>
    <button type="button" className="button secondary" onClick={onListening}>Use the listening stages instead</button></div>
}

/** A level meter in a track that is always there, so it never moves anything. */
const Meter = ({ level }: { level: number }) => <div className="tt-level-track" aria-hidden="true"><span className="tt-level" style={{ transform: 'scaleX(' + level.toFixed(2) + ')' }} /></div>

const syllablesOf = (pinyin: string) => pinyin.split(' ').map(part => { const m = /^([a-z]+)([1-5])$/.exec(part); return { text: m ? withTone(m[1], m[2]) : part, tone: Number(m?.[2] ?? 5) } })

/** The first calibration, or a recalibration: "Say mā, má, mǎ, mà" for about 8 seconds; the 5th to 95th percentile of the pitch is the learner's range. */
export function SpeakCalibration({ hasRange, onRange, onSkip, onExit, onClose, onListening }: { hasRange: boolean; onRange: (range: PitchRange) => void; onSkip: () => void; onExit: () => void; onClose: () => void; onListening: () => void }) {
  const [phase, setPhase] = useState<'ready' | 'recording' | 'working'>('ready')
  const [level, setLevel] = useState(0)
  const [note, setNote] = useState('')
  const [mic, setMic] = useState<'denied' | 'missing'>()
  const recorder = useRef<Recorder>()
  useEffect(() => () => recorder.current?.stop(), [])
  const start = async () => {
    setNote(''); setMic(undefined); setPhase('recording')
    try {
      const run = await recordSpeech({ mode: 'fixed', seconds: CALIBRATION_SECONDS, onLevel: setLevel })
      recorder.current = run
      setPhase('recording')
      const { pcm, sampleRate } = await run.done
      setPhase('working'); setLevel(0)
      const range = calibrate(pcm, sampleRate)
      if (!range) { setNote("Didn't catch enough of your voice. Try again a bit louder, and say all four syllables."); setPhase('ready'); return }
      await saveSpeakRange(range)
      onRange(range)
    } catch (error) { setPhase('ready'); setLevel(0); if (error instanceof MicError) setMic(error.kind); else setNote('The recording failed. Try again.') }
  }
  return <section className="panel tt-card" aria-labelledby="tt-cal">
    <CloseButton onClose={onClose} />
    <h2 id="tt-cal">Find your range</h2>
    <p className="engine-instruction small">Say <strong lang={getPack().learningTag}>mā, má, mǎ, mà</strong> slowly, one after another, in your own voice. It takes about {CALIBRATION_SECONDS} seconds. Your highest and lowest notes set the scale your tones are judged on.</p>
    <button type="button" className="button primary tt-record" disabled={phase === 'working'} onClick={phase === 'recording' ? () => recorder.current?.stop() : () => void start()}>
      {phase === 'recording' ? <><Square size={18} aria-hidden="true" /> Stop</> : <><Mic size={18} aria-hidden="true" /> {phase === 'working' ? 'Working…' : 'Record'}</>}</button>
    <Meter level={level} />
    <div className="answer-actions"><button type="button" className="button secondary" onClick={onExit}><ArrowLeft size={16} aria-hidden="true" /> {hasRange ? 'Back' : 'Stop'}</button>
      {!hasRange && <button type="button" className="button secondary" onClick={onSkip}>Skip for now</button>}</div>
    {note && <p className="notice" role="status">{note}</p>}
    {mic && <MicNote problem={mic} onListening={onListening} />}
  </section>
}

type Phase = 'ready' | 'recording' | 'judging'

export function SpeakRound({ manifest, stage, progress, onDone, onExit, onClose, onListening, onRecalibrate }: { manifest: ToneManifest; stage: SpeakStage; progress: TrainerProgress; onDone: (progress: TrainerProgress, right: number) => void; onExit: () => void; onClose: () => void; onListening: () => void; onRecalibrate: () => void }) {
  const round = useMemo(() => pickSpeakRound(manifest, stage, progress.speaking, Math.random), [manifest, stage]) // eslint-disable-line react-hooks/exhaustive-deps
  const colours = useToneColours()
  const [at, setAt] = useState(0)
  const [phase, setPhase] = useState<Phase>('ready')
  const [playing, setPlaying] = useState(false)
  const [level, setLevel] = useState(0)
  const [judgement, setJudgement] = useState<Judgement>()
  const [quiet, setQuiet] = useState(false)
  const [counted, setCounted] = useState(false)
  const [right, setRight] = useState(0)
  const [local, setLocal] = useState(progress)
  const [mic, setMic] = useState<'denied' | 'missing'>()
  const [trouble, setTrouble] = useState('')
  const [model, setModel] = useState<(LevelCurve | null)[]>()
  const recorder = useRef<Recorder>()
  const item = round[at]
  useEffect(() => () => recorder.current?.stop(), [])
  const play = useCallback(async () => {
    if (!item) return
    setPlaying(true); setTrouble('')
    try { await playClip(item.item.clips[item.voice].file, undefined, await speechRatePreference()) } catch { setTrouble('The sound could not be played. Check your connection and try again.') } finally { setPlaying(false) }
  }, [item])
  // The model plays once by itself when an item opens.
  const played = useRef(-1)
  useEffect(() => { if (played.current !== at) { played.current = at; void play() } }, [at, play])
  useEffect(() => {
    setModel(undefined)
    if (!judgement || !item) return
    let live = true
    void clipPitchCurves(item.item.clips[item.voice].file, item.voice, item.item.tones.length === 2 ? 2 : 1).then(curves => { if (live) setModel(curves) })
    return () => { live = false }
  }, [judgement, item])
  if (!item) return <p role="status">No sounds are available.</p>
  const expected = item.item.tones
  const range = local.speaking?.range

  const record = async () => {
    if (phase === 'recording') { recorder.current?.stop(); return }
    setMic(undefined); setQuiet(false); setTrouble('')
    setPhase('recording')
    try {
      const run = await recordSpeech({ mode: 'speech', onLevel: setLevel })
      recorder.current = run
      const { pcm, sampleRate } = await run.done
      setPhase('judging'); setLevel(0)
      const result = judgeRecording(pcm, sampleRate, expected, range)
      // pcm is not kept: it goes out of scope here (nothing is stored or uploaded).
      if (result.status === 'quiet') { setQuiet(true); setJudgement(undefined); setPhase('ready'); return }
      setJudgement(result); setPhase('ready')
      if (!counted) {
        setCounted(true)
        if (result.correct) setRight(value => value + 1)
        const answer = { stage, item: item.item.id, voice: item.voice, expected, heard: result.heard.map(tone => tone ?? 0), correct: result.correct, at: Date.now() }
        setLocal(old => ({ ...old, speaking: recordSpeakAnswer(old.speaking, answer) }))
        await saveSpeakAnswer(answer)
      }
    } catch (error) { setPhase('ready'); setLevel(0); if (error instanceof MicError) setMic(error.kind); else setTrouble('The recording failed. Try again.') }
  }
  const next = () => {
    if (at + 1 >= round.length) { onDone(local, right); return }
    setAt(at + 1); setJudgement(undefined); setQuiet(false); setCounted(false); setModel(undefined)
  }
  const syllables = syllablesOf(item.item.pinyin)
  const chars = [...item.item.chars]
  const label = phase === 'recording' ? 'Stop recording' : judgement ? 'Try again' : 'Record'
  const line = (tone: number | undefined, index: number): string => {
    const prefix = expected.length === 2 ? (index === 0 ? 'First syllable: ' : 'Second syllable: ') : ''
    if (tone === undefined) return prefix + 'Heard no clear tone, expected tone ' + expected[index]
    return prefix + (tone === expected[index] ? 'Heard tone ' + tone + ' ✓' : 'Heard tone ' + tone + ', expected tone ' + expected[index])
  }
  return <section className="panel tt-card" aria-labelledby="tt-q">
    <CloseButton onClose={onClose} />
    <p className="eyebrow accent" id="tt-q">Say the tone {at + 1} of {round.length} · {SPEAK_STAGE_NAME[stage]}</p>
    <p className="engine-instruction small">{stage === 2 ? 'Listen to the word, then say it' : 'Listen to the syllable, then say it'}</p>
    <div>
      <p className="tt-speak-word" lang={getPack().learningTag}>{chars.map((char, index) => <span key={index} className={colours ? toneClass(expected[index] ?? expected[0]) : undefined}>{char}</span>)}</p>
      <p className="tt-speak-pinyin">{syllables.map((syllable, index) => <span key={index} className={colours ? toneClass(syllable.tone) : undefined}>{index > 0 && ' '}{syllable.text}</span>)}</p>
    </div>
    <button type="button" className="button secondary tt-play" onClick={() => void play()} disabled={playing || phase !== 'ready'} aria-label={playing ? 'Playing the model' : 'Play the model again'}><Play size={18} aria-hidden="true" /> {playing ? 'Playing…' : 'Play the model'}</button>
    <button type="button" className="button primary tt-record" disabled={playing || phase === 'judging'} onClick={() => void record()}>
      {phase === 'recording' ? <Square size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />} {label}</button>
    <Meter level={level} />
    {/* The action row: Stop and Next. Judging never moves it; the feedback and the chart open below it. */}
    <div className="answer-actions"><button type="button" className="button secondary" onClick={onExit}><ArrowLeft size={16} aria-hidden="true" /> Stop</button>
      <button type="button" className={'button primary check-answer-button' + (judgement ? (judgement.correct ? ' answer-result-correct' : ' answer-result-incorrect') : '')} disabled={!counted} onClick={next}>{at + 1 >= round.length ? 'Finish' : 'Next'}</button></div>
    {quiet && <p className="notice" role="status">Didn't catch that, try again a bit louder.</p>}
    {mic && <MicNote problem={mic} onListening={onListening} />}
    {trouble && <p className="notice" role="alert">{trouble}</p>}
    {judgement && <div className={'notice answer-feedback' + (judgement.correct ? ' success' : '')} role="status">
      {expected.map((_, index) => <p key={index}><strong>{line(judgement.heard[index], index)}</strong></p>)}
      {judgement.hint && <p className="small">{judgement.hint}</p>}
      {judgement.provisional && <p className="small muted">Your range is a guess from this one recording. <button type="button" className="link-button" onClick={onRecalibrate}>Calibrate</button> for fairer results.</p>}
      {(model?.some(Boolean) || judgement.curves.some(Boolean)) && <>
        <ToneCurveChart syllables={expected.length === 2 ? 2 : 1} series={[
          { id: 'heard', label: 'Model', tones: expected, curves: model ?? [] },
          { id: 'you', label: 'You', tones: expected, curves: judgement.curves, colour: YOU_COLOUR }]} />
        <p className="tt-legend small"><span><span className="tt-key" data-series="heard" style={{ color: 'var(--tone-' + expected[0] + ')' }} aria-hidden="true" /> Model</span>
          <span><span className="tt-key" data-series="you" style={{ color: YOU_COLOUR }} aria-hidden="true" /> You</span></p></>}
    </div>}
  </section>
}

export const SPEAK_ROUND_LENGTH = SPEAK_ROUND_SIZE
