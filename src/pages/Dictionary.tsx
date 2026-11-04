import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../core/database'
import { savePreferences } from '../core/learning'
import { PenLine, Search } from 'lucide-react'
import { normalizeSearch } from '../core/search'
import { formatPinyin } from '../core/pinyin'
import { catalogBands, catalogCounts, type Unit } from '../core/study/catalog'
import { cardId, type UnitKind } from '../core/study/contracts'
import { buildAddedByIndex } from '../core/study/addedby'
import { DOMAIN } from '../core/study/knowledge'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { UnitCard } from '../components/study/UnitCard'
import { SourceEntryCard } from '../components/study/SourceEntryCard'
import { useCatalog } from '../components/study/useCatalog'
import { guidedChars, writtenCharacters } from '../core/drills/write-queue'
import { setCharactersWriteState, undoWriteChanges, type WriteChange } from '../core/characters/store'
import { hasGuide } from '../core/characters/writing-route'
import { characterKnowledge, dictionaryCharacters } from '../core/characters/dictionary'
import { characterAttributionUrl } from '../core/characters/assets'
import { CharacterCard } from '../components/characters/CharacterCard'
import { HandwritingPad } from '../components/characters/HandwritingPad'
import { TERM } from '../core/collections/terms'
import './writing.css'

const PAGE = 48

function searchText(unit: Unit): string {
  return normalizeSearch(unit.kind === 'vocabulary'
    ? `${unit.record.ch} ${unit.record.pr} ${unit.record.ds} ${unit.record.lb}`
    : `${unit.record.pt} ${unit.record.pr} ${unit.record.ds} ${unit.record.lb}`)
}

export function Dictionary({ workspace, now, run, busy, section, initialScope, initialQuery, initialWrite }: PageProps & { section?: string; initialScope?: string; initialQuery?: string; initialWrite?: string }) {
  const { catalog, error } = useCatalog()
  const kind: UnitKind | 'characters' = section === 'characters' ? 'characters' : section === 'grammar' ? 'grammar' : 'vocabulary'
  const explicit = initialScope === 'knowledge' || initialScope === 'all' || initialScope === 'collections' || initialScope === 'media' ? initialScope : undefined
  const scope: 'all' | 'knowledge' | 'collections' | 'media' = explicit ?? workspace.preferences.dictionaryScope ?? 'all'
  // Words drawn from the learner's media sources (pass 2 of the annotated source).
  const sourceEntries = useLiveQuery(() => db.sourceEntries.orderBy('word').toArray(), []) ?? []
  // Items gathered in collections (not necessarily in the knowledge set).
  const collected = useLiveQuery(async () => new Set((await db.collectionItems.toArray()).map(item => item.ref)), []) ?? new Set<string>()
  useEffect(() => {
    if (explicit && explicit !== 'collections' && explicit !== 'media' && explicit !== workspace.preferences.dictionaryScope) void savePreferences({ dictionaryScope: explicit }).catch(() => undefined)
  }, [explicit, workspace.preferences.dictionaryScope])
  // The second layer inside "My knowledge set" for Characters: All, Can write (practised or flagged) or Not yet (everything else, including characters without a stroke guide).
  const explicitWrite = initialWrite === 'all' || initialWrite === 'can' || initialWrite === 'not' ? initialWrite : undefined
  const writeFilter: 'all' | 'can' | 'not' = explicitWrite ?? workspace.preferences.characterWriteFilter ?? 'all'
  useEffect(() => {
    if (explicitWrite && explicitWrite !== workspace.preferences.characterWriteFilter) void savePreferences({ characterWriteFilter: explicitWrite }).catch(() => undefined)
  }, [explicitWrite, workspace.preferences.characterWriteFilter])
  const go = (section: string, next: 'all' | 'knowledge' | 'collections' | 'media', write: 'all' | 'can' | 'not' = writeFilter) => { window.location.hash = `dictionary/${section}/${next}${section === 'characters' && next === 'knowledge' && write !== 'all' ? `?write=${write}` : ''}` }
  const [band, setBand] = useState('all')
  const [query, setQuery] = useState(initialQuery ?? '')
  const [limit, setLimit] = useState(PAGE)
  const [drawing, setDrawing] = useState(false)
  // Select mode (like History's): picked maps an item's key to its text (the character, or the word) so a bulk action knows what to mark.
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(new Map())
  const [undo, setUndo] = useState<{ changes: WriteChange[]; label: string } | null>(null)
  useEffect(() => { setSelecting(false); setPicked(new Map()) }, [kind, scope])
  useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(null), 10000); return () => clearTimeout(timer) }, [undo])
  // One lookup for every card on the page, rebuilt when the lessons, sets or knowledge set change.
  const addedIndex = useLiveQuery(buildAddedByIndex, [])
  const entries = new Map(workspace.knowledge.map(entry => [entry.ref, entry]))
  const known = new Set(workspace.knowledge.map(entry => entry.ref))
  const inScope = (ref: string) => scope === 'all' || (scope === 'knowledge' ? known.has(ref) : collected.has(ref))
  const characters = useMemo(() => catalog ? dictionaryCharacters(catalog, undefined, workspace.characterStates) : [], [catalog, workspace.characterStates])
  const characterSet = useMemo(() => catalog ? characterKnowledge(catalog, workspace.knowledge, workspace.characterStates) : undefined,
    [catalog, workspace.knowledge, workspace.characterStates])
  const knownCounts = { vocabulary: workspace.knowledge.filter(entry => entry.kind === 'vocabulary').length, grammar: workspace.knowledge.filter(entry => entry.kind === 'grammar').length, characters: characterSet?.all.size ?? 0 }
  const collectedCount = (value: UnitKind) => [...collected].filter(ref => ref.startsWith(`${value}:`)).length
  const tabCount = (value: UnitKind | 'characters') => scope === 'media' ? (value === 'vocabulary' ? sourceEntries.length : 0) : scope === 'collections' ? (value === 'characters' ? 0 : collectedCount(value)) : scope === 'knowledge' ? knownCounts[value] : value === 'characters' ? characters.length : catalogCounts[value]
  const bandCounts = new Map<string, number>()
  if (catalog) {
    const bump = (value: string) => bandCounts.set(value, (bandCounts.get(value) ?? 0) + 1)
    if (kind === 'characters') for (const entry of characters) { if (scope !== 'knowledge' || characterSet?.all.has(entry.character)) for (const value of new Set(entry.bands)) bump(value) }
    else for (const unit of catalog.units.values()) if (unit.kind === kind && inScope(unit.ref)) bump(unit.band)
  }
  // Handwriting candidates stay inside the catalog; the Characters section also honours its scope.
  const drawable = useMemo(() => new Set(characters.filter(entry => scope !== 'knowledge' || characterSet?.all.has(entry.character)).map(entry => entry.character)),
    [characters, characterSet, scope])
  const normalized = normalizeSearch(query)
  const pronunciationQuery = normalizeSearch(formatPinyin(query, 'marks'))
  const matchesReading = (reading: string) => pronunciationQuery !== normalized && normalizeSearch(reading).includes(pronunciationQuery)
  const rank = (own: string, exact: string[]) => !normalized ? 2 : exact.some(value => normalizeSearch(value) === normalized) ? 0 : normalizeSearch(own).includes(normalized) ? 1 : 2
  const byRank = <T,>(items: T[], rankOf: (item: T) => number): T[] => items.map((item, index) => ({ item, index, rank: rankOf(item) })).sort((a, b) => a.rank - b.rank || a.index - b.index).map(entry => entry.item)
  const matches = catalog ? byRank([...catalog.units.values()].filter(unit => unit.kind === kind
    && inScope(unit.ref)
    && (band === 'all' || unit.band === band)
    && (!normalized || searchText(unit).includes(normalized) || matchesReading(unit.record.pr))), unit => rank('', [unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt])) : []
  const written = useMemo(() => writtenCharacters(workspace.characterStates), [workspace.characterStates])
  const inWriteFilter = (character: string) => scope !== 'knowledge' || writeFilter === 'all' || (writeFilter === 'can') === written.has(character)
  const setCharacters = characters.filter(entry => characterSet?.all.has(entry.character))
  const canWriteCount = setCharacters.filter(entry => written.has(entry.character)).length
  const characterMatches = kind === 'characters' ? byRank(characters.filter(entry => (scope !== 'knowledge' || characterSet?.all.has(entry.character)) && inWriteFilter(entry.character)
    && (band === 'all' || entry.bands.some(value => value === band))
    && (!normalized || normalizeSearch(`${entry.character} U+${entry.character.codePointAt(0)!.toString(16)} ${entry.words.map(word => `${word.record.ch} ${word.record.pr} ${word.record.ds}`).join(' ')}`).includes(normalized)
      || entry.words.some(word => matchesReading(word.record.pr)))), entry => { const code = `U+${entry.character.codePointAt(0)!.toString(16)}`; return rank(`${entry.character} ${code}`, [entry.character, code]) }) : []
  const sourceMatches = byRank(sourceEntries.filter(entry => (!normalized || normalizeSearch(`${entry.word} ${entry.pinyin} ${entry.meanings.join(' ')} ${entry.sources.map(source => source.title).join(' ')}`).includes(normalized) || matchesReading(entry.pinyin))
    && (scope === 'media' || (kind === 'vocabulary' && !!normalized && (scope === 'all' || (scope === 'knowledge' && known.has(`source:${entry.id}`)) || (scope === 'collections' && collected.has(`source:${entry.id}`)))))), entry => rank('', [entry.word]))
  const count = scope === 'media' ? sourceMatches.length : (kind === 'characters' ? characterMatches.length : matches.length)
  const selectable = scope !== 'collections' && (kind === 'characters' || kind === 'vocabulary')
  const togglePick = (key: string, text: string) => setPicked(previous => { const next = new Map(previous); if (next.has(key)) next.delete(key); else next.set(key, text); return next })
  const pickRow = (key: string, text: string, label: string) => selecting
    ? <label className="select-pick"><input type="checkbox" checked={picked.has(key)} onChange={() => togglePick(key, text)} aria-label={`Select ${label}`} /><span className="small">{picked.has(key) ? 'Selected' : 'Select'}</span></label> : null
  const wordCharacters = (zh: string) => guidedChars(zh, hasGuide)
  /** A vocabulary card's derived tag: Can write when all its guided characters can be written, otherwise how many are left. */
  const writeTag = (zh: string) => { const chars = wordCharacters(zh); if (!chars.length) return null
    const left = new Set(chars.filter(character => !written.has(character))).size
    return left ? <span className="tag not-yet">{left} to write</span> : <span className="tag can-write">Can write</span> }
  const bulk = (state: 'can' | 'cannot') => {
    const targets = [...new Set([...picked.values()].flatMap(text => kind === 'characters' ? [text] : wordCharacters(text)))]
    void run(async () => {
      const changes = await setCharactersWriteState(targets, state)
      const label = `${changes.length} ${changes.length === 1 ? 'character' : 'characters'}`
      setUndo({ changes, label: changes.length ? `Marked ${label} ${state === 'can' ? 'can write' : 'not yet'}.` : `Nothing to change: they were already ${state === 'can' ? 'can write' : 'not yet'}.` })
      setPicked(new Map())
    })
  }
  const restore = () => { if (!undo) return; const { changes } = undo; setUndo(null); void run(() => undoWriteChanges(changes)) }
  const pageEntries: [string, string][] = kind === 'characters' ? characterMatches.slice(0, limit).map(entry => [entry.character, entry.character] as [string, string])
    : [...(scope === 'media' ? [] : matches.slice(0, limit).flatMap(unit => unit.kind === 'vocabulary' ? [[unit.ref, unit.record.ch] as [string, string]] : [])), ...sourceMatches.slice(0, limit).map(entry => [`source:${entry.id}`, entry.word] as [string, string])]
  const allPicked = pageEntries.length > 0 && pageEntries.every(([key]) => picked.has(key))
  const select = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setLimit(PAGE) }
  return <>
    <PageHeading eyebrow="THE WHOLE CURRICULUM" title={kind === 'characters' ? 'Characters, one stroke at a time.' : 'Vocabulary and grammar, by band.'}>
      {kind === 'characters' ? 'Your character set includes characters from words in your knowledge set, plus any you add manually. Practice their strokes here; inclusion does not claim writing proficiency.'
        : 'Every HSK 1-6 sense and construction in the curriculum, separate from your knowledge set. Adding an item makes it eligible for review; it does not claim you know it.'}</PageHeading>
    {error && <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>}
    <div className="library-toolbar">
      <div className="segmented" role="group" aria-label="Dictionary section">
        <button aria-pressed={kind === 'vocabulary'} onClick={() => { go('vocabulary', scope) }}>Vocabulary ({tabCount('vocabulary').toLocaleString('en-US')})</button>
        <button aria-pressed={kind === 'grammar'} onClick={() => { go('grammar', scope) }}>Grammar ({tabCount('grammar').toLocaleString('en-US')})</button>
        <button aria-pressed={kind === 'characters'} onClick={() => { go('characters', scope) }}>Characters{catalog ? ` (${tabCount('characters').toLocaleString('en-US')})` : ''}</button>
      </div>
      <div className="segmented" role="group" aria-label="Dictionary scope">
        <button aria-pressed={scope === 'all'} onClick={() => { setLimit(PAGE); go(kind, 'all') }}>Full list</button>
        <button aria-pressed={scope === 'knowledge'} onClick={() => { setLimit(PAGE); go(kind, 'knowledge') }}>My knowledge set ({knownCounts[kind]})</button>
        <button aria-pressed={scope === 'media'} onClick={() => { setLimit(PAGE); go('vocabulary', 'media') }}>From your media ({sourceEntries.length})</button>
        {kind !== 'characters' && <button aria-pressed={scope === 'collections'} onClick={() => { setLimit(PAGE); go(kind, 'collections') }}>In {TERM.plural} ({collectedCount(kind)})</button>}
      </div>
      <div className="search-field"><Search size={18} /><input type="search" value={query} onChange={event => select(setQuery)(event.target.value)} placeholder={kind === 'characters' ? 'Character, codepoint, or containing word' : kind === 'vocabulary' ? 'Character, pinyin, or meaning' : 'Pattern, pinyin, or meaning'} aria-label="Search dictionary" />
        <button type="button" className="search-draw" aria-expanded={drawing} disabled={!catalog} onClick={() => setDrawing(value => !value)}><PenLine size={16} />Draw</button></div>
      <label className="filter-label">Band <select value={band} onChange={event => select(setBand)(event.target.value)}><option value="all">All bands</option>{catalogBands.map(value => <option key={value} value={value}>HSK {value}{catalog ? ` (${(bandCounts.get(value) ?? 0).toLocaleString('en-US')})` : ''}</option>)}</select></label>
    </div>
    {selectable && <div className="select-bar" role="toolbar" aria-label="Select">
      <button type="button" className="button secondary" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setPicked(new Map()) }}>{selecting ? 'Done' : 'Select'}</button>
      {selecting && !picked.size && <button type="button" className="button secondary" onClick={() => setPicked(new Map(pageEntries))}>Select all on this page</button>}
      {selecting && picked.size > 0 && <>
        <span className="select-count" role="status">{picked.size} selected</span>
        <button type="button" className="button primary" disabled={busy} onClick={() => bulk('can')}>{kind === 'characters' ? 'Mark can write' : 'Mark characters can write'}</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => bulk('cannot')}>{kind === 'characters' ? 'Mark not yet' : 'Mark characters not yet'}</button>
        <button type="button" className="button secondary" onClick={() => setPicked(allPicked ? new Map() : new Map(pageEntries))}>{allPicked ? 'Clear this page' : 'Select all on this page'}</button>
        <button type="button" className="button secondary" onClick={() => setPicked(new Map())}>Clear</button></>}
    </div>}
    {kind === 'characters' && scope === 'knowledge' && <div className="segmented" role="group" aria-label="Writing filter">
      <button aria-pressed={writeFilter === 'all'} onClick={() => { setLimit(PAGE); go('characters', 'knowledge', 'all') }}>All {setCharacters.length}</button>
      <button aria-pressed={writeFilter === 'can'} onClick={() => { setLimit(PAGE); go('characters', 'knowledge', 'can') }}>Can write {canWriteCount}</button>
      <button aria-pressed={writeFilter === 'not'} onClick={() => { setLimit(PAGE); go('characters', 'knowledge', 'not') }}>Not yet {setCharacters.length - canWriteCount}</button>
    </div>}
    {drawing && <HandwritingPad allowed={drawable} onClose={() => setDrawing(false)} onPick={character => select(setQuery)(query + character)} />}
    {kind === 'characters' && <p className="small muted">Full list includes prepared Chinese characters and characters in app vocabulary, including those without guides. Band filters use containing words, not a separate character syllabus. The built-in writing guides cover every character in the HSK 2021 standard word lists (bands 1–9) and the app course tracks. Word meanings and readings below are context, not character definitions.</p>}
    <p className="small muted" role="status">{catalog ? `${count} ${kind === 'characters' ? count === 1 ? 'character' : 'characters' : count === 1 ? 'item' : 'items'}` : 'Loading the curriculum...'}</p>
    {scope === 'media' && <div className="word-grid">{sourceMatches.slice(0, limit).map(entry => <SourceEntryCard key={entry.id} entry={entry} known={known.has(`source:${entry.id}`)} card={workspace.studyCards.find(card => card.id === cardId(`source:${entry.id}`, DOMAIN))}
      added={entries.get(`source:${entry.id}`)} addedIndex={addedIndex} pinyin={workspace.preferences.pinyin} now={now} run={run} busy={busy} route={`dictionary/vocabulary/media`} />)}</div>}
    {catalog && kind !== 'characters' && scope !== 'media' && <div className="word-grid">{matches.slice(0, limit).map(unit => <div key={unit.ref} className={`select-item${picked.has(unit.ref) ? ' picked' : ''}`}>{unit.kind === 'vocabulary' && <div className="select-row">{pickRow(unit.ref, unit.record.ch, unit.record.ch)}{writeTag(unit.record.ch)}</div>}<UnitCard catalog={catalog} unit={unit} pinyin={workspace.preferences.pinyin} now={now}
      card={workspace.studyCards.find(card => card.id === cardId(unit.ref, DOMAIN))} entry={entries.get(unit.ref)} addedIndex={addedIndex} run={run} busy={busy} route={`dictionary/${kind}/${scope}`} compact /></div>)}</div>}
    {scope !== 'media' && sourceMatches.length > 0 && <><h2 className="small muted">From your media</h2><div className="word-grid">{sourceMatches.slice(0, limit).map(entry => <SourceEntryCard key={entry.id} entry={entry} known={known.has(`source:${entry.id}`)} card={workspace.studyCards.find(card => card.id === cardId(`source:${entry.id}`, DOMAIN))}
      added={entries.get(`source:${entry.id}`)} addedIndex={addedIndex} pinyin={workspace.preferences.pinyin} now={now} run={run} busy={busy} route={`dictionary/vocabulary/${scope}`} />)}</div></>}
    {catalog && kind === 'characters' && <div className="word-grid character-grid">{characterMatches.slice(0, limit).map(entry => <div key={entry.character} className={`select-item${picked.has(entry.character) ? ' picked' : ''}`}>{selecting && <div className="select-row">{pickRow(entry.character, entry.character, entry.character)}</div>}<CharacterCard entry={entry}
      automatic={characterSet?.automatic.has(entry.character) ?? false} manual={characterSet?.manual.has(entry.character) ?? false}
      state={workspace.characterStates.find(state => state.character === entry.character)} known={known} scope={scope === 'collections' || scope === 'media' ? 'all' : scope} pinyin={workspace.preferences.pinyin} run={run} busy={busy} /></div>)}</div>}
    {undo && <p className="history-toast" role="status">{undo.label}{undo.changes.length > 0 && <> <button type="button" className="button secondary" onClick={restore}>Undo</button></>}</p>}
    {count > limit && <div className="button-row"><button className="button secondary" onClick={() => setLimit(limit + PAGE)}>Show more ({count - limit} remaining)</button></div>}
    {catalog && !count && <EmptyState title={scope === 'collections' && !collected.size ? `No ${TERM.plural} items yet` : scope === 'knowledge' && !knownCounts[kind] ? 'Your knowledge set is empty' : 'No matching items'}><p>{scope === 'knowledge' && !knownCounts[kind] ? kind === 'characters' ? 'Add a character from the full list, or add a word to your knowledge set.' : 'Add items here, or start with New in Lessons.' : 'Try another search, band, or section.'}</p><a href="#lessons" className="button secondary">Go to Lessons</a></EmptyState>}
    <p className="page-footnote">{kind === 'characters' ? <>Guided writing records completed practice, not mastery or an FSRS writing schedule. Most guides are source-derived and unreviewed. <a href={characterAttributionUrl} target="_blank" rel="noreferrer">Artwork sources and licenses</a>.</>
      : 'Review timing for each item in your knowledge set follows FSRS spaced repetition for reading. Writing practice is available in Characters and is tracked separately. The inventory follows the November 2025 HSK examination syllabus; it is an AI-assisted editorial draft, not an official sense list.'}</p>
  </>
}
