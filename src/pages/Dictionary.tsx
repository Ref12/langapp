import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../core/database'
import { savePreferences } from '../core/learning'
import { PenLine, Search } from 'lucide-react'
import { playBrowserSpeech } from '../core/assistant/speech'
import { removeUserPhrase } from '../core/phrases/user'
import { buildPhraseRows, filterPhraseRows, inPhraseScope, isPhraseScope, loadPhraseSources, mergePhrases, peekPhraseSources, phrasesRouteFor, phraseScopeCounts, PHRASE_SCOPES, type PhraseScope, type PhraseSources } from '../core/phrases/dictionary'
import { PhraseTable } from '../components/phrases/PhraseTable'
import { usePageActions } from '../components/page-actions-context'
import { makeMatcher, ownCharacterData, FALLBACK, type SearchTarget } from '../core/dictionary-search'
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

export function Dictionary({ workspace, now, run, busy, section, initialScope, initialQuery, initialWrite, initialWord }: PageProps & { section?: string; initialScope?: string; initialQuery?: string; initialWrite?: string; initialWord?: string }) {
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
  const goPhrases = (next: PhraseScope) => { setLimit(PAGE); window.location.hash = `dictionary/phrases/${next}${initialWord ? `?word=${encodeURIComponent(initialWord)}` : ''}` }
  const go = (section: string, next: 'all' | 'knowledge' | 'collections' | 'media', write: 'all' | 'can' | 'not' = writeFilter) => { window.location.hash = `dictionary/${section}/${next}${section === 'characters' && next === 'knowledge' && write !== 'all' ? `?write=${write}` : ''}` }
  const [band, setBand] = useState('all')
  const [query, setQuery] = useState(initialQuery ?? '')
  const [limit, setLimit] = useState(PAGE)
  // A link from another page (entry word, grammar label) arrives with its search text.
  useEffect(() => { setQuery(initialQuery ?? '') }, [initialQuery])
  // The Phrases section: its band files are fetched only while it is open; the other sections show a count only once they have been loaded.
  const phrasesView = section === 'phrases'
  const phraseScope: PhraseScope = isPhraseScope(initialScope) ? initialScope : 'all'
  const userPhraseRows = useLiveQuery(() => db.userPhrases.toArray(), [])
  const heardRows = useLiveQuery(() => db.phraseHeard.toArray(), [])
  const [fetched, setFetched] = useState<PhraseSources | undefined>()
  useEffect(() => {
    if (!phrasesView || !catalog) return
    let alive = true
    void loadPhraseSources(catalog).then(value => { if (alive) setFetched(value) }).catch(() => undefined)
    return () => { alive = false }
  }, [phrasesView, catalog])
  const phraseSources = catalog ? fetched && peekPhraseSources(catalog) === fetched ? fetched : peekPhraseSources(catalog) : undefined
  const phraseRows = useMemo(() => catalog && phraseSources && userPhraseRows
    ? buildPhraseRows(catalog, mergePhrases(catalog, phraseSources, userPhraseRows), new Set(workspace.knowledge.map(entry => entry.ref)), new Map((heardRows ?? []).map(row => [row.zh, row])))
    : undefined, [catalog, phraseSources, userPhraseRows, heardRows, workspace.knowledge])
  const phraseUse = useMemo(() => { const counts = new Map<string, number>(); for (const row of phraseRows ?? []) for (const ref of new Set(row.phrase.words)) counts.set(ref, (counts.get(ref) ?? 0) + 1); return counts }, [phraseRows])
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
  if (catalog && !phrasesView) {
    const bump = (value: string) => bandCounts.set(value, (bandCounts.get(value) ?? 0) + 1)
    if (kind === 'characters') for (const entry of characters) { if (scope !== 'knowledge' || characterSet?.all.has(entry.character)) for (const value of new Set(entry.bands)) bump(value) }
    else for (const unit of catalog.units.values()) if (unit.kind === kind && inScope(unit.ref)) bump(unit.band)
  }
  // Handwriting candidates stay inside the catalog; the Characters section also honours its scope.
  const drawable = useMemo(() => new Set(characters.filter(entry => scope !== 'knowledge' || characterSet?.all.has(entry.character)).map(entry => entry.character)),
    [characters, characterSet, scope])
  const matcher = makeMatcher(query)
  const bandNumber = (value: string) => Number(value) || 99
  /** Orders by rank, then knowledge-set items first, then HSK band; ties keep catalog order. */
  const byRank = <T,>(items: T[], rankOf: (item: T) => number, inSet: (item: T) => boolean, bandOf: (item: T) => number): T[] =>
    items.map((item, index) => ({ item, index, rank: rankOf(item), set: inSet(item) ? 0 : 1, band: bandOf(item) }))
      .sort((a, b) => a.rank - b.rank || a.set - b.set || a.band - b.band || a.index - b.index).map(entry => entry.item)
  const matches = catalog && !phrasesView ? (() => {
    const found: { unit: Extract<Unit, { kind: 'vocabulary' | 'grammar' }>; rank: number }[] = []
    for (const unit of catalog.units.values()) {
      if (unit.kind !== kind || !inScope(unit.ref) || (band !== 'all' && unit.band !== band)) continue
      const rank = matcher.empty ? 0 : matcher.rank({ text: [unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt], pr: unit.record.pr, ds: unit.record.ds })
      if (rank !== undefined) found.push({ unit, rank })
    }
    const ranks = new Map(found.map(entry => [entry.unit, entry.rank]))
    return byRank(found.map(entry => entry.unit), unit => ranks.get(unit)!, unit => known.has(unit.ref), unit => bandNumber(unit.band))
  })() : []
  const written = useMemo(() => writtenCharacters(workspace.characterStates), [workspace.characterStates])
  const inWriteFilter = (character: string) => scope !== 'knowledge' || writeFilter === 'all' || (writeFilter === 'can') === written.has(character)
  const setCharacters = characters.filter(entry => characterSet?.all.has(entry.character))
  const canWriteCount = setCharacters.filter(entry => written.has(entry.character)).length
  // A character's own readings and meanings, from the words that contain it (computed once per character).
  const ownData = useMemo(() => new Map(characters.map(entry => [entry.character, ownCharacterData(entry.character, entry.words.map(word => word.record))] as const)), [characters])
  const characterMatches = kind === 'characters' ? (() => {
    const pool = characters.filter(entry => (scope !== 'knowledge' || characterSet?.all.has(entry.character)) && inWriteFilter(entry.character) && (band === 'all' || entry.bands.some(value => value === band)))
    const rankOf = (entry: (typeof pool)[number]) => { const own = ownData.get(entry.character); return matcher.rank({ character: entry.character, readings: own?.readings, ds: own?.ds }) }
    const direct = pool.map(entry => ({ entry, rank: matcher.empty ? 0 : rankOf(entry) })).filter((item): item is { entry: (typeof pool)[number]; rank: number } => item.rank !== undefined)
    // Only when nothing matches directly: characters whose containing words match, ranked last.
    const found = direct.length || matcher.empty ? direct : pool.flatMap(entry => entry.words.some(word => matcher.rank({ text: [word.record.ch], pr: word.record.pr, ds: word.record.ds }) !== undefined) ? [{ entry, rank: FALLBACK }] : [])
    const ranks = new Map(found.map(item => [item.entry, item.rank]))
    return byRank(found.map(item => item.entry), entry => ranks.get(entry)!, entry => characterSet?.all.has(entry.character) ?? false, entry => Math.min(99, ...entry.bands.map(bandNumber)))
  })() : []
  const sourceMatches = phrasesView ? [] : (() => {
    const found = sourceEntries.flatMap(entry => {
      const target: SearchTarget = { text: [entry.word], pr: entry.pinyin, ds: entry.meanings.join('; ') }
      const rank = matcher.empty ? 0 : matcher.rank(target)
      return rank === undefined ? [] : [{ entry, rank }]
    })
    const eligible = found.filter(({ entry }) => scope === 'media' || (kind === 'vocabulary' && !matcher.empty && (scope === 'all' || (scope === 'knowledge' && known.has(`source:${entry.id}`)) || (scope === 'collections' && collected.has(`source:${entry.id}`)))))
    const ranks = new Map(eligible.map(item => [item.entry, item.rank]))
    return byRank(eligible.map(item => item.entry), entry => ranks.get(entry)!, entry => known.has(`source:${entry.id}`), () => 0)
  })()
  const filteredPhrases = useMemo(() => filterPhraseRows(phraseRows ?? [], { band, query, word: initialWord }), [phraseRows, band, query, initialWord])
  const phraseCounts = phraseScopeCounts(filteredPhrases)
  const phraseMatches = filteredPhrases.filter(row => inPhraseScope(row, phraseScope))
  const phraseWord = initialWord ? (catalog?.units.get(initialWord)?.kind === 'vocabulary' ? (catalog.units.get(initialWord) as { record: { ch: string } }).record.ch : initialWord) : undefined
  const count = phrasesView ? phraseMatches.length : scope === 'media' ? sourceMatches.length : (kind === 'characters' ? characterMatches.length : matches.length)
  const selectable = !phrasesView && scope !== 'collections' && (kind === 'characters' || kind === 'vocabulary')
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
    const select = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setLimit(PAGE) }
  usePageActions(selectable ? [{ id: 'select', label: 'Select items', checked: selecting, onSelect: () => { setSelecting(!selecting); setPicked(new Map()) } }] : [])
  return <>
    <PageHeading eyebrow="THE WHOLE CURRICULUM" title={phrasesView ? 'Phrases, ready or pending.' : kind === 'characters' ? 'Characters, one stroke at a time.' : 'Vocabulary and grammar, by band.'}>
      {phrasesView ? 'Every phrase the app can use: lesson examples, the generated bank and the phrases you added. A phrase is ready when you know all its words (and grammar, for a generated one).' : kind === 'characters' ? 'Your character set includes characters from words in your knowledge set, plus any you add manually. Practice their strokes here; inclusion does not claim writing proficiency.'
        : 'Every HSK 1-6 sense and construction in the curriculum, separate from your knowledge set. Adding an item makes it eligible for review; it does not claim you know it.'}</PageHeading>
    {error && <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>}
    <div className="library-toolbar">
      <div className="segmented" role="group" aria-label="Dictionary section">
        <button aria-pressed={!phrasesView && kind === 'vocabulary'} onClick={() => { go('vocabulary', scope) }}>Vocabulary ({tabCount('vocabulary').toLocaleString('en-US')})</button>
        <button aria-pressed={!phrasesView && kind === 'grammar'} onClick={() => { go('grammar', scope) }}>Grammar ({tabCount('grammar').toLocaleString('en-US')})</button>
        <button aria-pressed={!phrasesView && kind === 'characters'} onClick={() => { go('characters', scope) }}>Characters{catalog ? ` (${tabCount('characters').toLocaleString('en-US')})` : ''}</button>
        <button aria-pressed={phrasesView} onClick={() => { setLimit(PAGE); window.location.hash = 'dictionary/phrases/all' }}>Phrases{phraseRows ? ` (${phraseRows.length.toLocaleString('en-US')})` : ''}</button>
      </div>
      {phrasesView ? <div className="segmented" role="group" aria-label="Phrase scope">
        {PHRASE_SCOPES.map(value => <button key={value} aria-pressed={phraseScope === value} onClick={() => goPhrases(value)}>{{ all: 'All', ready: 'Ready', pending: 'Pending', mine: 'Added by me' }[value]}{phraseRows ? ` (${phraseCounts[value].toLocaleString('en-US')})` : ''}</button>)}
      </div> : <div className="segmented" role="group" aria-label="Dictionary scope">
        <button aria-pressed={scope === 'all'} onClick={() => { setLimit(PAGE); go(kind, 'all') }}>Full list</button>
        <button aria-pressed={scope === 'knowledge'} onClick={() => { setLimit(PAGE); go(kind, 'knowledge') }}>My knowledge set ({knownCounts[kind]})</button>
        <button aria-pressed={scope === 'media'} onClick={() => { setLimit(PAGE); go('vocabulary', 'media') }}>From your media ({sourceEntries.length})</button>
        {kind !== 'characters' && <button aria-pressed={scope === 'collections'} onClick={() => { setLimit(PAGE); go(kind, 'collections') }}>In {TERM.plural} ({collectedCount(kind)})</button>}
      </div>}
      <div className="search-field"><Search size={18} /><input type="search" value={query} onChange={event => select(setQuery)(event.target.value)} placeholder={phrasesView ? 'Chinese, pinyin, or English' : kind === 'characters' ? 'Character, codepoint, or containing word' : kind === 'vocabulary' ? 'Character, pinyin, or meaning' : 'Pattern, pinyin, or meaning'} aria-label="Search dictionary" />
        <button type="button" className="search-draw" aria-expanded={drawing} disabled={!catalog} onClick={() => setDrawing(value => !value)}><PenLine size={16} />Draw</button></div>
      <label className="filter-label">Band <select value={band} onChange={event => select(setBand)(event.target.value)}><option value="all">All bands</option>{catalogBands.map(value => <option key={value} value={value}>HSK {value}{catalog && !phrasesView ? ` (${(bandCounts.get(value) ?? 0).toLocaleString('en-US')})` : ''}</option>)}</select></label>
    </div>
    {selectable && selecting && <div className="select-bar" role="toolbar" aria-label="Select">
      <button type="button" className="button secondary" onClick={() => { setSelecting(false); setPicked(new Map()) }}>Done</button>
      {selecting && !picked.size && <button type="button" className="button secondary" onClick={() => setPicked(new Map(pageEntries))}>Select all on this page</button>}
      {selecting && picked.size > 0 && <>
        <span className="select-count" role="status">{picked.size} selected</span>
        <button type="button" className="button primary" disabled={busy} onClick={() => bulk('can')}>{kind === 'characters' ? 'Mark can write' : 'Mark characters can write'}</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => bulk('cannot')}>{kind === 'characters' ? 'Mark not yet' : 'Mark characters not yet'}</button>
        <button type="button" className="button secondary" onClick={() => setPicked(new Map())}>Clear</button></>}
    </div>}
    {kind === 'characters' && scope === 'knowledge' && <div className="segmented" role="group" aria-label="Writing filter">
      <button aria-pressed={writeFilter === 'all'} onClick={() => { setLimit(PAGE); void savePreferences({ characterWriteFilter: 'all' }).catch(() => undefined); go('characters', 'knowledge', 'all') }}>All {setCharacters.length}</button>
      <button aria-pressed={writeFilter === 'can'} onClick={() => { setLimit(PAGE); go('characters', 'knowledge', 'can') }}>Can write {canWriteCount}</button>
      <button aria-pressed={writeFilter === 'not'} onClick={() => { setLimit(PAGE); go('characters', 'knowledge', 'not') }}>Not yet {setCharacters.length - canWriteCount}</button>
    </div>}
    {drawing && <HandwritingPad allowed={drawable} onClose={() => setDrawing(false)} onPick={character => select(setQuery)(query + character)} />}
    {kind === 'characters' && <p className="small muted">Full list includes prepared Chinese characters and characters in app vocabulary, including those without guides. Band filters use containing words, not a separate character syllabus. The built-in writing guides cover every character in the HSK 2021 standard word lists (bands 1–9) and the app course tracks. Word meanings and readings below are context, not character definitions.</p>}
    <p className="small muted" role="status">{catalog ? phrasesView && !phraseRows ? 'Loading phrases...' : phrasesView ? `${count} ${count === 1 ? 'phrase' : 'phrases'}` : `${count} ${kind === 'characters' ? count === 1 ? 'character' : 'characters' : count === 1 ? 'item' : 'items'}` : 'Loading the curriculum...'}</p>
    {phrasesView && <>{phraseWord && <p className="small phrase-filter" role="status">Phrases with <strong lang="zh-Hans">{phraseWord}</strong> <a href={`#dictionary/phrases/${phraseScope}`}>Show all phrases</a></p>}
      {phraseMatches.length > 0 && <PhraseTable rows={phraseMatches.slice(0, limit)} pinyin={workspace.preferences.pinyin} busy={busy} onPlay={zh => playBrowserSpeech('dictionary-phrases', zh, 'zh-Hans')} onRemove={zh => void run(async () => { await removeUserPhrase(zh) })} />}</>}
    {!phrasesView && scope === 'media' && <div className="word-grid">{sourceMatches.slice(0, limit).map(entry => <SourceEntryCard key={entry.id} entry={entry} known={known.has(`source:${entry.id}`)} card={workspace.studyCards.find(card => card.id === cardId(`source:${entry.id}`, DOMAIN))}
      added={entries.get(`source:${entry.id}`)} addedIndex={addedIndex} pinyin={workspace.preferences.pinyin} now={now} run={run} busy={busy} route={`dictionary/vocabulary/media`} />)}</div>}
    {catalog && !phrasesView && kind !== 'characters' && scope !== 'media' && <div className="word-grid">{matches.slice(0, limit).map(unit => <div key={unit.ref} className={`select-item${picked.has(unit.ref) ? ' picked' : ''}`}>{unit.kind === 'vocabulary' && <div className="select-row">{pickRow(unit.ref, unit.record.ch, unit.record.ch)}{writeTag(unit.record.ch)}</div>}<UnitCard catalog={catalog} unit={unit} pinyin={workspace.preferences.pinyin} now={now}
      card={workspace.studyCards.find(card => card.id === cardId(unit.ref, DOMAIN))} entry={entries.get(unit.ref)} addedIndex={addedIndex} run={run} busy={busy} route={`dictionary/${kind}/${scope}`} compact phrases={unit.kind === 'vocabulary' ? { href: `#${phrasesRouteFor(unit.ref)}`, count: phraseRows ? phraseUse.get(unit.ref) ?? 0 : undefined } : undefined} /></div>)}</div>}
    {!phrasesView && scope !== 'media' && sourceMatches.length > 0 && <><h2 className="small muted">From your media</h2><div className="word-grid">{sourceMatches.slice(0, limit).map(entry => <SourceEntryCard key={entry.id} entry={entry} known={known.has(`source:${entry.id}`)} card={workspace.studyCards.find(card => card.id === cardId(`source:${entry.id}`, DOMAIN))}
      added={entries.get(`source:${entry.id}`)} addedIndex={addedIndex} pinyin={workspace.preferences.pinyin} now={now} run={run} busy={busy} route={`dictionary/vocabulary/${scope}`} />)}</div></>}
    {catalog && !phrasesView && kind === 'characters' && <div className="word-grid character-grid">{characterMatches.slice(0, limit).map(entry => <div key={entry.character} className={`select-item${picked.has(entry.character) ? ' picked' : ''}`}>{selecting && <div className="select-row">{pickRow(entry.character, entry.character, entry.character)}</div>}<CharacterCard entry={entry}
      automatic={characterSet?.automatic.has(entry.character) ?? false} manual={characterSet?.manual.has(entry.character) ?? false}
      state={workspace.characterStates.find(state => state.character === entry.character)} known={known} scope={scope === 'collections' || scope === 'media' ? 'all' : scope} pinyin={workspace.preferences.pinyin} run={run} busy={busy} /></div>)}</div>}
    {undo && <p className="history-toast" role="status">{undo.label}{undo.changes.length > 0 && <> <button type="button" className="button secondary" onClick={restore}>Undo</button></>}</p>}
    {count > limit && <div className="button-row"><button className="button secondary" onClick={() => setLimit(limit + PAGE)}>Show more ({count - limit} remaining)</button></div>}
    {catalog && !count && !(phrasesView && !phraseRows) && <EmptyState title={phrasesView ? 'No matching phrases' : scope === 'collections' && !collected.size ? `No ${TERM.plural} items yet` : scope === 'knowledge' && !knownCounts[kind] ? 'Your knowledge set is empty' : 'No matching items'}><p>{phrasesView ? 'Try another search, band, or scope.' : scope === 'knowledge' && !knownCounts[kind] ? kind === 'characters' ? 'Add a character from the full list, or add a word to your knowledge set.' : 'Add items here, or start with New in Lessons.' : 'Try another search, band, or section.'}</p><a href="#lessons" className="button secondary">Go to Lessons</a></EmptyState>}
    <p className="page-footnote">{phrasesView ? 'Practice-set sentences are not listed here. Heard counts come from Hands-free.' : kind === 'characters' ? <>Guided writing records completed practice, not mastery or an FSRS writing schedule. Most guides are source-derived and unreviewed. <a href={characterAttributionUrl} target="_blank" rel="noreferrer">Artwork sources and licenses</a>.</>
      : 'Review timing for each item in your knowledge set follows FSRS spaced repetition for reading. Writing practice is available in Characters and is tracked separately. The inventory follows the November 2025 HSK examination syllabus; it is an AI-assisted editorial draft, not an official sense list.'}</p>
  </>
}
