import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Play, X, XCircle } from 'lucide-react'
import type { LevelCurve } from '../core/tone-trainer/pitch'
import { ToneCurveChart } from './ToneCurveChart'
import { toneClass } from '../components/tone-colour-context'
import { getPack } from '../core/language'
import { loadToneManifest, type ToneManifest } from '../core/tone-trainer/manifest'
import { clipPitchCurves, playClip, speechRatePreference } from '../core/tone-trainer/play'
import { contrastPlan, type ContrastPlan } from '../core/tone-trainer/contrast'
import { confusionRows, pickRound, recordAnswer, ROUND_SIZE, stageAccuracy, STAGE_NAME, STAGES, UNLOCK_ACCURACY, UNLOCK_WINDOW, unlockedStages, type RoundItem, type TrainerProgress, type TrainerStage } from '../core/tone-trainer/engine'
import { loadTrainerProgress, saveTrainerAnswer } from '../core/tone-trainer/store'
import { withTone } from '../core/pinyin'
import { SpeakCalibration, SpeakRound } from './ToneSpeak'
import { SPEAK_ROUND_SIZE, SPEAK_STAGE_NAME, SPEAK_STAGES, speakAccuracy, speakStageUnlocked, type SpeakStage } from '../core/tone-trainer/speaking'
import { TONE_WORDS, toneLabel } from '../core/tone-trainer/engine'


/** Tone buttons are neutral (no colour, no pinyin of the answer) until the answer is checked; the tone's contour is spelled in text, never by colour alone. */
export function ToneButtons({ options, chosen, locked, result, heard, onPick }: { options: number[]; chosen?: number; locked: boolean; result?: boolean; heard?: number; onPick: (tone: number) => void }) {
  return <div className="tt-options" role="group" aria-label="Which tone?">
    {options.map(tone => {
      const checked = result !== undefined
      const mark = checked && tone === heard ? 'right' : checked && tone === chosen ? 'wrong' : undefined
      return <button key={tone} type="button" className={'button secondary tt-tone' + (chosen === tone ? ' selected' : '')} aria-pressed={chosen === tone} disabled={locked} data-mark={mark}
        onClick={() => onPick(tone)}>
        <span className="tt-tone-name">{tone === 5 ? 'Neutral' : 'Tone ' + tone}</span><span className="small muted">{TONE_WORDS[tone]}</span>
        {/* The mark's line is always there, so marking the answer never makes a button taller. */}
        <span className="small tt-mark">{mark === 'right' ? <><CheckCircle2 size={14} aria-hidden="true" /> Heard</> : mark === 'wrong' ? <><XCircle size={14} aria-hidden="true" /> Your answer</> : '\u00a0'}</span>
      </button>
    })}
  </div>
}

function Round({ manifest, stage, progress, onDone, onExit, onClose }: { manifest: ToneManifest; stage: TrainerStage; progress: TrainerProgress; onDone: (progress: TrainerProgress, right: number) => void; onExit: () => void; onClose: () => void }) {
  const round = useMemo(() => pickRound(manifest, stage, progress, Math.random), [manifest, stage]) // eslint-disable-line react-hooks/exhaustive-deps
  const [at, setAt] = useState(0)
  const [chosen, setChosen] = useState<number[]>([])
  const [result, setResult] = useState<boolean>()
  const [right, setRight] = useState(0)
  const [local, setLocal] = useState(progress)
  const [playing, setPlaying] = useState(false)
  const [trouble, setTrouble] = useState('')
  const [contrast, setContrast] = useState<ContrastPlan>()
  const [contrastPlaying, setContrastPlaying] = useState(false)
  /** Which clip of "Hear both again" is playing: 0 the right tone, 1 the picked one. */
  const [contrastClip, setContrastClip] = useState<0 | 1>()
  const contrastRun = useRef<AbortController>()
  useEffect(() => () => contrastRun.current?.abort(), [])
  const item: RoundItem | undefined = round[at]
  /** The pitch curves of the heard clip, and of the two contrast clips, tracked in the browser once the answer is checked (never before, so playback is not delayed). */
  const [pitch, setPitch] = useState<{ heard?: (LevelCurve | null)[]; picked?: (LevelCurve | null)[]; contrastHeard?: (LevelCurve | null)[] }>({})
  useEffect(() => {
    setPitch({})
    if (result === undefined || !item) return
    let live = true
    const n = item.item.tones.length === 2 ? 2 : 1
    void clipPitchCurves(item.item.clips[item.voice].file, item.voice, n).then(curves => { if (live) setPitch(old => ({ ...old, heard: curves })) })
    if (contrast) {
      void clipPitchCurves(contrast.heard.file, contrast.voice, 1).then(curves => { if (live) setPitch(old => ({ ...old, contrastHeard: curves })) })
      if (contrast.picked) void clipPitchCurves(contrast.picked.file, contrast.voice, 1).then(curves => { if (live) setPitch(old => ({ ...old, picked: curves })) })
    }
    return () => { live = false }
  }, [result, contrast, item])
  const syllables = item?.item.tones.length ?? 1
  const play = useCallback(async () => {
    if (!item) return
    setPlaying(true); setTrouble('')
    try { await playClip(item.item.clips[item.voice].file, undefined, await speechRatePreference()) } catch { setTrouble('The sound could not be played. Check your connection and try again.') } finally { setPlaying(false) }
  }, [item])
  // The sound plays by itself when a question opens.
  const played = useRef(-1)
  useEffect(() => { if (played.current !== at) { played.current = at; void play() } }, [at, play])
  if (!item) return <p role="status">No sounds are available.</p>
  const options = item.options ?? [1, 2, 3, 4]
  const slots = item.item.tones.length === 2 ? [0, 1] : [0]
  const heardTones = item.item.tones
  const ready = chosen.filter(tone => tone !== undefined).length === syllables && chosen.length === syllables
  const playContrast = async (plan: ContrastPlan) => {
    contrastRun.current?.abort()
    const run = new AbortController(); contrastRun.current = run
    setContrastPlaying(true); setTrouble(''); setContrastClip(plan.picked ? 0 : undefined)
    try {
      const rate = await speechRatePreference()
      await playClip(plan.heard.file, run.signal, rate)
      if (plan.picked && !run.signal.aborted) { setContrastClip(1); await playClip(plan.picked.file, run.signal, rate) }
    } catch { setTrouble('The sound could not be played. Check your connection and try again.') } finally { if (!run.signal.aborted) { setContrastPlaying(false); setContrastClip(undefined) } }
  }
  const check = async () => {
    const correct = heardTones.every((tone, index) => tone === chosen[index])
    setResult(correct); if (correct) setRight(value => value + 1)
    if (!correct && stage !== 3) { const plan = contrastPlan(manifest, item.item, item.voice, chosen[0]); setContrast(plan); if (plan) void playContrast(plan) }
    const answer = { stage, item: item.item.id, voice: item.voice, heard: heardTones, chosen: [...chosen], correct, at: Date.now() }
    setLocal(recordAnswer(local, answer))
    await saveTrainerAnswer(answer)
  }
  const next = () => {
    contrastRun.current?.abort(); setContrastPlaying(false); setContrastClip(undefined)
    if (at + 1 >= round.length) { onDone(local, right); return }
    setAt(at + 1); setChosen([]); setResult(undefined); setContrast(undefined)
  }
  const pickers = stage === 3 ? [1, 2, 3, 4, 5] : options
  return <section className="panel tt-card" aria-labelledby="tt-q">
    <CloseButton onClose={onClose} />
    <p className="eyebrow accent" id="tt-q">Question {at + 1} of {round.length} · {STAGE_NAME[stage]}</p>
    <p className="engine-instruction small">{stage === 3 ? 'Listen to the word and pick the tone of each syllable' : 'Listen and pick the tone'}</p>
    <button type="button" className="button primary tt-play" onClick={() => void play()} disabled={playing} aria-label={playing ? 'Playing the sound' : 'Play the sound again'}><Play size={18} aria-hidden="true" /> {playing ? 'Playing…' : 'Play again'}</button>
    {slots.map(slot => <div key={slot} className="tt-slot">
      {slots.length > 1 && <p className="small muted">{slot === 0 ? 'First syllable' : 'Second syllable'}</p>}
      <ToneButtons options={pickers} chosen={chosen[slot]} locked={result !== undefined} result={result} heard={heardTones[slot]} onPick={tone => setChosen(old => { const copy = [...old]; copy[slot] = tone; return copy })} />
    </div>)}
    {/* The action row comes before the feedback and the chart, which open below it: checking an answer never moves Stop or Next (as in the practice engine). */}
    <div className="answer-actions"><button type="button" className="button secondary" onClick={onExit}><ArrowLeft size={16} aria-hidden="true" /> Stop</button>
      <button type="button" className={'button primary check-answer-button' + (result === undefined ? '' : result ? ' answer-result-correct' : ' answer-result-incorrect')} disabled={result === undefined && !ready} onClick={result === undefined ? () => void check() : next}>{result === undefined ? 'Check answer' : at + 1 >= round.length ? 'Finish' : 'Next'}</button></div>
    {result !== undefined && <div className={'notice answer-feedback' + (result ? ' success' : '')} role="status">
      <p>{result ? 'Right.' : 'Not quite.'} You heard <span lang={getPack().learningTag} className="tt-word">{item.item.chars.split('').map((char, index) => <span key={index} className={toneClass(heardTones[index] ?? heardTones[0])}>{char}</span>)}</span>, <span className="tt-pinyin">{item.item.pinyin.split(' ').map((syllable, index) => { const m = /^([a-z]+)([1-5])$/.exec(syllable); return <span key={index} className={toneClass(Number(m?.[2] ?? 5))}>{index > 0 && ' '}{m ? withTone(m[1], m[2]) : syllable}</span> })}</span>.</p>
      <p className="small muted">{heardTones.map(toneLabel).join(' then ')}.</p>
      {!contrast && pitch.heard?.some(Boolean) && <ToneCurveChart syllables={syllables === 2 ? 2 : 1} series={[{ id: 'heard', tones: heardTones, curves: pitch.heard }]} />}
      {contrast && <div className="tt-contrast" aria-label="The right tone and the one you picked">
        <p className={'tt-contrast-line' + (contrastClip === 0 ? ' is-playing' : contrastClip === 1 ? ' is-dimmed' : '')}><span className="tt-key" data-series="heard" style={{ color: 'var(--tone-' + (heardTones[0] <= 4 ? heardTones[0] : 5) + ')' }} aria-hidden="true" /> <strong>You heard:</strong> <span className="tt-pinyin">{contrast.heard.label}</span></p>
        {contrast.picked ? <p className={'tt-contrast-line' + (contrastClip === 1 ? ' is-playing' : contrastClip === 0 ? ' is-dimmed' : '')}><span className="tt-key" data-series="picked" style={{ color: 'var(--tone-' + (chosen[0] <= 4 ? chosen[0] : 5) + ')' }} aria-hidden="true" /> <strong>You picked:</strong> <span className="tt-pinyin">{contrast.picked.label}</span></p>
          : <p className="small muted">There is no recording of {syllableOf(item.item, chosen[0])} in any voice, so only the right tone plays.</p>}
        {pitch.contrastHeard?.[0] && <ToneCurveChart syllables={1} series={[
          { id: 'heard', label: 'You heard', tones: heardTones, curves: pitch.contrastHeard ?? [], state: contrastClip === 0 ? 'playing' : contrastClip === 1 ? 'dimmed' : undefined },
          ...(pitch.picked?.[0] ? [{ id: 'picked' as const, label: 'You picked', tones: [chosen[0]], curves: pitch.picked, state: contrastClip === 1 ? 'playing' as const : contrastClip === 0 ? 'dimmed' as const : undefined }] : [])]} />}
        {contrast.voiceChanged && <p className="small muted">Both are in another voice, because this voice has no recording of the tone you picked.</p>}
        <button type="button" className="button secondary" onClick={() => void playContrast(contrast)} disabled={contrastPlaying}><Play size={16} aria-hidden="true" /> {contrastPlaying ? 'Playing…' : contrast.picked ? 'Hear both again' : 'Hear it again'}</button>
      </div>}</div>}
    {trouble && <p className="notice" role="alert">{trouble}</p>}
  </section>
}

/** The X at the top right of the card. */
function CloseButton({ onClose }: { onClose: () => void }) {
  return <button type="button" className="icon-button tt-close" aria-label="Close the tone trainer" onClick={onClose}><X size={20} aria-hidden="true" /></button>
}

const syllableOf = (item: RoundItem['item'], tone: number): string => withTone(item.pinyin.replace(/[1-5]$/, ''), String(tone))

export function ToneTrainer() {
  const [manifest, setManifest] = useState<ToneManifest | null | undefined>()
  const [progress, setProgress] = useState<TrainerProgress>()
  const [stage, setStage] = useState<TrainerStage>()
  const [summary, setSummary] = useState<{ right: number; stage: TrainerStage }>()
  /** The speaking practice: the stage to run (after the calibration when there is none yet), whether the calibration is open, and whether the learner skipped it. */
  const [speakStage, setSpeakStage] = useState<SpeakStage>()
  const [calibrating, setCalibrating] = useState(false)
  const [skipped, setSkipped] = useState(false)
  const [speakSummary, setSpeakSummary] = useState<{ right: number; stage: SpeakStage }>()
  useEffect(() => { void loadToneManifest().then(found => setManifest(found ?? null)); void loadTrainerProgress().then(setProgress) }, [])
  /** The X: stops a round (as Stop does) and goes back to Practice. */
  const close = () => { setStage(undefined); setSpeakStage(undefined); setCalibrating(false); window.location.hash = '#practice' }
  const toListening = () => { setSpeakStage(undefined); setCalibrating(false) }
  const speaking = progress?.speaking
  const speakOpen = (entry: SpeakStage) => speakStageUnlocked(speaking?.answers ?? [], entry)
  const showPicker = manifest && progress && stage === undefined && speakStage === undefined && !calibrating
  const unlocked = progress ? unlockedStages(progress.answers) : [1]
  const rows = progress ? confusionRows(progress).slice(0, 3) : []
  return <div className="page tone-trainer">
    {manifest === undefined && <p role="status" className="muted">Loading the sounds…</p>}
    {manifest === null && <p className="notice" role="alert">The sounds could not be loaded. Open the trainer once while online; after that it works offline.</p>}
    {showPicker && <section className="panel tt-card" aria-labelledby="tt-stages"><CloseButton onClose={close} /><h2 id="tt-stages">Pick a stage</h2>
      {summary && <p className="notice success" role="status">Round finished: {summary.right} of {ROUND_SIZE} right in {STAGE_NAME[summary.stage]}.</p>}
      <ul className="dr-rows">{STAGES.map(entry => { const accuracy = stageAccuracy(progress.answers, entry); const open = unlocked.includes(entry)
        return <li key={entry}><div><strong>Stage {entry}: {STAGE_NAME[entry]}</strong>
          <span className="small muted">{entry === 1 ? 'One syllable, two tones to choose from.' : entry === 2 ? 'One syllable, any of the four tones.' : 'A two-syllable word: a tone for each syllable.'}{' '}
            {open ? (accuracy === undefined ? 'Unlocks the next stage at ' + Math.round(UNLOCK_ACCURACY * 100) + '% over ' + UNLOCK_WINDOW + ' answers.' : 'Last ' + UNLOCK_WINDOW + ': ' + Math.round(accuracy * 100) + '% right.') : 'Locked: reach ' + Math.round(UNLOCK_ACCURACY * 100) + '% over ' + UNLOCK_WINDOW + ' answers in stage ' + (entry - 1) + '.'}</span></div>
          <button type="button" className="button primary" disabled={!open} aria-label={'Start stage ' + entry} onClick={() => { setSummary(undefined); setStage(entry) }}>Start</button></li> })}</ul>
      <h3 id="tt-say">Say the tone</h3>
      {speakSummary && <p className="notice success" role="status">Round finished: {speakSummary.right} of {SPEAK_ROUND_SIZE} right first time in {SPEAK_STAGE_NAME[speakSummary.stage]}.</p>}
      <ul className="dr-rows" aria-labelledby="tt-say">{SPEAK_STAGES.map(entry => { const accuracy = speakAccuracy(speaking?.answers ?? [], entry); const open = speakOpen(entry)
        return <li key={entry}><div><strong>Say the tone {entry}: {SPEAK_STAGE_NAME[entry]}</strong>
          <span className="small muted">{entry === 1 ? 'Hear a syllable, say it, and see your pitch over the model\'s.' : 'Hear a word, say it, and each syllable is judged.'}{' '}
            {open ? (accuracy === undefined ? 'Unlocks the next at ' + Math.round(UNLOCK_ACCURACY * 100) + '% over ' + UNLOCK_WINDOW + ' first tries.' : 'Last ' + UNLOCK_WINDOW + ': ' + Math.round(accuracy * 100) + '% right.') : 'Locked: reach ' + Math.round(UNLOCK_ACCURACY * 100) + '% over ' + UNLOCK_WINDOW + ' first tries in Say the tone 1.'}</span></div>
          <button type="button" className="button primary" disabled={!open} aria-label={'Start Say the tone ' + entry} onClick={() => { setSpeakSummary(undefined); setSpeakStage(entry); if (!speaking?.range && !skipped) setCalibrating(true) }}>Start</button></li> })}</ul>
      <p className="small muted">{speaking?.range ? 'Your range: ' + speaking.range[0] + '–' + speaking.range[1] + ' Hz. ' : 'No range yet: the first time you say a tone you will be asked to say mā, má, mǎ, mà. '}
        <button type="button" className="button secondary" onClick={() => { setSpeakStage(undefined); setCalibrating(true) }}>Recalibrate</button></p>
      {rows.length > 0 && <p className="small muted">You mix up most: {rows.map(row => 'tone ' + row.heard + ' heard as tone ' + row.chosen + ' (' + row.count + ')').join(', ')}. These come up more often.</p>}
    </section>}
    {manifest && progress && calibrating && <SpeakCalibration hasRange={!!speaking?.range} onClose={close} onListening={toListening}
      onExit={() => { setCalibrating(false); setSpeakStage(undefined) }} onSkip={() => { setSkipped(true); setCalibrating(false) }}
      onRange={range => { setProgress({ ...progress, speaking: { answers: [], ...progress.speaking, range, rangeAt: Date.now() } }); setCalibrating(false) }} />}
    {manifest && progress && speakStage !== undefined && !calibrating && <SpeakRound key={speakStage + ':' + (speakSummary ? 1 : 0)} manifest={manifest} stage={speakStage} progress={progress} onExit={() => setSpeakStage(undefined)} onClose={close} onListening={toListening}
      onRecalibrate={() => setCalibrating(true)} onDone={(next, right) => { setProgress(next); setSpeakSummary({ right, stage: speakStage }); setSpeakStage(undefined) }} />}
    {manifest && progress && stage !== undefined && <Round key={stage + ':' + (summary ? 1 : 0)} manifest={manifest} stage={stage} progress={progress} onExit={() => setStage(undefined)} onClose={close}
      onDone={(next, right) => { setProgress(next); setSummary({ right, stage }); setStage(undefined) }} />}
  </div>
}
