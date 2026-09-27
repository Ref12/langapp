import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Brain, CheckCircle2, Info } from 'lucide-react'
import { db } from '../core/database'
import type { PageProps } from '../components/shared'
import { useCatalog } from '../components/study/useCatalog'
import { introducedGameWords } from '../core/games/game-vocabulary'
import { createMemoryGame, memoryGroupSize, memoryModeSchema, memoryWordCountSchema, readMemoryGame, type MemoryAction, type MemoryGame, type MemoryMode, type MemoryWordCount } from '../core/games/memory'
import { updateMemory } from '../core/games/memory-store'
import './memory.css'

const modes: Record<MemoryMode, string> = {
  mixed: 'Pairs: mixed forms',
  'character-meaning': 'Pairs: Chinese + English',
  'character-pinyin': 'Pairs: Chinese + pinyin',
  'pinyin-meaning': 'Pairs: pinyin + English',
  triplets: 'Triplets: Chinese + pinyin + English',
}
const faces = { character: 'Chinese', pinyin: 'Pinyin', meaning: 'English' }

function MemoryBoard({ game, busy, run, onNewBoard }: { game: MemoryGame; onNewBoard: () => void } & Pick<PageProps, 'busy' | 'run'>) {
  const [message, setMessage] = useState('')
  const board = useRef<HTMLDivElement>(null)
  const completion = useRef<HTMLHeadingElement>(null)
  const size = memoryGroupSize(game.mode)
  const group = size === 3 ? 'triplet' : 'pair'
  const found = game.matched.length / size
  const columns = size === 3 ? game.tiles.length > 18 ? 4 : 3 : game.tiles.length <= 4 ? 2 : 4
  useEffect(() => { if (game.phase === 'complete') completion.current?.focus() }, [game.phase])
  const act = (action: MemoryAction) => {
    void run(async () => {
      const next = await updateMemory(game, action)
      setMessage(next.matched.length > game.matched.length ? `${size === 3 ? 'Triplet' : 'Pair'} matched!`
        : next.turned.length ? `${next.turned.length} of ${size} tiles revealed.`
          : `Reveal ${size} tiles for the same word.`)
    })
    board.current?.focus({ preventScroll: true })
  }
  return <>
    <div className="memory-score"><span>{found} / {game.wordCount} {group}s found</span>
      <span>{game.attempts} turns / {game.attempts - found} misses</span></div>
    {game.phase === 'complete' ? <section className="memory-complete panel">
      <CheckCircle2 size={40} className="accent" /><h2 ref={completion} tabIndex={-1}>You found every {group}.</h2>
      <p>{game.wordCount} words matched in {game.attempts} turns.</p>
      <p className="small muted">A little recall practice. Lesson scores and review schedules are unchanged.</p>
      <div className="button-row"><button className="button primary" onClick={onNewBoard} disabled={busy}>New board</button>
        <a className="button secondary" href="#games">Back to Games</a></div>
    </section> : <div ref={board} className="memory-board" role="group" aria-label="Memory tiles" tabIndex={-1}
      data-assistant-protected={game.phase !== 'study' ? 'true' : undefined}
      style={{ '--columns': columns, '--rows': Math.ceil(game.tiles.length / columns), '--minimum-card-height': columns >= 4 ? '90px' : '73px' } as CSSProperties}>
      {game.tiles.map(tile => {
        if (game.matched.includes(tile.id)) return <div key={tile.id} className="memory-slot removed" aria-hidden="true" />
        const visible = game.phase === 'study' || game.turned.includes(tile.id)
        return <button key={tile.id} type="button" data-memory-tile={tile.id}
          className={`memory-card${visible ? ` face-up ${tile.face}${tile.word.character.length > 2 ? ' long-word' : ''}` : ' face-down'}${game.phase === 'review' && visible ? ' mismatch' : ''}`}
          disabled={busy || game.phase !== 'play' || visible}
          aria-label={visible ? `Tile ${tile.id + 1}, ${faces[tile.face]}: ${tile.word[tile.face].normalize('NFC')}` : `Reveal tile ${tile.id + 1}`}
          onClick={() => act({ type: 'reveal', id: tile.id })}>
          {visible ? <><span className="memory-face-label">{faces[tile.face]}</span>
            <span className="memory-word" lang={tile.face === 'character' ? 'zh-Hans' : tile.face === 'pinyin' ? 'zh-Latn' : 'en'}>{tile.word[tile.face].normalize('NFC')}</span>
          </> : <span className="memory-card-back" aria-hidden="true"><Brain size={26} /><span>{tile.id + 1}</span></span>}
        </button>
      })}
    </div>}
    <p role="status" className="memory-feedback">{game.phase === 'study'
      ? 'Study the tiles and their positions. Start when ready.'
      : game.phase === 'review' ? 'Not a match. Study these tiles, then Continue to hide them.'
        : game.phase === 'complete' ? 'Board complete.' : message || `Reveal ${size} tiles for the same word.`}</p>
    {game.phase === 'study' && <button className="button primary full-width" disabled={busy} onClick={() => act({ type: 'start' })}>Start memory</button>}
    {game.phase === 'review' && <button className="button primary full-width" disabled={busy} onClick={() => act({ type: 'continue' })}>Continue</button>}
  </>
}

export function Memory({ workspace, busy, run }: PageProps) {
  const { catalog, error } = useCatalog()
  const [mode, setMode] = useState<MemoryMode>('mixed')
  const [wordCount, setWordCount] = useState<MemoryWordCount>(4)
  const [replace, setReplace] = useState(false)
  const saved = useLiveQuery(async () => {
    const value = await db.memoryGames.get('current')
    if (!value) return { game: undefined }
    try { return { game: readMemoryGame(value) } } catch {
      return { game: undefined, error: 'The saved Memory board is invalid. Prepare a new board to replace it.' }
    }
  }, [])
  const game = saved?.game
  const gameId = game?.gameId, gameMode = game?.mode, gameWords = game?.wordCount
  useEffect(() => {
    if (gameId && gameMode && gameWords) { setMode(gameMode); setWordCount(gameWords) }
  }, [gameId, gameMode, gameWords])
  const eligible = catalog ? introducedGameWords(catalog, workspace) : []
  const prepare = () => void run(async () => {
    const next = createMemoryGame(eligible, mode, wordCount)
    await db.memoryGames.put(next)
    setReplace(false)
  })
  return <div className="memory-player">
    <header className="memory-heading"><a className="back-link" href="#games"><ArrowLeft size={16} /> Games</a><h1>Word Memory</h1></header>
    {saved?.error && <p className="notice error" role="alert">{saved.error}</p>}
    {error && <p className="notice error" role="alert">Vocabulary could not be loaded. {error}</p>}
    {!saved && <p role="status">Opening your saved board...</p>}
    {game && !replace && <MemoryBoard key={game.gameId} game={game} busy={busy} run={run} onNewBoard={() => setReplace(true)} />}
    {saved && (!game || replace) && <section className="panel memory-setup" aria-label="New Memory board">
      <h2>{replace ? 'Prepare a different board?' : 'Study, remember, match.'}</h2>
      <p>First see every tile face up. When you press Start memory they turn over, keeping their positions.</p>
      <label>Matching mode<select value={mode} disabled={busy} onChange={event => setMode(memoryModeSchema.parse(event.target.value))}>
        {memoryModeSchema.options.map(value => <option key={value} value={value}>{modes[value]}</option>)}
      </select></label>
      <label>Words per board<select value={wordCount} disabled={busy} onChange={event => setWordCount(memoryWordCountSchema.parse(Number(event.target.value)))}>
        {[2, 4, 6, 8].map(count => <option key={count} value={count}>{count} words / {count * memoryGroupSize(mode)} tiles</option>)}
      </select></label>
      <p className="small muted">{catalog ? `${eligible.length} distinct short words available from your introduced vocabulary.` : error ? 'Vocabulary is unavailable.' : 'Loading your vocabulary...'}</p>
      {catalog && eligible.length < wordCount && <p>Choose fewer words or add vocabulary in <a className="text-link" href="#dictionary">Dictionary</a>.</p>}
      <p className="small muted">Pairs use two different forms of a word. Triplets require its Chinese, pinyin, and English tiles together. Mismatches stay visible until you Continue.</p>
      {replace && <p>Your saved game is replaced only when you prepare this board.</p>}
      <div className="button-row"><button className="button primary" disabled={busy || !catalog || eligible.length < wordCount} onClick={prepare}>Prepare tiles</button>
        {replace && <button className="button secondary" disabled={busy} onClick={() => setReplace(false)}>Keep current board</button>}</div>
    </section>}
    {game && !replace && game.phase !== 'complete' && <details className="memory-rules"><summary aria-label="Rules and new board"><Info size={20} /><span>Rules and new board</span></summary>
      <p>{modes[game.mode]}. Once started, reveal {memoryGroupSize(game.mode)} tiles per turn. They must be different forms of the same word. A triplet is removed only when all three forms are revealed.</p>
      <p>Matched groups disappear without moving the remaining tiles. A mismatch stays visible until you press Continue. The current study phase, revealed tiles, matches, and turns survive reload in this profile.</p>
      <p>Only short introduced vocabulary is used, excluding ambiguous shared forms and meanings. Character tiles have no pinyin annotation. Games do not change your knowledge or review schedules and are not included in backups.</p>
      <button className="button secondary" disabled={busy} onClick={() => setReplace(true)}>New board</button>
    </details>}
  </div>
}
