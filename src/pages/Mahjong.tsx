import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Info, Lightbulb, RotateCcw, Shuffle } from 'lucide-react'
import { db } from '../core/database'
import { getWord } from '../data/mandarin'
import { requireUnit } from '../core/study/catalog'
import { useCatalog } from '../components/study/useCatalog'
import type { PageProps } from '../components/shared'
import { availablePairs, boardLayout, createMahjong, distinctWords, isFree, matches, modeSchema, readMahjong, remainingTiles, type GameWord, type MahjongGame, type MahjongMode, type TileFace } from '../core/games/mahjong'
import { updateMahjong, type MahjongAction } from '../core/games/mahjong-store'
import './mahjong.css'

const faceLabels: Record<TileFace, string> = { character: 'Character', meaning: 'English', pinyin: 'Pinyin' }
const modeLabels: Record<MahjongMode, string> = {
  mixed: 'Mixed pairs', 'character-meaning': 'Character + English', 'character-pinyin': 'Character + pinyin', 'pinyin-meaning': 'Pinyin + English',
}

function MahjongBoard({ game, busy, run }: { game: MahjongGame } & Pick<PageProps, 'busy' | 'run'>) {
  const [selected, setSelected] = useState<number>()
  const [hint, setHint] = useState<{ revision: number; ids: number[] }>()
  const [feedback, setFeedback] = useState('Choose two free tiles for the same word.')
  const board = useRef<HTMLDivElement>(null)
  const remaining = remainingTiles(game)
  const pairs = availablePairs(game)
  const complete = remaining.length === 0
  const positions = boardLayout(game)
  const columns = Math.max(...positions.map(tile => tile.x)) + 1
  const rows = Math.max(...positions.map(tile => tile.y)) + 1
  const layers = Math.max(...positions.map(tile => tile.z))
  // Another tab can remove a selected tile or replace the arrangement.
  useEffect(() => { setSelected(undefined) }, [game.revision])
  const action = (operation: MahjongAction, message: string, hintIds: number[] = []) => void run(async () => {
    const next = await updateMahjong(game, operation)
    setSelected(undefined)
    setFeedback(message)
    setHint(hintIds.length ? { revision: next.revision, ids: hintIds } : undefined)
  })
  const choose = (id: number) => {
    setHint(undefined)
    if (selected === id) { setSelected(undefined); return }
    if (selected === undefined) { setSelected(id); setFeedback('Now choose its matching representation.'); return }
    const first = remaining.find(tile => tile.id === selected), second = remaining.find(tile => tile.id === id)
    if (!first || !second) { setSelected(undefined); setFeedback('The board changed. Choose a free tile again.'); return }
    const correct = matches(first, second)
    action({ type: 'match', first: selected, second: id }, correct
      ? 'Pair matched!'
      : 'Not a pair. Choose different representations of the same word.')
    board.current?.focus({ preventScroll: true })
  }
  return <>
    <div className="mahjong-score"><span className="mahjong-pair-count"><strong>{game.removed.length / 2}</strong> / {game.tiles.length / 2} pairs</span>
      <span>{game.mistakes} misses / {game.hints} hints / {game.shuffles} shuffles</span></div>
    {complete ? <section className="panel mahjong-complete" role="status"><h2>Board cleared!</h2><p>You matched {game.tiles.length / 2} vocabulary pairs.</p>
      <p className="small muted">This game does not change lesson scores or spaced-review schedules.</p></section>
      : <div className="mahjong-table"><div ref={board} tabIndex={-1} className="mahjong-board" role="group" aria-label="Mahjong tiles" data-assistant-protected="true"
        style={{ '--columns': columns, '--rows': rows, '--layers': layers } as CSSProperties}>
        {remaining.map(tile => {
          const free = isFree(tile, remaining)
          const text = tile.word[tile.face].normalize('NFC')
          return <button key={tile.id} type="button" disabled={busy || !free}
            data-tile-id={tile.id}
            aria-label={`${faceLabels[tile.face]}: ${text}`}
            aria-description={`Tile ${tile.id + 1}, layer ${tile.z + 1}. ${free ? 'Free tile' : 'Blocked: a tile covers it or both sides are occupied'}`}
            aria-pressed={selected === tile.id}
            className={`mahjong-tile ${tile.face}${tile.word.character.length > 2 ? ' long-word' : ''}${free ? ' free' : ' blocked'}${hint?.revision === game.revision && hint.ids.includes(tile.id) ? ' hinted' : ''}`}
            style={{ '--x': tile.x, '--y': tile.y, '--layer': tile.z, zIndex: tile.z * 100 + Math.round(tile.y * 10 + tile.x) } as CSSProperties}
            onClick={() => choose(tile.id)}>
            <span className="mahjong-tile-text" lang={tile.face === 'character' ? 'zh-Hans' : tile.face === 'meaning' ? 'en' : 'zh-Latn'}>{text}</span>
          </button>
        })}
      </div></div>}
    <p className={`mahjong-feedback${!complete && !pairs.length ? ' accent' : ''}`} role="status" aria-live="polite">
      {!complete && !pairs.length ? 'No free pairs. Undo your last match or reshuffle to continue.' : feedback}
    </p>
    <div className="button-row mahjong-controls">
      <button className="button secondary" disabled={busy || !pairs.length} onClick={() => {
        const pair = pairs[0]
        action({ type: 'hint' }, 'The outlined tiles match. Select them to remove the pair.', pair.map(tile => tile.id))
      }}><Lightbulb size={16} /> Hint</button>
      <button className="button secondary" disabled={busy || !game.history.length} onClick={() => action({ type: 'undo' }, 'Last pair restored.')}><RotateCcw size={16} /> Undo</button>
      <button className="button secondary" disabled={busy || complete} onClick={() => action({ type: 'shuffle' }, 'Remaining tiles restacked. Undo history cleared.')}><Shuffle size={16} /> Reshuffle</button>
    </div>
  </>
}

export function Mahjong({ workspace, busy, run }: PageProps) {
  const { catalog, error } = useCatalog()
  const [mode, setMode] = useState<MahjongMode>('mixed')
  const [replace, setReplace] = useState(false)
  const saved = useLiveQuery(async () => {
    const value = await db.mahjongGames.get('current')
    if (!value) return { game: undefined }
    try { return { game: readMahjong(value) } } catch {
      return { game: undefined, error: 'The saved Mahjong board is invalid. Start a new board to replace it.' }
    }
  }, [])
  const vocabulary: GameWord[] = []
  if (catalog) {
    for (const entry of workspace.knowledge) {
      const unit = requireUnit(catalog, entry.ref)
      if (unit.kind === 'vocabulary') vocabulary.push({ id: unit.ref, character: unit.record.ch, pinyin: unit.record.pr, meaning: unit.record.ds })
    }
    for (const state of workspace.words) {
      const word = getWord(state.wordId)
      vocabulary.push({ id: word.id, character: word.native, pinyin: word.pinyin, meaning: word.meaning })
    }
  }
  const eligible = distinctWords(vocabulary)
  const game = saved?.game
  const start = () => void run(async () => {
    const next = createMahjong(eligible, mode)
    await db.mahjongGames.put(next)
    setReplace(false)
  })
  return <div className={`mahjong-player${game?.layout === 'courtyard' ? ' mahjong-courtyard' : ''}`}>
    <header className="mahjong-heading"><a className="back-link" href="#practice"><ArrowLeft size={16} /> Practice</a>
      <h1>Word Mahjong</h1></header>
    {saved?.error && <p role="alert" className="notice error">{saved.error}</p>}
    {error && <p role="alert" className="notice error">Vocabulary could not be loaded. {error}</p>}
    {!saved && <p role="status">Opening your saved board...</p>}
    {game && <MahjongBoard key={game.gameId} game={game} busy={busy} run={run} />}
    {game && !game.layout && !replace && <p className="small mahjong-upgrade">Your saved board is preserved. <button className="text-link" onClick={() => setReplace(true)}>Deal the new stacked layout</button></p>}
    {saved && (!game || replace || game.removed.length === game.tiles.length) ? <section className="mahjong-setup" aria-label="New Mahjong board">
      <p>Clear a 48-tile, three-layer board. Words have repeated pairs: any free copy can match a different representation of the same word.</p>
      <label>Tile pairs<select value={mode} onChange={event => setMode(modeSchema.parse(event.target.value))}>
        {modeSchema.options.map(value => <option key={value} value={value}>{modeLabels[value]}</option>)}
      </select></label>
      <p className="small muted">{catalog ? `${eligible.length} distinct short words available from your introduced vocabulary.` : error ? 'Vocabulary is unavailable.' : 'Loading your vocabulary...'}</p>
      {catalog && eligible.length < 4 && <p>Add at least four distinct words in <a className="text-link" href="#dictionary">Dictionary</a> or start a lesson.</p>}
      <p className="small muted">Boards use short entries (up to 32 English characters), excluding shared meanings and duplicate characters or pinyin. Games do not change learning progress.</p>
      {replace && <p>This replaces your saved board.</p>}
      <div className="button-row"><button className="button primary" disabled={busy || !catalog || eligible.length < 4} onClick={start}>{replace ? 'Replace board' : 'Deal tiles'}</button>
        {replace && <button className="button secondary" disabled={busy} onClick={() => setReplace(false)}>Keep playing</button>}</div>
    </section> : game && <details className="mahjong-help"><summary aria-label="Rules and new board"><Info size={20} /><span>Rules and new board</span></summary>
      <p>{modeLabels[game.mode]}. Match the same word across two different representations. A tile must have nothing on top and at least one open horizontal side.</p>
      <p>Repeated copies are interchangeable. Each word uses two representations on a board; identical representations do not match. No pinyin annotations appear on character tiles.</p>
      <p>Hint outlines a free pair. Reshuffle restacks the remaining tiles into a solvable arrangement and clears Undo history, without restoring cleared pairs.</p>
      <p>The current board is saved in this profile, but is not part of workspace backups. Games never change knowledge, scores, or review timing.</p>
      <button className="button secondary" disabled={busy} onClick={() => setReplace(true)}>New board</button>
    </details>}
  </div>
}
