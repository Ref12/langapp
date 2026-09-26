import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Eraser, Info, Pencil, RotateCcw } from 'lucide-react'
import { db } from '../core/database'
import type { PageProps } from '../components/shared'
import { useCatalog } from '../components/study/useCatalog'
import { HearButton } from '../components/assistant/SnippetActions'
import { sudokuCharacters } from '../core/games/sudoku-characters'
import { generateSudokuInWorker } from '../core/games/sudoku-client'
import { SUDOKU_BOXES, sudokuDifficultySchema, sudokuSizeSchema, type SudokuDifficulty, type SudokuGame, type SudokuSize } from '../core/games/sudoku-contracts'
import { SUDOKU_CLUES, sudokuConflicts } from '../core/games/sudoku-generator'
import { createSudokuGame, readSudokuGame, type SudokuAction } from '../core/games/sudoku-state'
import { updateSudoku } from '../core/games/sudoku-store'
import './sudoku.css'

const difficultyNames = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

function SudokuBoard({ game, busy, run }: { game: SudokuGame } & Pick<PageProps, 'busy' | 'run'>) {
  const [selected, setSelected] = useState(() => Math.max(0, game.givens.indexOf(0)))
  const [scratch, setScratch] = useState(false)
  const [focusSymbol, setFocusSymbol] = useState(1)
  const [feedback, setFeedback] = useState('Choose a cell, then a character.')
  const grid = useRef<HTMLDivElement>(null)
  const size = game.size, box = SUDOKU_BOXES[size]
  const conflicts = sudokuConflicts(game.values, size)
  const complete = game.values.every((value, index) => value === game.solution[index])
  const selectedValue = game.values[selected]
  const symbol = game.symbols[focusSymbol - 1]
  const fixed = game.givens[selected] !== 0
  const act = (action: SudokuAction) => void run(async () => {
    const next = await updateSudoku(game, action)
    setFeedback(sudokuConflicts(next.values, size).size
      ? 'Repeated characters are marked in red. Check their rows, columns, and boxes.'
      : action.type === 'exclude' ? 'Scratch marker saved. Tap that character again to restore it.'
        : action.type === 'undo' ? 'Last move undone.' : action.type === 'clear-marks' ? "This cell's scratch markers are reset." : 'Entry saved.')
  })
  const choose = (value: number) => {
    act(scratch ? { type: 'exclude', index: selected, value } : { type: 'place', index: selected, value })
    grid.current?.querySelector<HTMLButtonElement>(`[data-cell-index="${selected}"]`)?.focus({ preventScroll: true })
    setFocusSymbol(value)
  }
  const selectCell = (index: number) => {
    setSelected(index)
    if (game.values[index]) setFocusSymbol(game.values[index])
  }
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const row = Math.floor(index / size), column = index % size
    const directions: Record<string, number> = {
      ArrowLeft: row * size + (column + size - 1) % size,
      ArrowRight: row * size + (column + 1) % size,
      ArrowUp: ((row + size - 1) % size) * size + column,
      ArrowDown: ((row + 1) % size) * size + column,
    }
    const next = directions[event.key]
    if (next !== undefined) {
      event.preventDefault()
      selectCell(next)
      grid.current?.querySelector<HTMLButtonElement>(`[data-cell-index="${next}"]`)?.focus()
    } else if (event.key.toLowerCase() === 'n') {
      event.preventDefault(); setScratch(value => !value)
    } else if (!busy && !fixed && !complete) {
      if (/^[1-9]$/.test(event.key) && Number(event.key) <= size) { event.preventDefault(); choose(Number(event.key)) }
      else if (['Backspace', 'Delete', '0'].includes(event.key)) { event.preventDefault(); act({ type: 'place', index: selected, value: 0 }) }
    }
  }
  return <>
    <div className="sudoku-meta"><span>{size} × {size} / {difficultyNames[game.difficulty]}</span>
      <span>{game.values.filter(Boolean).length} / {size ** 2} filled</span></div>
    <div ref={grid} className="sudoku-grid" role="grid" aria-label={`${size} by ${size} character Sudoku`} aria-describedby="sudoku-instructions"
      data-assistant-protected="true" style={{ '--size': size, '--notes-columns': size === 4 ? 2 : 3 } as CSSProperties}>
      {Array.from({ length: size }, (_, row) => <div role="row" className="sudoku-row" key={row}>
        {Array.from({ length: size }, (_, column) => {
          const index = row * size + column, value = game.values[index], given = game.givens[index] !== 0
          const peer = row === Math.floor(selected / size) || column === selected % size
            || (Math.floor(row / box.rows) === Math.floor(Math.floor(selected / size) / box.rows) && Math.floor(column / box.columns) === Math.floor(selected % size / box.columns))
          const excluded = game.symbols.filter((_, symbolIndex) => game.excluded[index] & (1 << symbolIndex)).map(item => item.character)
          return <button key={index} type="button" role="gridcell" data-cell-index={index} tabIndex={selected === index ? 0 : -1}
            aria-selected={selected === index} aria-readonly={given || complete} aria-disabled={busy}
            aria-label={`Row ${row + 1}, column ${column + 1}: ${value ? game.symbols[value - 1].character : 'empty'}${given ? ', clue' : ''}${excluded.length && !value ? `; ruled out ${excluded.join(', ')}` : ''}`}
            className={`sudoku-cell${given ? ' given' : ''}${peer ? ' peer' : ''}${selectedValue && value === selectedValue ? ' same-character' : ''}${conflicts.has(index) ? ' conflict' : ''}`}
            style={{ borderRightWidth: column === size - 1 ? 0 : (column + 1) % box.columns === 0 ? 2 : 1,
              borderBottomWidth: row === size - 1 ? 0 : (row + 1) % box.rows === 0 ? 2 : 1 }}
            onClick={() => { if (!busy) selectCell(index) }} onFocus={() => selectCell(index)} onKeyDown={event => keyDown(event, index)}>
            {value ? <span lang="zh-Hans">{game.symbols[value - 1].character}</span> : (scratch || game.excluded[index] !== 0) && <span className="sudoku-marks" aria-hidden="true" lang="zh-Hans">
              {game.symbols.map((item, symbolIndex) => <span key={item.character} className={game.excluded[index] & (1 << symbolIndex) ? 'ruled-out' : undefined}>{item.character}</span>)}
            </span>}
          </button>
        })}
      </div>)}
    </div>
    <p id="sudoku-instructions" className="sudoku-instructions">{complete ? 'Puzzle complete. Well done!'
      : conflicts.size ? 'Repeated characters are marked in red. Check their rows, columns, and boxes.'
      : fixed ? 'This is a fixed clue. Choose an editable cell.'
        : scratch ? 'Scratch mode: tap a character to cross it out or restore it.' : 'Fill each row, column, and outlined box with every character once.'}</p>
    <div className="button-row sudoku-controls">
      <button className="button secondary" disabled={busy || !game.history.length} onClick={() => act({ type: 'undo' })}><RotateCcw size={16} /> Undo</button>
      <button className="button secondary" disabled={busy || fixed || complete || (scratch ? !game.excluded[selected] : !selectedValue)}
        aria-label={scratch ? 'Reset scratch markers' : 'Erase'}
        onClick={() => act(scratch ? { type: 'clear-marks', index: selected } : { type: 'place', index: selected, value: 0 })}><Eraser size={16} /> {scratch ? 'Reset' : 'Erase'}</button>
      <button className={`button ${scratch ? 'primary' : 'secondary'}`} disabled={busy || complete} aria-pressed={scratch} onClick={() => setScratch(value => !value)}><Pencil size={16} /> Scratch</button>
    </div>
    <div className="sudoku-palette" role="group" aria-label="Puzzle characters" style={{ '--size': size } as CSSProperties}>
      {game.symbols.map((item, index) => {
        const ruledOut = Boolean(game.excluded[selected] & (1 << index))
        return <button key={item.character} className={scratch && ruledOut ? 'ruled-out' : undefined}
          aria-label={`${scratch ? ruledOut ? 'Restore' : 'Rule out' : 'Place'} ${item.character}`}
          aria-pressed={scratch ? ruledOut : selectedValue === index + 1}
          disabled={busy || fixed || complete || (scratch && Boolean(selectedValue))}
          onClick={() => choose(index + 1)} title={`Keyboard ${index + 1}`}><span lang="zh-Hans">{item.character}</span></button>
      })}
    </div>
    <p className="visually-hidden" role="status">{complete ? 'Solved! This records a game, not language mastery or a review result.' : feedback}</p>
    <details className="sudoku-reference"><summary aria-label="Character key, pronunciation, and rules"><Info size={20} /><span>Character key, pronunciation, and rules</span></summary>
      <div className="button-row">{game.symbols.map((item, index) => <button className="button secondary" key={item.character}
        aria-label={`Learn about ${item.character}`} onClick={() => setFocusSymbol(index + 1)} lang="zh-Hans">{item.character}</button>)}</div>
      <h2 lang="zh-Hans">{symbol.character}</h2>
      {symbol.contexts.length ? <><p className="small muted">In your introduced vocabulary (word context, not a character definition):</p>
        {symbol.contexts.map(context => <div key={`${context.text}:${context.pinyin}:${context.meaning}`} className="sudoku-word-context">
          <p><span lang="zh-Hans">{context.text}</span> / {context.pinyin} / {context.meaning}</p>
          <HearButton text={context.text} locale="zh-Hans" label={`Hear ${context.text}`} />
        </div>)}</> : <p className="small muted">This character was added manually. No introduced word context is available yet.</p>}
      <p>Every row, column, and {box.rows} by {box.columns} box must contain every character exactly once. Each generated puzzle has one solution.</p>
      <p>Scratch starts with the complete character set in each empty cell. Crossed-out markers are your own deductions, not automatic answers. Placing and erasing entries preserves your markers. Undo remembers the last 200 edits.</p>
      <p>Arrow keys move between cells; keys 1–{size} select characters in palette order. N toggles scratch mode; Delete clears an entry.</p>
      <p>Difficulty controls the number of starting clues, not a certified solving-technique grade. Your puzzle is saved in this profile, but is not included in backups or review schedules.</p>
    </details>
  </>
}

export function Sudoku({ workspace, busy, run }: PageProps) {
  const { catalog, error } = useCatalog()
  const characters = useMemo(() => catalog ? sudokuCharacters(catalog, workspace) : [], [catalog, workspace])
  const [size, setSize] = useState<SudokuSize>(9)
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>('easy')
  const [replace, setReplace] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [notice, setNotice] = useState('')
  const generation = useRef<AbortController>()
  useEffect(() => () => generation.current?.abort(), [])
  const saved = useLiveQuery(async () => {
    const value = await db.sudokuGames.get('current')
    if (!value) return { game: undefined }
    try { return { game: readSudokuGame(value) } } catch {
      return { game: undefined, error: 'The saved Sudoku puzzle is invalid. Generate a new puzzle to replace it.' }
    }
  }, [])
  const game = saved?.game
  const complete = game?.values.every((value, index) => value === game.solution[index])
  const start = () => {
    const controller = new AbortController()
    generation.current = controller
    setGenerating(true); setNotice('')
    void run(async () => {
      try {
        const puzzle = await generateSudokuInWorker({ size, difficulty, seed: crypto.getRandomValues(new Uint32Array(1))[0] }, controller.signal)
        controller.signal.throwIfAborted()
        const next = createSudokuGame(puzzle, characters)
        await db.transaction('rw', db.sudokuGames, async () => {
          controller.signal.throwIfAborted()
          await db.sudokuGames.put(next)
          controller.signal.throwIfAborted()
        })
        setReplace(false)
      } catch (reason) {
        if (!controller.signal.aborted) throw reason
      } finally { setGenerating(false) }
    })
  }
  return <div className="sudoku-player">
    <header className="sudoku-heading"><a className="back-link" href="#games"><ArrowLeft size={16} /> Games</a><h1>Character Sudoku</h1>
      {game && !replace && !complete && <button className="icon-button sudoku-new-trigger" disabled={busy} aria-label="New puzzle" title="New puzzle"
        onClick={() => { setSize(game.size); setDifficulty(game.difficulty); setReplace(true) }}><RotateCcw size={20} /></button>}
    </header>
    {saved?.error && <p className="notice error" role="alert">{saved.error}</p>}
    {error && <p className="notice error" role="alert">Character vocabulary could not be loaded. {error}</p>}
    {!saved && <p role="status">Opening your saved puzzle...</p>}
    {game && <SudokuBoard key={game.gameId} game={game} busy={busy} run={run} />}
    {saved && (!game || replace || complete) ? <section className="panel sudoku-setup" aria-label="New Sudoku puzzle">
      <h2>{replace ? 'Replace this puzzle?' : 'Choose your puzzle'}</h2>
      <div className="sudoku-settings">
        <label>Grid size<select value={size} disabled={generating} onChange={event => setSize(sudokuSizeSchema.parse(Number(event.target.value)))}>
          {[4, 6, 9].map(value => <option key={value} value={value}>{value} × {value} ({value} characters)</option>)}
        </select></label>
        <label>Difficulty<select value={difficulty} disabled={generating} onChange={event => setDifficulty(sudokuDifficultySchema.parse(event.target.value))}>
          {sudokuDifficultySchema.options.map(value => <option key={value} value={value}>{difficultyNames[value]}</option>)}
        </select></label>
      </div>
      <p className="small muted">{SUDOKU_CLUES[size][difficulty]} starting clues. Difficulty is approximate and based on clue count; the puzzle always has exactly one solution.</p>
      <p>{catalog ? `${characters.length} distinct characters in your learning set.` : error ? 'Your characters are unavailable.' : 'Loading your characters...'}</p>
      {catalog && characters.length < size && <p>You need {size} characters for this grid. Choose a smaller size or add characters in <a className="text-link" href="#dictionary/characters/knowledge">Dictionary</a>.</p>}
      <p className="small muted">Characters come from introduced words and manual character additions. Generation runs locally without an AI request, and games do not change your learning progress.</p>
      {replace && <p>Your previous puzzle stays saved until the new one is ready.</p>}
      <div className="button-row">
        <button className="button primary" disabled={busy || generating || !catalog || characters.length < size} onClick={start}>{generating ? 'Generating puzzle...' : 'Generate puzzle'}</button>
        {generating ? <button className="button secondary" onClick={() => { generation.current?.abort(); setNotice('Puzzle generation canceled. Your previous puzzle is unchanged.') }}>Cancel generation</button>
          : replace && <button className="button secondary" onClick={() => setReplace(false)}>Keep playing</button>}
      </div>
      {notice && <p className="small" role="status">{notice}</p>}
    </section> : null}
  </div>
}
