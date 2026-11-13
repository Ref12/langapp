import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Play, XCircle } from 'lucide-react'
import { PageHeading } from '../components/shared'
import { toneClass } from '../components/tone-colour-context'
import { getPack } from '../core/language'
import { loadToneManifest, type ToneManifest } from '../core/tone-trainer/manifest'
import { playClip } from '../core/tone-trainer/play'
import { contrastPlan, type ContrastPlan } from '../core/tone-trainer/contrast'
import { confusionRows, pickRound, recordAnswer, ROUND_SIZE, stageAccuracy, STAGE_NAME, STAGES, UNLOCK_ACCURACY, UNLOCK_WINDOW, unlockedStages, type RoundItem, type TrainerProgress, type TrainerStage } from '../core/tone-trainer/engine'
import { loadTrainerProgress, saveTrainerAnswer } from '../core/tone-trainer/store'
import { withTone } from '../core/pinyin'
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
        {mark === 'right' && <span className="small"><CheckCircle2 size={14} aria-hidden="true" /> Heard</span>}{mark === 'wrong' && <span className="small"><XCircle size={14} aria-hidden="true" /> Your answer</span>}
      </button>
    })}
  </div>
}

function Round({ manifest, stage, progress, onDone, onExit }: { manifest: ToneManifest; stage: TrainerStage; progress: TrainerProgress; onDone: (progress: TrainerProgress, right: number) => void; onExit: () => void }) {
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
  const item: RoundItem | undefined = round[at]
  const syllables = item?.item.tones.length ?? 1
  const play = useCallback(async () => {
    if (!item) return
    setPlaying(true); setTrouble('')
    try { await playClip(item.item.clips[item.voice].file) } catch { setTrouble('The sound could not be played. Check your connection and try again.') } finally { setPlaying(false) }
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
    setContrastPlaying(true); setTrouble('')
    try { await playClip(plan.heard.file); if (plan.picked) await playClip(plan.picked.file) } catch { setTrouble('The sound could not be played. Check your connection and try again.') } finally { setContrastPlaying(false) }
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
    if (at + 1 >= round.length) { onDone(local, right); return }
    setAt(at + 1); setChosen([]); setResult(undefined); setContrast(undefined)
  }
  const pickers = stage === 3 ? [1, 2, 3, 4, 5] : options
  return <section className="panel tt-card" aria-labelledby="tt-q">
    <p className="eyebrow accent" id="tt-q">Question {at + 1} of {round.length} · {STAGE_NAME[stage]}</p>
    <p className="engine-instruction small">{stage === 3 ? 'Listen to the word and pick the tone of each syllable' : 'Listen and pick the tone'}</p>
    <button type="button" className="button primary tt-play" onClick={() => void play()} disabled={playing} aria-label={playing ? 'Playing the sound' : 'Play the sound again'}><Play size={18} aria-hidden="true" /> {playing ? 'Playing…' : 'Play again'}</button>
    {trouble && <p className="notice" role="alert">{trouble}</p>}
    {slots.map(slot => <div key={slot} className="tt-slot">
      {slots.length > 1 && <p className="small muted">{slot === 0 ? 'First syllable' : 'Second syllable'}</p>}
      <ToneButtons options={pickers} chosen={chosen[slot]} locked={result !== undefined} result={result} heard={heardTones[slot]} onPick={tone => setChosen(old => { const copy = [...old]; copy[slot] = tone; return copy })} />
    </div>)}
    {result !== undefined && <div className={'notice answer-feedback' + (result ? ' success' : '')} role="status">
      <p>{result ? 'Right.' : 'Not quite.'} You heard <span lang={getPack().learningTag} className="tt-word">{item.item.chars.split('').map((char, index) => <span key={index} className={toneClass(heardTones[index] ?? heardTones[0])}>{char}</span>)}</span>, <span className="tt-pinyin">{item.item.pinyin.split(' ').map((syllable, index) => { const m = /^([a-z]+)([1-5])$/.exec(syllable); return <span key={index} className={toneClass(Number(m?.[2] ?? 5))}>{index > 0 && ' '}{m ? withTone(m[1], m[2]) : syllable}</span> })}</span>.</p>
      <p className="small muted">{heardTones.map(toneLabel).join(' then ')}.</p>
      {contrast && <div className="tt-contrast" aria-label="The right tone and the one you picked">
        <p className="tt-contrast-line"><strong>You heard:</strong> <span className="tt-pinyin">{contrast.heard.label}</span></p>
        {contrast.picked ? <p className="tt-contrast-line"><strong>You picked:</strong> <span className="tt-pinyin">{contrast.picked.label}</span></p>
          : <p className="small muted">There is no recording of {syllableOf(item.item, chosen[0])} in any voice, so only the right tone plays.</p>}
        {contrast.voiceChanged && <p className="small muted">Both are in another voice, because this voice has no recording of the tone you picked.</p>}
        <button type="button" className="button secondary" onClick={() => void playContrast(contrast)} disabled={contrastPlaying}><Play size={16} aria-hidden="true" /> {contrastPlaying ? 'Playing…' : contrast.picked ? 'Hear both again' : 'Hear it again'}</button>
      </div>}</div>}
    <div className="answer-actions"><button type="button" className="button secondary" onClick={onExit}><ArrowLeft size={16} aria-hidden="true" /> Stop</button>
      <button type="button" className={'button primary check-answer-button' + (result === undefined ? '' : result ? ' answer-result-correct' : ' answer-result-incorrect')} disabled={result === undefined && !ready} onClick={result === undefined ? () => void check() : next}>{result === undefined ? 'Check answer' : at + 1 >= round.length ? 'Finish' : 'Next'}</button></div>
  </section>
}

const syllableOf = (item: RoundItem['item'], tone: number): string => withTone(item.pinyin.replace(/[1-5]$/, ''), String(tone))

export function ToneTrainer() {
  const [manifest, setManifest] = useState<ToneManifest | null | undefined>()
  const [progress, setProgress] = useState<TrainerProgress>()
  const [stage, setStage] = useState<TrainerStage>()
  const [summary, setSummary] = useState<{ right: number; stage: TrainerStage }>()
  useEffect(() => { void loadToneManifest().then(found => setManifest(found ?? null)); void loadTrainerProgress().then(setProgress) }, [])
  const unlocked = progress ? unlockedStages(progress.answers) : [1]
  const rows = progress ? confusionRows(progress).slice(0, 3) : []
  return <div className="page tone-trainer">
    <PageHeading eyebrow="Practice" title="Hear the tones">Listen to a syllable or a word and pick its tone. Rounds are {ROUND_SIZE} sounds from four voices.</PageHeading>
    <p><a className="text-link" href="#practice">Back to Practice</a></p>
    {manifest === undefined && <p role="status" className="muted">Loading the sounds…</p>}
    {manifest === null && <p className="notice" role="alert">The sounds could not be loaded. Open the trainer once while online; after that it works offline.</p>}
    {manifest && progress && stage === undefined && <section className="panel" aria-labelledby="tt-stages"><h2 id="tt-stages">Pick a stage</h2>
      {summary && <p className="notice success" role="status">Round finished: {summary.right} of {ROUND_SIZE} right in {STAGE_NAME[summary.stage]}.</p>}
      <ul className="dr-rows">{STAGES.map(entry => { const accuracy = stageAccuracy(progress.answers, entry); const open = unlocked.includes(entry)
        return <li key={entry}><div><strong>Stage {entry}: {STAGE_NAME[entry]}</strong>
          <span className="small muted">{entry === 1 ? 'One syllable, two tones to choose from.' : entry === 2 ? 'One syllable, any of the four tones.' : 'A two-syllable word: a tone for each syllable.'}{' '}
            {open ? (accuracy === undefined ? 'Unlocks the next stage at ' + Math.round(UNLOCK_ACCURACY * 100) + '% over ' + UNLOCK_WINDOW + ' answers.' : 'Last ' + UNLOCK_WINDOW + ': ' + Math.round(accuracy * 100) + '% right.') : 'Locked: reach ' + Math.round(UNLOCK_ACCURACY * 100) + '% over ' + UNLOCK_WINDOW + ' answers in stage ' + (entry - 1) + '.'}</span></div>
          <button type="button" className="button primary" disabled={!open} aria-label={'Start stage ' + entry} onClick={() => { setSummary(undefined); setStage(entry) }}>Start</button></li> })}</ul>
      {rows.length > 0 && <p className="small muted">You mix up most: {rows.map(row => 'tone ' + row.heard + ' heard as tone ' + row.chosen + ' (' + row.count + ')').join(', ')}. These come up more often.</p>}
    </section>}
    {manifest && progress && stage !== undefined && <Round key={stage + ':' + (summary ? 1 : 0)} manifest={manifest} stage={stage} progress={progress} onExit={() => setStage(undefined)}
      onDone={(next, right) => { setProgress(next); setSummary({ right, stage }); setStage(undefined) }} />}
  </div>
}
