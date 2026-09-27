import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, CheckCircle2, Eraser, Info, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { db } from '../core/database'
import type { PageProps } from '../components/shared'
import { useCatalog } from '../components/study/useCatalog'
import { HearButton } from '../components/assistant/SnippetActions'
import { resolveSudokuReadings, sudokuCharacters } from '../core/games/sudoku-characters'
import { generateSudokuPhrase, knownSudokuPhrases, prepareSudokuPhrase } from '../core/games/sudoku-phrases'
import { wordCharacters } from '../core/characters/dictionary'
import { generateSudokuInWorker } from '../core/games/sudoku-client'
import { SUDOKU_BOXES, sudokuDifficultySchema, sudokuSizeSchema, type SudokuDifficulty, type SudokuGame, type SudokuPhrase, type SudokuSize } from '../core/games/sudoku-contracts'
import { SUDOKU_CLUES } from '../core/games/sudoku-generator'
import { createSudokuGame, readSudokuGame, sudokuCheckCounts, sudokuComplete, sudokuEntryValue, type SudokuAction } from '../core/games/sudoku-state'
import { updateSudoku } from '../core/games/sudoku-store'
import { savePreferences } from '../core/learning'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech } from '../core/assistant/speech'
import { readingIndex } from '../core/study/annotate'
import './sudoku.css'

const difficultyNames = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

function SudokuBoard({ game, busy, run, autoSpeak, showPinyin, readings, onNewPuzzle }: {
  game: SudokuGame; autoSpeak: boolean; showPinyin: boolean; readings?: Map<string, Set<string>>; onNewPuzzle: () => void
} & Pick<PageProps, 'busy' | 'run'>) {
  const [selected, setSelected] = useState(() => Math.max(0, game.givens.indexOf(0)))
  const [focusSymbol, setFocusSymbol] = useState(1)
  const [audioSymbol, setAudioSymbol] = useState<number>()
  const speechId = useId()
  const [feedback, setFeedback] = useState('Choose a cell, then a character.')
  const grid = useRef<HTMLDivElement>(null)
  const size = game.size, box = SUDOKU_BOXES[size]
  const values = game.entries.map(sudokuEntryValue)
  const complete = sudokuComplete(game)
  const selectedValue = values[selected]
  const checkedCurrent = game.checked?.every((entries, index) => entries === game.entries[index])
  const counts = checkedCurrent ? sudokuCheckCounts(game) : undefined
  const symbol = game.symbols[focusSymbol - 1]
  const audioTarget = audioSymbol ? game.symbols[audioSymbol - 1] : undefined
  const audioCharacter = audioTarget?.character
  const [resolvedPinyin, setResolvedPinyin] = useState<{ character: string; values: string[]; error?: string }>()
  const selectedPinyin = resolvedPinyin?.character === audioCharacter ? resolvedPinyin : undefined
  const pronunciations = selectedPinyin?.values ?? []
  useEffect(() => {
    if (!showPinyin || !audioTarget) return
    let disposed = false
    void resolveSudokuReadings(audioTarget, readings?.get(audioTarget.character)).then(values => {
      if (!disposed) setResolvedPinyin({ character: audioTarget.character, values })
    }, error => {
      if (!disposed) setResolvedPinyin({ character: audioTarget.character, values: [], error: error instanceof Error ? error.message : 'Pinyin could not be loaded.' })
    })
    return () => { disposed = true }
  }, [showPinyin, audioTarget, readings])
  const fixed = game.givens[selected] !== 0
  const editable = !fixed && !complete
  useEffect(() => () => {
    if (getPlaybackState().activeId === speechId) stopBrowserSpeech()
  }, [speechId])
  useEffect(() => {
    if (!autoSpeak && getPlaybackState().activeId === speechId) stopBrowserSpeech()
  }, [autoSpeak, speechId])
  const activateSymbol = (value: number) => {
    setFocusSymbol(value)
    setAudioSymbol(value)
    if (autoSpeak) playBrowserSpeech(speechId, game.symbols[value - 1].character, 'zh-Hans')
  }
  const act = (action: SudokuAction) => void run(async () => {
    const next = await updateSudoku(game, action)
    const counts = action.type === 'check' ? sudokuCheckCounts(next) : undefined
    setFeedback(counts ? `${counts.correct} correct, ${counts.incorrect} wrong, ${counts.unresolved} unresolved.`
      : action.type === 'undo' ? 'Last move undone.' : 'Entries saved. Press Check to assess your proposed answers.')
  })
  const choose = (value: number) => {
    if (editable) {
      act({ type: 'toggle', index: selected, value })
      grid.current?.querySelector<HTMLButtonElement>(`[data-cell-index="${selected}"]`)?.focus({ preventScroll: true })
    }
    activateSymbol(value)
  }
  const selectCell = (index: number) => {
    setSelected(index)
    if (values[index]) setFocusSymbol(values[index])
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
    } else if (!busy && !fixed && !complete) {
      if (/^[1-9]$/.test(event.key) && Number(event.key) <= size) { event.preventDefault(); choose(Number(event.key)) }
      else if (['Backspace', 'Delete', '0'].includes(event.key)) { event.preventDefault(); act({ type: 'clear', index: selected }) }
    }
  }
  return <>
    <button className="icon-button sudoku-sound-toggle" disabled={busy}
      aria-label={`${autoSpeak ? 'Mute' : 'Unmute'} automatic character audio`} aria-pressed={!autoSpeak}
      title={autoSpeak ? 'Mute automatic character audio' : 'Unmute automatic character audio'}
      onClick={() => {
        if (autoSpeak) stopBrowserSpeech()
        void run(() => savePreferences({ sudokuAutoSpeak: !autoSpeak }))
      }}>{autoSpeak ? <Volume2 size={20} /> : <VolumeX size={20} />}</button>
    <div className="sudoku-meta"><span>{size} × {size} / {difficultyNames[game.difficulty]}</span>
      <span>{values.filter(Boolean).length} / {size ** 2} filled</span></div>
    {game.phrase && <div className="sudoku-source-phrase">
      <p lang="zh-Hans" title={game.phrase.text}>{game.phrase.text}</p>
      <HearButton text={game.phrase.text} locale="zh-Hans" label="Hear source phrase" iconOnly />
    </div>}
    <div ref={grid} className="sudoku-grid" role="grid" aria-label={`${size} by ${size} character Sudoku`} aria-describedby="sudoku-instructions"
      data-assistant-protected="true" style={{ '--size': size, '--notes-columns': size === 4 ? 2 : 3 } as CSSProperties}>
      {Array.from({ length: size }, (_, row) => <div role="row" className="sudoku-row" key={row}>
        {Array.from({ length: size }, (_, column) => {
          const index = row * size + column, value = values[index], given = game.givens[index] !== 0
          const peer = row === Math.floor(selected / size) || column === selected % size
            || (Math.floor(row / box.rows) === Math.floor(Math.floor(selected / size) / box.rows) && Math.floor(column / box.columns) === Math.floor(selected % size / box.columns))
          const candidates = game.symbols.filter((_, symbolIndex) => game.entries[index] & (1 << symbolIndex)).map(item => item.character)
          const grade = !given && value && game.checked?.[index] === game.entries[index] ? value === game.solution[index] ? 'correct' : 'incorrect' : undefined
          return <button key={index} type="button" role="gridcell" data-cell-index={index} tabIndex={selected === index ? 0 : -1}
            aria-selected={selected === index} aria-readonly={given || complete} aria-disabled={busy}
            aria-invalid={grade === 'incorrect'}
            aria-label={`Row ${row + 1}, column ${column + 1}: ${value ? game.symbols[value - 1].character : candidates.length ? `candidates ${candidates.join(', ')}` : 'empty'}${given ? ', clue' : ''}${grade ? `, ${grade}` : ''}`}
            className={`sudoku-cell${given ? ' given' : ''}${peer ? ' peer' : ''}${selectedValue && value === selectedValue ? ' same-character' : ''}${grade ? ` checked-${grade}` : ''}`}
            style={{ borderRightWidth: column === size - 1 ? 0 : (column + 1) % box.columns === 0 ? 2 : 1,
              borderBottomWidth: row === size - 1 ? 0 : (row + 1) % box.rows === 0 ? 2 : 1 }}
            onClick={event => {
              if (busy) return
              selectCell(index)
              const marker = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-sudoku-symbol]') : null
              const clicked = marker ? Number(marker.dataset.sudokuSymbol) : value
              if (clicked) activateSymbol(clicked)
            }} onFocus={() => selectCell(index)} onKeyDown={event => keyDown(event, index)}>
            {value ? <span lang="zh-Hans">{game.symbols[value - 1].character}</span> : candidates.length > 0 && <span className="sudoku-candidates" aria-hidden="true" lang="zh-Hans">
              {game.symbols.map((item, symbolIndex) => <span key={item.character} data-sudoku-symbol={game.entries[index] & (1 << symbolIndex) ? symbolIndex + 1 : undefined}>
                {game.entries[index] & (1 << symbolIndex) ? item.character : ''}
              </span>)}
            </span>}
          </button>
        })}
      </div>)}
    </div>
    <p id="sudoku-instructions" className="sudoku-instructions">{complete ? 'Puzzle complete. Well done!'
      : counts ? `${counts.correct} correct, ${counts.incorrect} wrong, ${counts.unresolved} unresolved.`
      : fixed ? 'This is a fixed clue. Choose an editable cell.'
        : 'Tap characters to add or remove entries. One is an answer; several are candidates.'}</p>
    {showPinyin && audioCharacter && <p className="sudoku-selected-pinyin" role="status">
      <span lang="zh-Hans">{audioCharacter}</span>{' / '}
      {pronunciations.length ? <>{pronunciations.length > 1 && 'Possible readings: '}<span lang="zh-Latn">{pronunciations.join(' / ')}</span></>
        : selectedPinyin?.error ? 'Pinyin could not be loaded. Reload to try again.'
          : selectedPinyin ? 'No reading was found in the word context or local dictionary.' : 'Loading pinyin...'}
    </p>}
    <div className="button-row sudoku-controls">
      <button className="button secondary" disabled={busy || !game.history.length} onClick={() => act({ type: 'undo' })}><RotateCcw size={16} /> Undo</button>
      <button className="button secondary" disabled={busy || fixed || complete || !game.entries[selected]} onClick={() => act({ type: 'clear', index: selected })}><Eraser size={16} /> Erase</button>
      <button className="button secondary" disabled={busy} onClick={() => act({ type: 'check' })}><CheckCircle2 size={16} /> Check</button>
      <HearButton key={audioCharacter ?? 'unselected'} text={audioCharacter ?? ''} locale="zh-Hans"
        label={audioCharacter ? `Hear character ${audioCharacter}` : 'Hear selected character'} buttonText={audioCharacter ? `Hear ${audioCharacter}` : 'Hear'}
        disabled={!audioCharacter} />
    </div>
    <div className="sudoku-palette" role="group" aria-label="Puzzle characters" style={{ '--size': size } as CSSProperties}>
      {game.symbols.map((item, index) => {
        const included = Boolean(game.entries[selected] & (1 << index))
        return <button key={item.character}
          aria-label={`${!editable ? 'Select' : included ? 'Remove' : 'Add'} ${item.character}`}
          aria-pressed={included}
          disabled={busy}
          onClick={() => choose(index + 1)} title={`Keyboard ${index + 1}`}><span lang="zh-Hans">{item.character}</span></button>
      })}
    </div>
    <p className="visually-hidden" role="status">{complete ? 'Solved! This records a game, not language mastery or a review result.' : feedback}</p>
    <details className="sudoku-reference"><summary aria-label="Character key, pronunciation, and rules"><Info size={20} /><span>Character key, pronunciation, and rules</span></summary>
      <label className="toggle sudoku-pinyin-toggle"><input type="checkbox" checked={showPinyin} disabled={busy}
        onChange={event => void run(() => savePreferences({ sudokuShowPinyin: event.target.checked }))} /> Show pinyin on selection</label>
      <p>Character clicks speak by default. The speaker button mutes automatic playback; Hear still works when muted. These settings are saved in this profile.</p>
      <p>Your selected Mandarin voice and speed are used. Online voices may send the character to the voice service. Isolated characters can have multiple readings; the voice may choose a different one from the word context.</p>
      {game.phrase && <div className="sudoku-phrase-details"><h2>Source phrase</h2><p lang="zh-Hans">{game.phrase.text}</p>
        <p>{game.phrase.pinyin}</p>{game.phrase.translation && <p>{game.phrase.translation}</p>}
        <p>The palette uses the first {game.size} distinct characters in reading order. Repeated characters share a symbol; later characters are not added to the puzzle.</p>
      </div>}
      <div className="button-row">{game.symbols.map((item, index) => <button className="button secondary" key={item.character}
        aria-label={`Learn about ${item.character}`} onClick={() => activateSymbol(index + 1)} lang="zh-Hans">{item.character}</button>)}</div>
      <h2 lang="zh-Hans">{symbol.character}</h2>
      {symbol.contexts.length ? <><p className="small muted">{game.phrase ? 'In your source phrase:' : 'In your introduced vocabulary (word context, not a character definition):'}</p>
        {symbol.contexts.map(context => <div key={`${context.text}:${context.pinyin}:${context.meaning}`} className="sudoku-word-context">
          <p><span lang="zh-Hans">{context.text}</span> / {context.pinyin} / {context.meaning}</p>
          <HearButton text={context.text} locale="zh-Hans" label={`Hear ${context.text}`} />
        </div>)}</> : <p className="small muted">This character was added manually. No introduced word context is available yet.</p>}
      <p>Every row, column, and {box.rows} by {box.columns} box must contain every character exactly once. Each generated puzzle has one solution.</p>
      <p>Tap palette characters to add or remove entries. Multiple entries remain candidates; a single entry is the cell's proposed answer. Check grades single-entry answers against the solution, leaving empty and multi-entry cells unresolved. Changed entries are ungraded until checked again. Undo remembers the last 200 edits.</p>
      <p>Arrow keys move between cells; keys 1–{size} toggle characters in palette order. Delete clears a cell's entries.</p>
      <p>Difficulty controls the number of starting clues, not a certified solving-technique grade. Your puzzle is saved in this profile, but is not included in backups or review schedules.</p>
      <p>Pinyin follows the containing word or sentence. Supplied readings are preserved when they align; otherwise the local contextual dictionary is used. Polyphones and tone changes may still need review.</p>
      <button className="button secondary" disabled={busy} onClick={onNewPuzzle}>New puzzle</button>
    </details>
  </>
}

export function Sudoku({ workspace, busy, run }: PageProps) {
  const { catalog, error } = useCatalog()
  const characters = useMemo(() => catalog ? sudokuCharacters(catalog, workspace) : [], [catalog, workspace])
  const readings = useMemo(() => catalog ? readingIndex(catalog.units.values()) : undefined, [catalog])
  const phrases = useMemo(() => catalog ? knownSudokuPhrases(catalog, workspace) : [], [catalog, workspace])
  const connection = useLiveQuery(() => db.aiConnections.get('assistant').then(value => value ?? null), [])
  const [sourceMode, setSourceMode] = useState<'random' | 'lesson' | 'custom' | 'ai'>('random')
  const [lessonPhraseId, setLessonPhraseId] = useState('')
  const [customText, setCustomText] = useState('')
  const [customTranslation, setCustomTranslation] = useState('')
  const [aiPhrase, setAiPhrase] = useState<SudokuPhrase>()
  const [suggesting, setSuggesting] = useState(false)
  const [size, setSize] = useState<SudokuSize>(9)
  const [difficulty, setDifficulty] = useState<SudokuDifficulty>('easy')
  const [replace, setReplace] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [notice, setNotice] = useState('')
  const generation = useRef<AbortController>()
  const suggestion = useRef<AbortController>()
  useEffect(() => () => { generation.current?.abort(); suggestion.current?.abort() }, [])
  const saved = useLiveQuery(async () => {
    const value = await db.sudokuGames.get('current')
    if (!value) return { game: undefined }
    try { return { game: readSudokuGame(value) } } catch {
      return { game: undefined, error: 'The saved Sudoku puzzle is invalid. Generate a new puzzle to replace it.' }
    }
  }, [])
  const game = saved?.game
  const complete = game ? sudokuComplete(game) : false
  const selectedPhrase: SudokuPhrase | undefined = sourceMode === 'lesson' ? phrases.find(phrase => phrase.id === lessonPhraseId) ?? phrases[0]
    : sourceMode === 'custom' ? { source: 'custom', text: customText, pinyin: '', translation: customTranslation }
      : sourceMode === 'ai' ? aiPhrase : undefined
  const phraseCharacters = selectedPhrase ? wordCharacters(selectedPhrase.text) : []
  const knownCharacters = new Set(characters.map(symbol => symbol.character))
  const unknown = phraseCharacters.slice(0, size).filter(character => !knownCharacters.has(character))
  const phraseReady = sourceMode === 'random' || (Boolean(selectedPhrase) && phraseCharacters.length >= size && unknown.length === 0)
  const sourceBusy = generating || suggesting
  const newPuzzle = () => {
    if (!game) return
    setSize(game.size); setDifficulty(game.difficulty)
    const previousPhrase = game.phrase
    if (previousPhrase) {
      if (previousPhrase.source === 'lesson' && phrases.some(phrase => phrase.id === previousPhrase.id)) {
        setSourceMode('lesson'); setLessonPhraseId(previousPhrase.id ?? '')
      } else if (previousPhrase.source === 'ai') {
        setSourceMode('ai'); setAiPhrase(previousPhrase)
      } else {
        // Retain editable source text even if an authored example was removed.
        setSourceMode('custom'); setCustomText(previousPhrase.text); setCustomTranslation(previousPhrase.translation)
      }
    } else setSourceMode('random')
    setReplace(true)
  }
  const suggestPhrase = () => {
    if (!catalog) return
    const controller = new AbortController()
    suggestion.current = controller
    setSuggesting(true); setNotice('')
    void run(async () => {
      try {
        const phrase = await generateSudokuPhrase(catalog, workspace, size, controller.signal)
        controller.signal.throwIfAborted()
        setAiPhrase(phrase)
      } catch (reason) {
        if (!controller.signal.aborted) throw reason
      } finally { setSuggesting(false) }
    })
  }
  const start = () => {
    const controller = new AbortController()
    generation.current = controller
    setGenerating(true); setNotice('')
    void run(async () => {
      try {
        const prepared = sourceMode !== 'random' && selectedPhrase ? await prepareSudokuPhrase(selectedPhrase, characters, size) : undefined
        if (sourceMode !== 'random' && !prepared) throw new Error('Choose a phrase before generating the puzzle.')
        controller.signal.throwIfAborted()
        const puzzle = await generateSudokuInWorker({ size, difficulty, seed: crypto.getRandomValues(new Uint32Array(1))[0] }, controller.signal)
        controller.signal.throwIfAborted()
        const next = createSudokuGame(puzzle, prepared?.symbols ?? characters, Math.random, prepared?.phrase)
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
    </header>
    {saved?.error && <p className="notice error" role="alert">{saved.error}</p>}
    {error && <p className="notice error" role="alert">Character vocabulary could not be loaded. {error}</p>}
    {!saved && <p role="status">Opening your saved puzzle...</p>}
    {game && <SudokuBoard key={game.gameId} game={game} busy={busy} run={run}
      autoSpeak={workspace.preferences.sudokuAutoSpeak !== false} showPinyin={workspace.preferences.sudokuShowPinyin === true} readings={readings}
      onNewPuzzle={newPuzzle} />}
    {saved && (!game || replace || complete) ? <section className="panel sudoku-setup" aria-label="New Sudoku puzzle">
      <h2>{replace ? 'Replace this puzzle?' : 'Choose your puzzle'}</h2>
      <div className="sudoku-settings">
        <label>Grid size<select value={size} disabled={sourceBusy} onChange={event => setSize(sudokuSizeSchema.parse(Number(event.target.value)))}>
          {[4, 6, 9].map(value => <option key={value} value={value}>{value} × {value} ({value} characters)</option>)}
        </select></label>
        <label>Difficulty<select value={difficulty} disabled={sourceBusy} onChange={event => setDifficulty(sudokuDifficultySchema.parse(event.target.value))}>
          {sudokuDifficultySchema.options.map(value => <option key={value} value={value}>{difficultyNames[value]}</option>)}
        </select></label>
      </div>
      <label className="sudoku-source-label">Character source<select value={sourceMode} disabled={sourceBusy} onChange={event => {
        const value = event.target.value
        if (value === 'random' || value === 'lesson' || value === 'custom' || value === 'ai') setSourceMode(value)
      }}>
        <option value="random">Random characters</option><option value="lesson">Known-vocabulary lesson examples</option>
        <option value="custom">Type or paste a phrase</option><option value="ai">Generate a phrase with AI</option>
      </select></label>
      {sourceMode === 'lesson' && <label className="sudoku-source-label">Lesson phrase<select value={selectedPhrase?.id ?? ''} disabled={sourceBusy || !phrases.length} onChange={event => setLessonPhraseId(event.target.value)}>
        {!phrases.length && <option value="">No eligible examples yet</option>}
        {phrases.map(phrase => <option key={phrase.id} value={phrase.id}>{phrase.text} ({wordCharacters(phrase.text).length} distinct characters)</option>)}
      </select></label>}
      {sourceMode === 'custom' && <div className="sudoku-custom-phrase">
        <label>Chinese phrase or sentence<textarea value={customText} maxLength={400} disabled={sourceBusy} onChange={event => setCustomText(event.target.value)} /></label>
        <label>English meaning (optional)<input value={customTranslation} maxLength={1000} disabled={sourceBusy} onChange={event => setCustomTranslation(event.target.value)} /></label>
      </div>}
      {sourceMode === 'ai' && <div className="sudoku-ai-phrase">
        <p className="small muted">Only this button sends your known vocabulary to your configured AI provider. Review its sentence before making a puzzle.</p>
        {!connection && <p><a className="text-link" href="#settings">Connect AI in Settings</a> to request a phrase.</p>}
        <button className="button secondary" disabled={busy || sourceBusy || !connection || !catalog} onClick={suggestPhrase}>{suggesting ? 'Requesting phrase...' : 'Suggest phrase with AI'}</button>
        {suggesting && <button className="button secondary" onClick={() => { suggestion.current?.abort(); setNotice('AI phrase request canceled. No puzzle changed.') }}>Cancel phrase request</button>}
      </div>}
      {sourceMode !== 'random' && selectedPhrase?.text && <div className="sudoku-phrase-preview"><p lang="zh-Hans">{selectedPhrase.text}</p>
        {selectedPhrase.translation && <p className="small muted">{selectedPhrase.translation}</p>}
        <p className="small muted">Palette order: <span lang="zh-Hans">{phraseCharacters.slice(0, size).join(' · ')}</span></p>
      </div>}
      {sourceMode !== 'random' && <p className="small muted">Use the first {size} distinct characters in phrase order. Repeats are deduplicated and any additional characters are ignored.</p>}
      {sourceMode !== 'random' && phraseCharacters.length < size && <p>This source has {phraseCharacters.length} distinct characters. Choose a smaller grid or a longer phrase.</p>}
      {unknown.length > 0 && <p className="notice error">Add these characters to your learning set first: {unknown.join(' ')}</p>}
      <p className="small muted">{SUDOKU_CLUES[size][difficulty]} starting clues. Difficulty is approximate and based on clue count; the puzzle always has exactly one solution.</p>
      <p>{catalog ? `${characters.length} distinct characters in your learning set.` : error ? 'Your characters are unavailable.' : 'Loading your characters...'}</p>
      {catalog && characters.length < size && <p>You need {size} characters for this grid. Choose a smaller size or add characters in <a className="text-link" href="#dictionary/characters/knowledge">Dictionary</a>.</p>}
      <p className="small muted">Puzzle generation runs locally; only an explicit AI phrase request uses your provider. Games do not change your learning progress.</p>
      {replace && <p>Your previous puzzle stays saved until the new one is ready.</p>}
      <div className="button-row">
        <button className="button primary" disabled={busy || sourceBusy || !catalog || characters.length < size || !phraseReady} onClick={start}>{generating ? 'Generating puzzle...' : 'Generate puzzle'}</button>
        {generating ? <button className="button secondary" onClick={() => { generation.current?.abort(); setNotice('Puzzle generation canceled. Your previous puzzle is unchanged.') }}>Cancel generation</button>
          : replace && <button className="button secondary" onClick={() => setReplace(false)}>Keep playing</button>}
      </div>
      {notice && <p className="small" role="status">{notice}</p>}
    </section> : null}
  </div>
}
