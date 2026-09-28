import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Eye, FlaskConical, Info, ListOrdered, RotateCcw, Undo2, Volume2, X } from 'lucide-react'
import { db } from '../core/database'
import type { PageProps } from '../components/shared'
import { useCatalog } from '../components/study/useCatalog'
import { GAME_GROUP_COLORS } from '../core/games/game-colors'
import { buildPotionsLevel, canMovePotion, phraseText, potionsCompletion, potionsLevelParams, potionsRandom, potionStars, POTIONS_MAX_LEVEL, readPotionsGame, readPotionsProgress, type PotionsAction, type PotionsGame, type PotionsProgress } from '../core/games/potions'
import { knownPotionPhrases } from '../core/games/potions-phrases'
import { startPotionsLevel, updatePotions } from '../core/games/potions-store'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech, subscribeSpeechInterruption } from '../core/assistant/speech'
import './potions.css'

const SMOKE = { name: 'Smoke', background: '#d3d6da', border: '#6d7480', ink: '#2c3138' }

function vialColor(game: PotionsGame, phrase: number) {
  return game.hidden && !game.revealed ? SMOKE : GAME_GROUP_COLORS[phrase % GAME_GROUP_COLORS.length]
}

function HearPhrase({ text, speak }: { text: string; speak: (text: string) => void }) {
  return <button type="button" className="icon-button potions-hear" aria-label={`Hear ${text}`} onClick={() => speak(text)}><Volume2 size={16} /></button>
}

function PotionsComplete({ game, stars, last, onClose, onNext, speak }: {
  game: PotionsGame; stars: number; last: boolean; onClose: () => void; onNext: () => void; speak: (text: string) => void
}) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement)
  const alive = useRef(false)
  useEffect(() => {
    const element = dialog.current!
    const previousFocus = opener.current
    const overflow = document.body.style.overflow
    alive.current = true
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => {
      alive.current = false
      element.close()
      document.body.style.overflow = overflow
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !document.querySelector('dialog[open]')) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(<dialog ref={dialog} className="potions-complete" aria-labelledby={`${id}-title`} data-assistant-exclude
    onCancel={event => { event.preventDefault(); onClose() }}
    onClose={event => { if (alive.current && !event.currentTarget.open) onClose() }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <button type="button" className="icon-button potions-complete-close" aria-label="Close level summary" onClick={onClose}><X size={20} /></button>
    <h2 id={`${id}-title`}>Level {game.level} brewed!</h2>
    <p className="potions-stars" aria-label={`${stars} of 3 stars`}>{'\u2605'.repeat(stars)}{'\u2606'.repeat(3 - stars)}</p>
    <p>{game.moves} {game.moves === 1 ? 'pour' : 'pours'}. {stars < 3
      ? 'Finish without revealing the colors or adding a vial for all three stars.'
      : 'A perfect brew.'}</p>
    <ul className="potions-phrase-list">{game.phrases.map(phrase => <li key={phrase.id}>
      <span><strong lang="zh-Hans">{phraseText(phrase)}</strong><span lang="zh-Latn" className="small muted">{phrase.pinyin}</span><span className="small">{phrase.translation}</span></span>
      <HearPhrase text={phraseText(phrase)} speak={speak} />
    </li>)}</ul>
    <p className="small muted">Games do not change lesson scores or review schedules.</p>
    <div className="button-row">
      {!last && <button type="button" className="button primary" autoFocus onClick={onNext}>Next level</button>}
      <button type="button" className="button secondary" onClick={onClose}>View the vials</button>
    </div>
  </dialog>, document.body)
}

function PotionsBoard({ game, busy, run, onLevel, onLevels }: {
  game: PotionsGame; onLevel: (level: number) => void; onLevels: () => void
} & Pick<PageProps, 'busy' | 'run'>) {
  const speechId = useId()
  const speechGeneration = useRef(0)
  const [selected, setSelected] = useState<number>()
  const [message, setMessage] = useState('')
  const [refused, setRefused] = useState<number>()
  const [dismissed, setDismissed] = useState(false)
  const board = useRef<HTMLDivElement>(null)
  const { done, rowPhrase } = potionsCompletion(game)
  const stars = potionStars(game)
  useEffect(() => { setSelected(undefined) }, [game.revision])
  useEffect(() => {
    if (refused === undefined) return
    const timer = window.setTimeout(() => setRefused(undefined), 400)
    return () => window.clearTimeout(timer)
  }, [refused])
  useEffect(() => {
    const stop = () => {
      speechGeneration.current++
      if (getPlaybackState().activeId === speechId) stopBrowserSpeech()
    }
    const hidden = () => { if (document.hidden) stop() }
    const unsubscribe = subscribeSpeechInterruption(nextId => { if (nextId !== speechId) speechGeneration.current++ })
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', stop)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', stop)
      stop()
    }
  }, [speechId])
  const speak = (text: string) => {
    speechGeneration.current++
    playBrowserSpeech(speechId, text, 'zh-Hans')
  }
  const act = (action: PotionsAction, note: string) => {
    const generation = ++speechGeneration.current
    void run(async () => {
      const next = await updatePotions(game, action)
      setSelected(undefined)
      const brewed = potionsCompletion(next).done.findIndex((finished, index) => finished && !done[index])
      if (brewed >= 0) {
        setMessage(`${phraseText(next.phrases[brewed])} \u2014 ${next.phrases[brewed].translation}`)
        if (generation === speechGeneration.current && !document.hidden) playBrowserSpeech(speechId, phraseText(next.phrases[brewed]), 'zh-Hans')
      } else setMessage(note)
    })
  }
  const choose = (index: number) => {
    board.current?.focus({ preventScroll: true })
    if (selected === index) { setSelected(undefined); return }
    if (selected === undefined) {
      if (!game.rows[index].length) { setRefused(index); setMessage('That vial is empty. Choose a vial with words in it.'); return }
      setSelected(index)
      setMessage(`Lifted \u201c${game.rows[index][game.rows[index].length - 1].text}\u201d. Choose where to pour it.`)
      return
    }
    const check = canMovePotion(game, selected, index)
    if (!check.ok) { setRefused(index); setMessage(check.reason ?? 'That pour is not allowed.'); return }
    act({ type: 'move', from: selected, to: index }, 'Poured.')
  }
  return <>
    <div className="potions-score">
      <span><strong>Level {game.level}</strong>{game.hidden ? game.revealed ? ' / colors shown' : ' / smoky' : ''}</span>
      <span>{done.filter(Boolean).length} / {game.phrases.length} phrases / {game.moves} {game.moves === 1 ? 'pour' : 'pours'}</span>
    </div>
    <ul className="potions-targets" aria-label="Phrases to brew">{game.phrases.map((phrase, index) => {
      const color = vialColor(game, index)
      return <li key={phrase.id} className={`potions-target${done[index] ? ' done' : ''}`}
        style={{ '--group-background': color.background, '--group-border': color.border, '--group-ink': color.ink } as CSSProperties}>
        <span className="potions-target-text">{phrase.translation}
          {done[index] && <span lang="zh-Hans" className="potions-target-native">{phraseText(phrase)}</span>}</span>
        {done[index] && <HearPhrase text={phraseText(phrase)} speak={speak} />}
      </li>
    })}</ul>
    <div ref={board} className="potions-board" role="group" aria-label="Vials" tabIndex={-1} data-assistant-protected="true"
      style={{ '--capacity': game.capacity, '--vials': game.rows.length } as CSSProperties}>
      {game.rows.map((row, index) => <button key={index} type="button" disabled={busy || game.phase === 'complete'}
        data-potions-vial={index}
        aria-pressed={selected === index}
        aria-label={`Vial ${index + 1}: ${row.length ? row.map(tile => tile.text).join(' ') : 'empty'}`}
        className={`potions-vial${selected === index ? ' selected' : ''}${refused === index ? ' refused' : ''}${rowPhrase[index] !== undefined ? ' done' : ''}`}
        onClick={() => choose(index)}>
        <span className="potions-glass">{Array.from({ length: game.capacity }, (_, slot) => {
          const tile = row[slot]
          if (!tile) return <span key={slot} className="potions-slot" />
          const color = vialColor(game, tile.phrase)
          return <span key={slot} lang="zh-Hans"
            className={`potions-tile${selected === index && slot === row.length - 1 ? ' lifted' : ''}${tile.text.length > 2 ? ' long-word' : ''}`}
            style={{ '--group-background': color.background, '--group-border': color.border, '--group-ink': color.ink } as CSSProperties}>{tile.text}</span>
        })}</span>
      </button>)}
    </div>
    <p role="status" className="potions-feedback">{game.phase === 'complete'
      ? `Level ${game.level} complete with ${stars} of 3 stars.`
      : message || 'Tap a vial to lift its last word, then tap where it goes. A word only pours onto the word it follows, or into an empty vial.'}</p>
    <div className="potions-controls">
      <button type="button" className="button secondary" disabled={busy || !game.history.length || game.phase === 'complete'}
        onClick={() => act({ type: 'undo' }, 'Move undone.')}><Undo2 size={16} /> Undo</button>
      <button type="button" className="button secondary" disabled={busy} onClick={() => onLevel(game.level)}><RotateCcw size={16} /> Restart</button>
      <button type="button" className="button secondary" disabled={busy || !game.hidden || game.revealed || game.phase === 'complete'}
        onClick={() => act({ type: 'reveal' }, 'Colors revealed. This level is now worth one star less.')}><Eye size={16} /> Colors</button>
      <button type="button" className="button secondary" disabled={busy || game.extra || game.phase === 'complete'}
        onClick={() => act({ type: 'add-vial' }, 'Spare vial added. This level is now worth one star less.')}><FlaskConical size={16} /> Spare vial</button>
      <button type="button" className="button secondary" disabled={busy} onClick={onLevels}><ListOrdered size={16} /> Levels</button>
    </div>
    {game.phase === 'complete' && !dismissed && <PotionsComplete game={game} stars={stars} speak={speak}
      last={game.level >= POTIONS_MAX_LEVEL} onClose={() => setDismissed(true)} onNext={() => onLevel(game.level + 1)} />}
  </>
}

function LevelPicker({ progress, current, busy, onLevel }: {
  progress: PotionsProgress; current?: number; busy: boolean; onLevel: (level: number) => void
}) {
  const highest = Math.min(POTIONS_MAX_LEVEL, progress.maxLevel + 1)
  return <ol className="potions-levels" aria-label="Levels">{Array.from({ length: highest }, (_, index) => {
    const level = index + 1
    const stars = progress.stars[level] ?? 0
    return <li key={level}><button type="button" disabled={busy}
      className={`potions-level${stars ? ' cleared' : ''}${level === highest ? ' next' : ''}${level === current ? ' current' : ''}`}
      aria-current={level === current ? 'true' : undefined}
      aria-label={`Level ${level}${stars ? `, ${stars} of 3 stars` : ', not yet cleared'}${potionsLevelParams(level).hidden ? ', smoky' : ''}`}
      onClick={() => onLevel(level)}>
      <span>{level}</span>
      <span className="potions-level-stars" aria-hidden="true">{stars ? '\u2605'.repeat(stars) : potionsLevelParams(level).hidden ? 'smoky' : ''}</span>
    </button></li>
  })}</ol>
}

export function Potions({ workspace, busy, run }: PageProps) {
  const { catalog, error } = useCatalog()
  const [picking, setPicking] = useState(false)
  const phrases = useMemo(() => catalog ? knownPotionPhrases(catalog, workspace) : [], [catalog, workspace])
  const saved = useLiveQuery(async () => {
    const value = await db.potionGames.get('current')
    if (!value) return { game: undefined }
    try { return { game: readPotionsGame(value) } } catch {
      return { game: undefined, error: 'The saved Phrase Potions puzzle is invalid. Start a level to replace it.' }
    }
  }, [])
  const progress = useLiveQuery(async () => {
    try { return readPotionsProgress(await db.potionProgress.get('progress')) } catch { return undefined }
  }, [])
  const game = saved?.game
  const start = (level: number) => void run(async () => {
    await startPotionsLevel(buildPotionsLevel(phrases, level, potionsRandom(level, phrases)))
    setPicking(false)
  })
  const next = progress ? Math.min(POTIONS_MAX_LEVEL, progress.maxLevel + 1) : 1
  const ready = Boolean(catalog) && phrases.length >= 2
  return <div className="potions-player">
    <header className="potions-heading"><a className="back-link" href="#games"><ArrowLeft size={16} /> Games</a><h1>Phrase Potions</h1></header>
    {saved?.error && <p className="notice error" role="alert">{saved.error}</p>}
    {error && <p className="notice error" role="alert">Vocabulary could not be loaded. {error}</p>}
    {(!saved || !progress) && !saved?.error && <p role="status">Opening your saved puzzle...</p>}
    {game && !picking && <PotionsBoard key={game.gameId} game={game} busy={busy} run={run}
      onLevel={start} onLevels={() => setPicking(true)} />}
    {saved && progress && (!game || picking) && <section className="panel potions-setup" aria-label="Phrase Potions levels">
      <h2>{picking ? 'Choose a level' : 'Sort the words, brew the phrase.'}</h2>
      <p>Every vial must end up holding one complete phrase. A word can only pour onto the word it directly follows, or into an empty vial. Each level is dealt from your own lesson phrases and is always solvable.</p>
      <p className="small muted">{catalog
        ? `${phrases.length} lesson ${phrases.length === 1 ? 'phrase is' : 'phrases are'} fully known and ready to brew.`
        : error ? 'Vocabulary is unavailable.' : 'Loading your vocabulary...'}</p>
      {catalog && phrases.length < 2 && <p>Introduce more vocabulary in <a className="text-link" href="#lessons">Lessons</a> so whole lesson phrases become known.</p>}
      <div className="button-row">
        <button type="button" className="button primary" disabled={busy || !ready} onClick={() => start(next)}>
          {progress.maxLevel ? `Play level ${next}` : 'Play level 1'}</button>
        {picking && game && <button type="button" className="button secondary" disabled={busy} onClick={() => setPicking(false)}>Back to the vials</button>}
      </div>
      {ready && <LevelPicker progress={progress} current={game?.level} busy={busy} onLevel={start} />}
      {progress.brewed.length > 0 && <p className="small muted">{progress.brewed.length} distinct {progress.brewed.length === 1 ? 'phrase' : 'phrases'} brewed so far.</p>}
    </section>}
    {game && !picking && <details className="potions-rules"><summary aria-label="Phrase Potions rules"><Info size={20} /><span>Phrase Potions rules</span></summary>
      <p>Tap a vial to lift its last word, then tap the vial it pours into. A word may land on an empty vial, or on the word it directly follows in one of this level's phrases. A vial never holds more words than the longest phrase.</p>
      <p>Smoky levels hide the colors, so only the language tells you which words belong together. Revealing the colors or adding a spare vial each cost one star. Undo is unlimited and every level is generated to be solvable.</p>
      <p>Completed phrases are spoken with your selected Mandarin voice. Online voices may send the phrase to their speech service. Progress is saved in this profile, is separate from lesson scores and review schedules, and is not included in backups.</p>
    </details>}
  </div>
}
