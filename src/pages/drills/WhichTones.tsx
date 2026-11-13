import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { AnswerButton } from '../../components/AnswerButton'
import { toneClass } from '../../components/tone-colour-context'
import { withTone } from '../../core/pinyin'
import { getPack } from '../../core/language'
import { playClip } from '../../core/tone-trainer/play'
import type { WhichTonesItem } from '../../core/session/types'
import { toneLabel } from '../../core/tone-trainer/engine'
import { ToneButtons } from '../ToneTrainer'
import type { Outcome, QuestionContext } from './EngineQuestion'

/** Which tones?: hear the word, pick the tone of each syllable. Nothing of the word (characters, pinyin, colour) is shown until Check: the sound is the question. */
export function WhichTones({ exercise, ctx, onDone }: { exercise: WhichTonesItem; ctx: QuestionContext; onDone: (outcome: Outcome) => void }) {
  const [chosen, setChosen] = useState<number[]>([])
  const [result, setResult] = useState<boolean>()
  const [playing, setPlaying] = useState(false)
  const [trouble, setTrouble] = useState('')
  const play = async () => {
    setPlaying(true); setTrouble('')
    try { await playClip(exercise.file) } catch { setTrouble('The sound could not be played. Check your connection and try again.') } finally { setPlaying(false) }
  }
  const started = useRef(false)
  useEffect(() => { if (!started.current) { started.current = true; void play() } })
  const ready = chosen.length === exercise.tones.length && chosen.every(tone => tone !== undefined)
  return <div className="tt-card">
    <button type="button" className="button primary tt-play" disabled={playing} onClick={() => void play()} aria-label={playing ? 'Playing the sound' : 'Play the sound again'}><Play size={18} aria-hidden="true" /> {playing ? 'Playing…' : 'Play again'}</button>
    {trouble && <p className="notice" role="alert">{trouble}</p>}
    {exercise.tones.map((tone, slot) => <div key={slot} className="tt-slot"><p className="small muted">{slot === 0 ? 'First syllable' : 'Second syllable'}</p>
      <ToneButtons options={[1, 2, 3, 4, 5]} chosen={chosen[slot]} locked={result !== undefined} result={result} heard={tone} onPick={value => setChosen(old => { const copy = [...old]; copy[slot] = value; return copy })} /></div>)}
    {result !== undefined && <div className={'notice answer-feedback' + (result ? ' success' : '')} role="status">
      <p>{result ? 'Right.' : 'Not quite.'} It was <span lang={getPack().learningTag} className="tt-word">{Array.from(exercise.word).map((char, index) => <span key={index} className={toneClass(exercise.tones[index])}>{char}</span>)}</span>, {exercise.pinyin.split(' ').map((syllable, index) => { const m = /^([a-z]+)([1-5])$/.exec(syllable); return <span key={index} className={toneClass(exercise.tones[index])}>{index > 0 && ' '}{m ? withTone(m[1], m[2]) : syllable}</span> })}.</p>
      <p className="small muted">{exercise.tones.map(toneLabel).join(' then ')}.</p></div>}
    <AnswerButton result={result} busy={ctx.busy} ready={ready} onCheck={() => setResult(exercise.tones.every((tone, index) => tone === chosen[index]))} onNext={() => onDone({ correct: !!result })} />
  </div>
}
