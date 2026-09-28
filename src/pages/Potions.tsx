import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Eye, FlaskConical, Info, ListOrdered, RotateCcw, Star, Undo2, Volume2, X } from 'lucide-react'
import { db } from '../core/database'
import type { PageProps } from '../components/shared'
import { useCatalog } from '../components/study/useCatalog'
import { buildPotionsLevel, canMovePotion, phraseText, potionsCompletion, potionsLevelParams, potionsRandom, potionStars, POTIONS_MAX_LEVEL, readPotionsGame, readPotionsProgress, type PotionsAction, type PotionsGame, type PotionsProgress } from '../core/games/potions'
import { knownPotionPhrases } from '../core/games/potions-phrases'
import { startPotionsLevel, updatePotions } from '../core/games/potions-store'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech, subscribeSpeechInterruption } from '../core/assistant/speech'
import { capturePotionPour, usePotionAnimation } from './potions-animation'
import './potions.css'

function vialColor(game: PotionsGame, phrase: number) {
  return game.hidden && !game.revealed ? 'smoke' : phrase
}

function HearPhrase({ text, speak }: { text: string; speak: (text: string) => void }) {
  return <button type="button" className="icon-button potions-hear" aria-label={`Hear ${text}`} onClick={() => speak(text)}><Volume2 size={16} /></button>
}

function Stars({ count, className = '' }: { count: number; className?: string }) {
  return <span className={`potions-stars ${className}`} role="img" aria-label={`${count} of 3 stars`}>
    {[0, 1, 2].map(index => <Star key={index} aria-hidden="true" className={index < count ? 'earned' : ''}
      style={{ '--star-index': index } as CSSProperties} />)}
  </span>
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
    <div className="potions-confetti" aria-hidden="true">{Array.from({ length: 24 }, (_, index) =>
      <i key={index} data-potion-color={index % 8} style={{
        left: `${(index * 37) % 100}%`, '--drift': `${(index % 7 - 3) * 18}px`,
        animationDelay: `${index % 6 * .09}s`, animationDuration: `${1.5 + index % 5 * .2}s`,
      } as CSSProperties} />)}</div>
    <FlaskConical className="potions-win-emblem" size={38} aria-hidden="true" />
    <h2 id={`${id}-title`}>Level {game.level} brewed!</h2>
    <Stars count={stars} className="potions-win-stars" />
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

function PotionsBoard({ game: savedGame, busy, run, onLevel, onLevels }: {
  game: PotionsGame; onLevel: (level: number) => void; onLevels: () => void
} & Pick<PageProps, 'busy' | 'run'>) {
  const speechId = useId()
  const speechGeneration = useRef(0)
  const alive = useRef(false)
  const acting = useRef(false)
  const animatePour = usePotionAnimation()
  const [pour, setPour] = useState<{ before: PotionsGame; from: number; tile: string; flying: boolean }>()
  const [landing, setLanding] = useState<{ revision: number; tile: string; phrases: boolean[] }>()
  const game = pour?.before ?? savedGame
  const [selected, setSelected] = useState<number>()
  const [message, setMessage] = useState('')
  const [refused, setRefused] = useState<number>()
  const [dismissed, setDismissed] = useState(false)
  const board = useRef<HTMLDivElement>(null)
  const { done, rowPhrase } = potionsCompletion(game)
  const stars = potionStars(game)
  const locked = busy || Boolean(pour)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useLayoutEffect(() => {
    const element = board.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const size = () => {
      const height = (element.clientHeight - 28 - (game.rows.length - 1) * 10) / game.rows.length - 22
      element.style.setProperty('--tile-height', `${Math.max(32, Math.min(50, height))}px`)
    }
    const observer = new ResizeObserver(size)
    observer.observe(element)
    size()
    return () => observer.disconnect()
  }, [game.rows.length])
  useEffect(() => { setSelected(undefined) }, [game.revision])
  useEffect(() => {
    if (!landing) return
    const timer = window.setTimeout(() => setLanding(undefined), 700)
    return () => window.clearTimeout(timer)
  }, [landing])
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
    if (acting.current || locked) return
    acting.current = true
    const generation = ++speechGeneration.current
    const source = action.type === 'move' ? board.current?.querySelector<HTMLElement>(`[data-potions-vial="${action.from}"] [data-potions-slot="${game.rows[action.from].length - 1}"]`) : undefined
    const destination = action.type === 'move' ? board.current?.querySelector<HTMLElement>(`[data-potions-vial="${action.to}"] [data-potions-slot="${game.rows[action.to].length}"]`) : undefined
    const flight = source && destination ? capturePotionPour(source, destination) : undefined
    const tile = action.type === 'move' ? game.rows[action.from].at(-1) : undefined
    if (action.type === 'move' && tile) setPour({ before: game, from: action.from, tile: tile.id, flying: false })
    setLanding(undefined)
    void run(async () => {
      try {
        const next = await updatePotions(game, action)
        if (!alive.current) return
        setSelected(undefined)
        setPour(value => value ? { ...value, flying: true } : undefined)
        const animated = flight ? await animatePour(flight) : false
        if (!alive.current) return
        const fresh = potionsCompletion(next).done.map((finished, index) => finished && !done[index])
        if (animated && tile) setLanding({ revision: next.revision, tile: tile.id, phrases: fresh })
        const brewed = fresh.findIndex(Boolean)
        if (brewed >= 0) {
          setMessage(`${phraseText(next.phrases[brewed])} \u2014 ${next.phrases[brewed].translation}`)
          if (generation === speechGeneration.current && !document.hidden) playBrowserSpeech(speechId, phraseText(next.phrases[brewed]), 'zh-Hans')
        } else setMessage(note)
      } finally {
        acting.current = false
        if (alive.current) setPour(undefined)
      }
    })
  }
  const choose = (index: number) => {
    if (acting.current || locked) return
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
  const fresh = landing?.revision === game.revision ? landing : undefined
  return <section className="potions-game" aria-label={`Phrase Potions level ${game.level}`}>
    <div className="potions-score">
      <button type="button" className="icon-button" aria-label="Levels" disabled={locked} onClick={onLevels}><ListOrdered size={22} /></button>
      <div className="potions-level-title"><strong>Level {game.level}</strong><span>Mandarin{game.hidden ? game.revealed ? ' / colors shown' : ' / smoky' : ''}</span></div>
      <div className="potions-moves"><strong>{game.moves}</strong><span>{game.moves === 1 ? 'pour' : 'pours'}</span></div>
    </div>
    <div className="potions-brew-count"><span>{done.filter(Boolean).length} / {game.phrases.length} phrases brewed</span><Stars count={stars} /></div>
    <ul className="potions-targets" aria-label="Phrases to brew">{game.phrases.map((phrase, index) => {
      return <li key={phrase.id} className={`potions-target${done[index] ? ' done' : ''}${fresh?.phrases[index] ? ' fresh' : ''}`}
        data-potion-color={vialColor(game, index)}>
        <span className="potions-dot" aria-hidden="true" />
        <span className="potions-target-text">{phrase.translation}
          {done[index] && <span lang="zh-Hans" className="potions-target-native">{phraseText(phrase)}</span>}</span>
        {done[index] && <HearPhrase text={phraseText(phrase)} speak={speak} />}
      </li>
    })}</ul>
    <div ref={board} className="potions-board" role="group" aria-label="Vials" tabIndex={-1} aria-busy={Boolean(pour)} data-assistant-protected="true"
      style={{ '--capacity': game.capacity, '--vials': game.rows.length } as CSSProperties}>
      {game.rows.map((row, index) => <button key={index} type="button" disabled={locked || game.phase === 'complete'}
        data-potions-vial={index}
        aria-pressed={selected === index}
        aria-label={`Vial ${index + 1}: ${row.length ? row.map(tile => tile.text).join(' ') : 'empty'}`}
        className={`potions-vial${selected === index ? ' selected' : ''}${refused === index ? ' refused' : ''}${rowPhrase[index] !== undefined ? ' done' : ''}${pour?.flying && pour.from === index ? ' pouring' : ''}${rowPhrase[index] !== undefined && fresh?.phrases[rowPhrase[index]] ? ' fresh' : ''}`}
        onClick={() => choose(index)}>
        <span className="potions-glass"><span className="potions-slots">{Array.from({ length: game.capacity }, (_, slot) => {
          const tile = row[slot]
          if (!tile) return <span key={slot} data-potions-slot={slot} className="potions-slot" />
          return <span key={slot} lang="zh-Hans" data-potions-tile={tile.id} data-potions-slot={slot} data-potion-color={vialColor(game, tile.phrase)}
            className={`potions-tile${selected === index && slot === row.length - 1 ? ' lifted' : ''}${pour?.flying && pour.tile === tile.id ? ' ghost' : ''}${fresh?.tile === tile.id ? ' landed' : ''}`}
            style={{ '--letters': [...tile.text].length } as CSSProperties}>{tile.text}</span>
        })}</span><span className="potions-shine" /></span><span className="potions-lip" />
        {rowPhrase[index] !== undefined && <Star className="potions-vial-star" size={16} aria-hidden="true" />}
        {fresh && row.some(tile => tile.id === fresh.tile) && <span className="potions-burst" aria-hidden="true">
          {Array.from({ length: 8 }, (_, particle) => <i key={particle} style={{
            '--burst-x': `${Math.cos(particle * Math.PI / 4) * 36}px`, '--burst-y': `${Math.sin(particle * Math.PI / 4) * 36}px`,
          } as CSSProperties} />)}
        </span>}
      </button>)}
    </div>
    <p role="status" className="potions-feedback">{game.phase === 'complete'
      ? `Level ${game.level} complete with ${stars} of 3 stars.`
      : message || 'Tap a vial to lift its last word, then tap where it goes. A word only pours onto the word it follows, or into an empty vial.'}</p>
    <div className="potions-controls">
      <button type="button" className="button secondary" disabled={locked || !game.history.length || game.phase === 'complete'}
        onClick={() => act({ type: 'undo' }, 'Move undone.')}><Undo2 size={16} /> Undo</button>
      <button type="button" className="button secondary" disabled={locked} onClick={() => onLevel(game.level)}><RotateCcw size={16} /> Restart</button>
      <button type="button" className="button primary" disabled={locked || !game.hidden || game.revealed || game.phase === 'complete'}
        title="Reveal phrase colors. Costs one star." onClick={() => act({ type: 'reveal' }, 'Colors revealed. This level is now worth one star less.')}><Eye size={16} /> Colors
        <span className="potions-charge" aria-hidden="true">{game.hidden && !game.revealed ? 1 : 0}</span></button>
      <button type="button" className="button potions-mint" disabled={locked || game.extra || game.phase === 'complete'}
        title="Add a spare vial. Costs one star." onClick={() => act({ type: 'add-vial' }, 'Spare vial added. This level is now worth one star less.')}><FlaskConical size={16} /> Spare vial
        <span className="potions-charge" aria-hidden="true">{game.extra ? 0 : 1}</span></button>
    </div>
    {game.phase === 'complete' && !dismissed && <PotionsComplete game={game} stars={stars} speak={speak}
      last={game.level >= POTIONS_MAX_LEVEL} onClose={() => setDismissed(true)} onNext={() => onLevel(game.level + 1)} />}
  </section>
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
    <div className="potions-sparks" aria-hidden="true">{[12, 29, 54, 73, 91].map((left, index) =>
      <i key={left} style={{ left: `${left}%`, animationDelay: `${index * -2.3}s`, animationDuration: `${9 + index}s` }} />)}</div>
    <header className="potions-heading"><a className="icon-button" href="#games" aria-label="Back to Games"><ArrowLeft size={20} /></a><h1><FlaskConical size={22} aria-hidden="true" /> Phrase Potions</h1></header>
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
