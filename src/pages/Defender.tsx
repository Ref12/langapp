import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, Info, Pause, Play, Shield } from 'lucide-react'
import { useCatalog } from '../components/study/useCatalog'
import type { PageProps } from '../components/shared'
import { useDefender } from '../components/games/useDefender'
import { allowsPinyinAnnotations, answerText, defenderKnowledgeWords, defenderSettingsSchema, directionForms, leadingWord, nextDefenderWords, promptText, SHIELDS, type Settings, type Word } from '../core/games/defender'
import type { WordForm } from '../../shared/defender-engine'
import './defender.css'

const directionNames = { chinese: 'Chinese → English', english: 'English → Chinese', 'character-pinyin': 'Chinese → Pinyin', 'pinyin-character': 'Pinyin → Chinese' }
function WordFace({ word, form, pinyin }: { word: Word; form: WordForm; pinyin: boolean }) {
  return <span lang={form === 'character' ? 'zh-Hans' : form === 'pinyin' ? 'zh-Latn' : 'en'} className={`defender-word-face${word.character.length > 2 ? ' long-word' : ''}`}>
    {pinyin && form === 'character' ? <ruby>{word.character}<rt lang="zh-Latn">{word.pinyin}</rt></ruby> : word[form]}
  </span>
}

export function Defender({ workspace }: PageProps) {
  const { catalog, error: catalogError } = useCatalog()
  const words = useMemo(() => catalog ? defenderKnowledgeWords(catalog, workspace) : [], [catalog, workspace])
  const play = useDefender()
  const [settings, setSettings] = useState<Settings>({ mode: 'tap', direction: 'chinese', pace: 'standard', showPinyin: false })
  const [setup, setSetup] = useState(false)
  const [answer, setAnswer] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const game = play.game, run = game?.run
  const actual = run?.settings ?? settings
  const forms = directionForms[actual.direction]
  const target = run && leadingWord(run)
  const playing = run?.phase === 'playing'
  const over = run?.phase === 'over'
  const between = game?.stage === 'between'
  const upcoming = useMemo(() => game && between ? nextDefenderWords(game) : [], [game, between])
  const showSetup = play.loaded && (!game || setup)
  const inputMode = actual.mode
  useEffect(() => {
    if (playing && inputMode === 'type') input.current?.focus({ preventScroll: true })
  }, [playing, inputMode])
  const start = async () => {
    if (await play.start(words, settings)) { setSetup(false); setAnswer('') }
  }
  const submit = (text: string) => {
    if (play.submit(text) === 'hit') setAnswer('')
  }
  return <div className="defender-player" onKeyDown={event => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || composing.current || document.querySelector('dialog[open]')) return
    if (playing) play.pause()
    else if (!between && !over && !showSetup) play.resume()
  }}>
    <header className="defender-heading"><a href="#games" className="back-link"><ArrowLeft size={16} /> Games</a><h1>Word Defender</h1>{showSetup && <Shield size={24} className="accent" />}</header>
    {catalogError && <p className="notice error" role="alert">Vocabulary could not be loaded. {catalogError}</p>}
    {play.error && <div className="notice error" role="alert"><p>{play.error}</p><div className="button-row">
      {game && <button className="button secondary" disabled={play.saving} onClick={play.retry}>Retry saving</button>}
      {play.invalid && <button className="button secondary" disabled={play.saving} onClick={() => void play.discardInvalid()}>Discard invalid Defender run</button>}
      <button className="button secondary" onClick={() => window.location.reload()}>Reload saved run</button>
    </div></div>}
    {!play.loaded && <p role="status">Opening Defender...</p>}
    {showSetup ? <section className="panel defender-setup" aria-label="Defender setup">
      <h2>Hold the line.</h2><p>Match the highlighted leading word before it reaches the shield.</p>
      <div className="defender-settings">
        <label>Controls<select value={settings.mode} disabled={play.saving} onChange={event => setSettings(defenderSettingsSchema.parse({ ...settings, mode: event.target.value }))}>
          <option value="tap">Tap an answer</option><option value="type">Type an answer</option>
        </select></label>
        <label>Direction<select value={settings.direction} disabled={play.saving} onChange={event => setSettings(defenderSettingsSchema.parse({ ...settings, direction: event.target.value }))}>
          {Object.entries(directionNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        <label>Starting pace<select value={settings.pace} disabled={play.saving} onChange={event => setSettings(defenderSettingsSchema.parse({ ...settings, pace: event.target.value }))}>
          <option value="gentle">Gentle</option><option value="standard">Standard</option><option value="brisk">Brisk</option>
        </select></label>
      </div>
      <label className="toggle"><input type="checkbox" checked={settings.showPinyin ?? false} disabled={play.saving || !allowsPinyinAnnotations(settings.direction)}
        onChange={event => setSettings({ ...settings, showPinyin: event.target.checked })} /> Show pinyin over Chinese words</label>
      <p>{catalog ? `${words.length} short, distinct words available from your knowledge set.` : 'Loading your knowledge set...'}</p>
      <p className="small muted">Each wave uses up to 12 words. Smaller sets use the words you have, even just one. Missed targets return before new words; the bank changes only after every incoming word is resolved.</p>
      {catalog && !words.length && <p>Add vocabulary in <a className="text-link" href="#dictionary">Dictionary</a> or start New in Lessons. Short entries with distinct characters, pinyin, and meanings are used so the choices are readable and unambiguous.</p>}
      {setup && <p>Starting replaces this profile's saved Defender run.</p>}
      <div className="button-row"><button className="button primary" disabled={play.saving || !catalog || !words.length || play.invalid || Boolean(play.error)} onClick={() => void start()}>Start Defender</button>
        {setup && <button className="button secondary" disabled={play.saving} onClick={() => setSetup(false)}>Keep current run</button>}</div>
    </section> : game && run && <>
      <section className="defender-arena" aria-label="Defender game">
        <div className="defender-hud">
          <div><span>SCORE</span><strong>{run.score.toString().padStart(4, '0')}</strong></div>
          <div><span>WAVE</span><strong>{run.wave}</strong></div>
          <div className="defender-shields" role="img" aria-label={`${run.shields} of ${SHIELDS} shields`}>
            <span>SHIELD</span><div>{Array.from({ length: SHIELDS }, (_, i) => <i key={i} className={i >= run.shields ? 'lost' : ''} />)}</div>
          </div>
          <button className="icon-button" aria-label={playing ? 'Pause Defender' : 'Resume Defender'} disabled={over || between || play.saving && !playing || Boolean(play.error)}
            onClick={() => playing ? play.pause() : play.resume()}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
        </div>
        <div className="defender-field" role="group" aria-label="Incoming words" data-assistant-protected="true">
          <div className="defender-line" aria-hidden="true"><span>HOLD THE LINE</span></div>
          {run.incoming.map(tile => {
            const word = run.words.find(word => word.id === tile.wordId)!
            return <div className={`defender-incoming${tile.id === target?.id ? ' leading' : ''}${tile.position < .23 ? ' danger' : ''}`}
              key={tile.id} data-defender-tile={tile.id} aria-label={`${tile.id === target?.id ? 'Target' : 'Incoming'}: ${promptText(word, actual.direction)}`}
              style={{ '--position': tile.position, '--lane': tile.lane } as CSSProperties}>
              <WordFace word={word} form={forms.prompt} pinyin={actual.showPinyin === true} />
            </div>
          })}
          {!playing && <div className="defender-overlay">
            <h2>{over ? 'Run complete' : between ? `Wave ${run.wave} cleared` : 'Line holding.'}</h2>
            <p>{over ? `${run.hits} intercepted / best streak ${run.bestStreak}` : between ? `${game.review.length} missed ${game.review.length === 1 ? 'word returns' : 'words return'} in the next wave.` : 'Your run is paused.'}</p>
            <div className="button-row">
              {between ? <button className="button primary" disabled={play.saving || Boolean(play.error)} onClick={() => { setAnswer(''); void play.nextWave() }}>Start wave {run.wave + 1}</button>
                : !over && <button className="button primary" disabled={play.saving || Boolean(play.error)} onClick={play.resume}>Resume</button>}
              {over ? <button className="button primary" disabled={play.saving} onClick={() => { setSettings(actual); setSetup(true) }}>New run</button>
                : <button className="button secondary" disabled={play.saving} onClick={play.end}>End run</button>}
            </div>
          </div>}
        </div>
        <div className="defender-footer"><span>{run.streak} streak</span><span>{run.elapsed >= game.waveEndAt && !between && !over ? 'Clear remaining words to finish this wave' : `${run.words.length} words / leading target only`}</span></div>
      </section>
      {inputMode === 'tap' ? <div className="defender-answer-bank" role="group" aria-label="Defender answers">
        {run.words.map(word => <button key={word.id} className="defender-answer" disabled={!playing || !target || Boolean(play.error)}
          aria-label={`Answer ${answerText(word, actual.direction)}`} onClick={() => submit(answerText(word, actual.direction))}>
          <WordFace word={word} form={forms.answer} pinyin={actual.showPinyin === true} />
        </button>)}
      </div> : <form className="defender-type-form" onSubmit={event => { event.preventDefault(); if (!composing.current) submit(answer) }}>
        <label className="visually-hidden" htmlFor="defender-answer-input">Defender answer</label>
        <input id="defender-answer-input" ref={input} disabled={!playing || Boolean(play.error)} value={answer} onChange={event => setAnswer(event.target.value)}
          maxLength={100} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="send"
          placeholder={forms.answer === 'meaning' ? 'Type the English meaning...' : forms.answer === 'pinyin' ? 'Pinyin: shuǐ or shui3...' : '输入中文...'}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
          onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }} />
        <button className="button primary" type="submit" disabled={!playing || !target || Boolean(play.error)}>Defend</button>
      </form>}
      <p className="defender-feedback" role="status">{play.message}</p>
      {between && <section className="panel defender-wave-review"><h2>Next wave's words</h2>
        <div className="defender-vocabulary">{upcoming.map(word => <div key={word.id}><strong lang="zh-Hans">{word.character}</strong><span>{word.pinyin}</span><span>{word.meaning}</span>{game.review.includes(word.id) && <small>Review from this wave</small>}</div>)}</div>
      </section>}
      <details className="defender-help" onToggle={event => { if (event.currentTarget.open && playing) play.pause('Paused while viewing the rules.') }}>
        <summary aria-label="Rules, saving, and word selection"><Info size={20} /><span>Rules, saving, and word selection</span></summary>
        <p>Words fall toward the shield on mobile and travel right to left on desktop. Only the highlighted leader can be answered. Tap a translation or type the displayed English meaning, Chinese characters, or pinyin. Pinyin accepts tone marks or numbers; tones must match.</p>
        <p>After 60 seconds, spawning stops while you clear the remaining words. The next bank prioritizes missed words, then unseen vocabulary, then other words. It never changes under live targets. Later waves are faster.</p>
        <p>Wrong answers break the streak and retain that target for review. Breaches cost one of five shields and also retain the word. Esc or the pause button pauses; hiding the page or opening navigation pauses automatically.</p>
        <p>Runs checkpoint after answers, breaches, pauses, and every five seconds. Reopening always starts paused. Only this profile's knowledge-set vocabulary is used; changes to that set apply on a new run. No lesson or FSRS progress changes. Defender is not included in profile exports and is cleared by a restore.</p>
      </details>
    </>}
  </div>
}
