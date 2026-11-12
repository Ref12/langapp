import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../core/database'
import { savePreferences } from '../core/learning'
import { PenLine, Search } from 'lucide-react'
import { playBrowserSpeech } from '../core/assistant/speech'
import { removeUserPhrase } from '../core/phrases/user'
import { catalogEntries, buildPhraseRows, filterPhraseRows, inPhraseScope, isPhraseScope, lessonRangeKey, lessonRanges, loadPhraseSources, parseLessonRange, mergePhrases, peekPhraseSources, phrasesRouteFor, phraseScopeCounts, PHRASE_SCOPES, type PhraseScope, type PhraseSources } from '../core/phrases/dictionary'
import { resolveDisplaySettings } from '../components/display-settings'
import { loadPhraseIndex, type PhraseIndex } from '../core/phrases/index'
import { PhraseTable, type PhraseTableView } from '../components/phrases/PhraseTable'
import { usePageActions } from '../components/page-actions-context'
import { makeMatcher, ownCharacterData, FALLBACK, type SearchTarget } from '../core/dictionary-search'
import { catalogBandList, catalogCounts, type Unit } from '../core/study/catalog'
import { cardId, type UnitKind } from '../core/study/contracts'
import { buildAddedByIndex } from '../core/study/addedby'
import { DOMAIN } from '../core/study/knowledge'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { UnitCard } from '../components/study/UnitCard'
import { SourceEntryCard } from '../components/study/SourceEntryCard'
import { useCatalog } from '../components/study/useCatalog'
import { guidedChars, writtenCharacters } from '../core/drills/write-queue'
import { setCharactersWriteState, undoWriteChanges, type WriteChange } from '../core/characters/store'
import { characterKnowledge, dictionaryCharacters, inCharacterGroup } from '../core/characters/dictionary'
import { characterAttributionUrl } from '../core/characters/assets'
import { CharacterCard } from '../components/characters/CharacterCard'
import { HandwritingPad } from '../components/characters/HandwritingPad'
import { TERM } from '../core/collections/terms'
import './writing.css'
import type { LookupSource } from '../core/language/dictionary'
// The look-up cards are a chunk of their own: the Chinese app never draws one.
const LookupWordCard = lazy(() => import('../components/dictionary/LookupCards').then(module => ({ default: module.LookupWordCard })))
const LookupGrammarCard = lazy(() => import('../components/dictionary/LookupCards').then(module => ({ default: module.LookupGrammarCard })))
import { bandName, getPack } from '../core/language'
import type { DictGrammar, DictWord } from '../core/language/dictionary-file'

const PAGE = 48

export function Dictionary({ workspace, now, run, busy, section, initialScope, initialQuery, initialWrite }: PageProps & { section?: string; initialScope?: string; initialQuery?: string; initialWrite?: string }) {
  const { catalog, error } = useCatalog()
  const pack = getPack()
  const packPhrases = pack.dictionary.phrases
  const sections = pack.dictionary.sections
  const [dictError, setDictError] = useState('')
  // A pack with its own character list (Japanese: kana, then the lesson kanji) groups it, words it and searches it itself; Chinese keeps its single list.
  const charList = pack.writing.characterList
  const charText = pack.dictionary.characters
  const [group, setGroup] = useState('all')
  // The pack's look-up words (Japanese: the JLPT words outside the lessons), loaded on demand: when All words is chosen or a search is typed.
  const lookup = pack.dictionary.lookup
  const [allWords, setAllWords] = useState(false)
  const [lookupData, setLookupData] = useState<LookupSource>()
  const kind: UnitKind | 'characters' = section === 'characters' && sections.characters ? 'characters' : section === 'grammar' ? 'grammar' : 'vocabulary'
  const explicit = initialScope === 'knowledge' || initialScope === 'all' || initialScope === 'collections' || (initialScope === 'media' && sections.media) ? initialScope : undefined
  const scope: 'all' | 'knowledge' | 'collections' | 'media' = explicit ?? workspace.preferences.dictionaryScope ?? 'all'
  // Words drawn from the learner's media sources (pass 2 of the annotated source).
  const chineseSourceEntries = useLiveQuery(() => db.sourceEntries.orderBy('word').toArray(), []) ?? []
  const sourceEntries = sections.media ? chineseSourceEntries : []
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
  // The search text survives a change of scope (and band): it travels in the route as ?q=. A change of section clears it.
  const withQuery = (parts: string[]) => { const all = [...(query.trim() ? [`q=${encodeURIComponent(query)}`] : []), ...parts]; return all.length ? `?${all.join('&')}` : '' }
  const goPhrases = (next: PhraseScope) => { setLimit(PAGE); window.location.hash = `dictionary/phrases/${next}${withQuery([])}` }
  const go = (section: string, next: 'all' | 'knowledge' | 'collections' | 'media', write: 'all' | 'can' | 'not' = writeFilter) => { window.location.hash = `dictionary/${section}/${next}${withQuery(section === 'characters' && next === 'knowledge' && write !== 'all' ? [`write=${write}`] : [])}` }
  const goSection = (section: string) => { setQuery(''); setBand('all'); setLimit(PAGE); window.location.hash = (section === 'phrases' ? 'dictionary/phrases/all' : `dictionary/${section}/${scope}`) }
  const [band, setBand] = useState('all')
  const [query, setQuery] = useState(initialQuery ?? '')
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => {
    if (!lookup || !catalog || lookupData || !(allWords || query.trim())) return
    let alive = true
    const ids = new Set([...catalog.units.values()].map(unit => unit.record.id))
    lookup.load(id => ids.has(id)).then(value => { if (alive) setLookupData(value) }, reason => { if (alive) setDictError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { alive = false }
  }, [lookup, catalog, lookupData, allWords, query])
  // A link from another page (entry word, grammar label) arrives with its search text.
  useEffect(() => { setQuery(initialQuery ?? '') }, [initialQuery])
  // The Phrases section: its band files are fetched only while it is open; the other sections show a count only once they have been loaded.
  const phrasesView = section === 'phrases' && sections.phrases
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
  // Counts without the band files: the shipped counts from the small index, plus the catalog's examples and the learner's own phrases.
  const [phraseIndex, setPhraseIndex] = useState<PhraseIndex | undefined>()
  useEffect(() => { if (!sections.phrases) return; let alive = true; void loadPhraseIndex().then(value => { if (alive) setPhraseIndex(value) }); return () => { alive = false } }, [sections.phrases])
  // a pack with its own Phrases section has the lesson sentences as its bank (the examples are the same sentences), so only the Chinese count adds them
  const examples = useMemo(() => catalog && phraseIndex && !packPhrases ? catalogEntries(catalog) : [], [catalog, phraseIndex, packPhrases])
  const indexedTotal = catalog && phraseIndex && userPhraseRows ? phraseIndex.total + examples.length + userPhraseRows.length : undefined
  const indexedUse = (ref: string) => catalog && phraseIndex && userPhraseRows ? (phraseIndex.byWord.get(ref) ?? 0) + examples.filter(entry => entry.phrase.words.includes(ref)).length + userPhraseRows.filter(row => row.words.includes(ref)).length : undefined
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
  const characters = useMemo(() => catalog && sections.characters ? dictionaryCharacters(catalog, undefined, workspace.characterStates) : [], [catalog, workspace.characterStates, sections.characters])
  const characterSet = useMemo(() => catalog && sections.characters ? characterKnowledge(catalog, workspace.knowledge, workspace.characterStates) : undefined,
    [catalog, workspace.knowledge, workspace.characterStates, sections.characters])
  const knownCounts = { vocabulary: workspace.knowledge.filter(entry => entry.kind === 'vocabulary').length, grammar: workspace.knowledge.filter(entry => entry.kind === 'grammar').length, characters: characterSet?.all.size ?? 0 }
  const collectedCount = (value: UnitKind) => [...collected].filter(ref => ref.startsWith(`${value}:`)).length
  const zhTab = (value: UnitKind | 'characters') => scope === 'media' ? (value === 'vocabulary' ? sourceEntries.length : 0) : scope === 'collections' ? (value === 'characters' ? 0 : collectedCount(value)) : scope === 'knowledge' ? knownCounts[value] : value === 'characters' ? (charList ? characters.filter(entry => inCharacterGroup(entry, 'all', charList)).length : characters.length) : catalogCounts[value]
  const lookupShown = Boolean(lookup && lookupData && scope === 'all' && allWords)
  const tabCount = (value: UnitKind | 'characters') => zhTab(value) + (lookupShown && value !== 'characters' ? (value === 'vocabulary' ? lookupData!.words.length : lookupData!.grammar.length) : 0)
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
  const unitSearch = useMemo(() => pack.dictionary.searchUnits(query, pack.romaji), [pack, query])
  const bandNumber = (value: string) => Number(value) || 99
  /** Orders by rank, then knowledge-set items first, then HSK band; ties keep catalog order. */
  const byRank = <T,>(items: T[], rankOf: (item: T) => number, inSet: (item: T) => boolean, bandOf: (item: T) => number): T[] =>
    items.map((item, index) => ({ item, index, rank: rankOf(item), set: inSet(item) ? 0 : 1, band: bandOf(item) }))
      .sort((a, b) => a.rank - b.rank || a.set - b.set || a.band - b.band || a.index - b.index).map(entry => entry.item)
  const zhRanks = new Map<Unit, number>()
  const matches = catalog && !phrasesView ? (() => {
    const found: { unit: Extract<Unit, { kind: 'vocabulary' | 'grammar' }>; rank: number }[] = []
    for (const unit of catalog.units.values()) {
      if (unit.kind !== kind || !inScope(unit.ref) || (band !== 'all' && unit.band !== band)) continue
      const rank = unitSearch.rank(unit)
      if (rank !== undefined) found.push({ unit, rank })
    }
    const ranks = new Map(found.map(entry => [entry.unit, entry.rank]))
    for (const [unit, rank] of ranks) zhRanks.set(unit, rank)
    return byRank(found.map(entry => entry.unit), unit => ranks.get(unit)!, unit => known.has(unit.ref), unit => bandNumber(unit.band))
  })() : []
  // Look-up entries: with All words chosen, or for any search; lesson words first at an equal rank. A band filter is a lesson-band filter, so it leaves them out.
  type Shown = { unit: Extract<Unit, { kind: 'vocabulary' | 'grammar' }> } | { word: DictWord } | { item: DictGrammar }
  const lookupWanted = Boolean(lookup && lookupData && scope === 'all' && band === 'all' && (kind === 'vocabulary' || kind === 'grammar') && (allWords || !unitSearch.empty))
  const lookupRows = useMemo(() => {
    if (!lookup || !lookupData || !lookupWanted) return []
    const search = lookupData.search(query, pack.romaji)
    const found: { shown: Shown; rank: number; level: number; index: number }[] = []
    if (kind === 'vocabulary') lookupData.words.forEach((word, index) => { const rank = search.word(word); if (rank !== undefined) found.push({ shown: { word }, rank, level: word.levelNo || 99, index }) })
    else lookupData.grammar.forEach((item, index) => { const rank = search.grammar(item); if (rank !== undefined) found.push({ shown: { item }, rank, level: item.levelNo || 99, index }) })
    return found.sort((a, b) => a.rank - b.rank || a.level - b.level || a.index - b.index)
  }, [lookup, lookupData, lookupWanted, query, kind, pack])
  const listed: Shown[] = useMemo(() => {
    if (!lookupRows.length) return matches.map(unit => ({ unit }))
    const merged: Shown[] = []
    let at = 0
    for (const row of lookupRows) {
      while (at < matches.length && (zhRanks.get(matches[at]) ?? 0) <= row.rank) merged.push({ unit: matches[at++] })
      merged.push(row.shown)
    }
    while (at < matches.length) merged.push({ unit: matches[at++] })
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, lookupRows])
  const written = useMemo(() => writtenCharacters(workspace.characterStates), [workspace.characterStates])
  const inWriteFilter = (character: string) => scope !== 'knowledge' || writeFilter === 'all' || (writeFilter === 'can') === written.has(character)
  const setCharacters = characters.filter(entry => characterSet?.all.has(entry.character))
  const canWriteCount = setCharacters.filter(entry => written.has(entry.character)).length
  // A character's own readings and meanings, from the words that contain it (computed once per character).
  const ownData = useMemo(() => new Map(characters.map(entry => [entry.character, ownCharacterData(entry.character, entry.words.map(word => word.record))] as const)), [characters])
  const charSearch = useMemo(() => charText?.search(query, pack.romaji), [charText, query, pack])
  const characterMatches = kind === 'characters' ? (() => {
    const pool = characters.filter(entry => (scope !== 'knowledge' || characterSet?.all.has(entry.character)) && inWriteFilter(entry.character) && (charList ? inCharacterGroup(entry, group, charList) : band === 'all' || entry.bands.some(value => value === band)))
    const rankOf = (entry: (typeof pool)[number]) => { if (charSearch) return charSearch.rank({ character: entry.character, reading: entry.reading }); const own = ownData.get(entry.character); return matcher.rank({ character: entry.character, readings: own?.readings, ds: own?.ds }) }
    const direct = pool.map(entry => ({ entry, rank: (charSearch ? charSearch.empty : matcher.empty) ? 0 : rankOf(entry) })).filter((item): item is { entry: (typeof pool)[number]; rank: number } => item.rank !== undefined)
    // Only when nothing matches directly: characters whose containing words match, ranked last.
    const wordMatches = (word: (typeof pool)[number]['words'][number]) => (charSearch ? unitSearch.rank(word) : matcher.rank({ text: [word.record.ch], pr: word.record.pr, ds: word.record.ds })) !== undefined
    const found = direct.length || (charSearch ? charSearch.empty : matcher.empty) ? direct : pool.flatMap(entry => entry.words.some(wordMatches) ? [{ entry, rank: FALLBACK }] : [])
    const ranks = new Map(found.map(item => [item.entry, item.rank]))
    // a character list in the pack's own order (the kana table, the lessons) keeps it: knowledge-set characters do not float up
    return byRank(found.map(item => item.entry), entry => ranks.get(entry)!, entry => !charList && (characterSet?.all.has(entry.character) ?? false), entry => charList ? 0 : Math.min(99, ...entry.bands.map(bandNumber)))
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
  const formOf = useCallback((ref: string) => { const unit = catalog?.units.get(ref); return unit?.kind === 'vocabulary' ? unit.record.ch : undefined }, [catalog])
  const romajiOverrides = pack.romaji
  const lessons = packPhrases ? parseLessonRange(band) : undefined
  const phraseSearch = useMemo(() => packPhrases?.search(query, romajiOverrides), [packPhrases, query, romajiOverrides])
  const lessonChoices = useMemo(() => packPhrases ? lessonRanges(phraseRows ?? []) : [], [packPhrases, phraseRows])
  const filteredPhrases = useMemo(() => filterPhraseRows(phraseRows ?? [], { band: packPhrases ? 'all' : band, query, formOf, search: phraseSearch, lessons }), [phraseRows, band, query, formOf, phraseSearch, packPhrases, lessons])
  const readingStyle = resolveDisplaySettings(workspace.preferences).readingStyle
  const phraseView: PhraseTableView | undefined = packPhrases ? { columns: packPhrases.columns, lang: packPhrases.lang, reading: packPhrases.reading({ text: '', reading: '' }, readingStyle) === undefined ? undefined : row => packPhrases.reading({ text: row.phrase.zh, reading: row.pinyin }, readingStyle, romajiOverrides) ?? '' } : undefined
  const phraseCounts = phraseScopeCounts(filteredPhrases)
  const phraseMatches = filteredPhrases.filter(row => inPhraseScope(row, phraseScope))
  const count = phrasesView ? phraseMatches.length : scope === 'media' ? sourceMatches.length : kind === 'characters' ? characterMatches.length : listed.length
  const selectable = sections.characters && !phrasesView && scope !== 'collections' && (kind === 'characters' || (kind === 'vocabulary' && !charList))
  const togglePick = (key: string, text: string) => setPicked(previous => { const next = new Map(previous); if (next.has(key)) next.delete(key); else next.set(key, text); return next })
  const pickRow = (key: string, text: string, label: string) => selecting
    ? <label className="select-pick"><input type="checkbox" checked={picked.has(key)} onChange={() => togglePick(key, text)} aria-label={`Select ${label}`} /><span className="small">{picked.has(key) ? 'Selected' : 'Select'}</span></label> : null
  const wordCharacters = (zh: string) => guidedChars(zh)
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
  const renderZh = (unit: Extract<Unit, { kind: 'vocabulary' | 'grammar' }>) => <div key={unit.ref} className={`select-item${picked.has(unit.ref) ? ' picked' : ''}`}>{unit.kind === 'vocabulary' && sections.characters && !charList && <div className="select-row">{pickRow(unit.ref, unit.record.ch, unit.record.ch)}{writeTag(unit.record.ch)}</div>}<UnitCard catalog={catalog!} unit={unit} pinyin={workspace.preferences.pinyin} now={now}
      card={workspace.studyCards.find(card => card.id === cardId(unit.ref, DOMAIN))} entry={entries.get(unit.ref)} addedIndex={addedIndex} run={run} busy={busy} route={`dictionary/${kind}/${scope}`} compact forms phrases={unit.kind === 'vocabulary' && sections.phrases ? { href: `#${phrasesRouteFor(unit.record.ch)}`, count: phraseRows ? phraseUse.get(unit.ref) ?? 0 : indexedUse(unit.ref) } : undefined} /></div>
  return <>
    <PageHeading eyebrow="THE WHOLE CURRICULUM" title={phrasesView ? 'Phrases, ready or pending.' : kind === 'characters' ? charText?.title ?? 'Characters, one stroke at a time.' : 'Vocabulary and grammar, by band.'}>
      {phrasesView && packPhrases ? packPhrases.intro : phrasesView ? 'Every phrase the app can use: lesson examples, the generated bank and the phrases you added. A phrase is ready when you know all its words (and grammar, for a generated one).' : kind === 'characters' ? charText?.intro ?? 'Your character set includes characters from words in your knowledge set, plus any you add manually. Practice their strokes here; inclusion does not claim writing proficiency.'
        : pack.dictionary.intro}</PageHeading>
    {error && <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>}
    {dictError && <div className="notice error" role="alert"><p>The look-up words could not be loaded. {dictError}</p></div>}
    <div className="library-toolbar">
      <div className="segmented" role="group" aria-label="Dictionary section">
        <button aria-pressed={!phrasesView && kind === 'vocabulary'} onClick={() => { goSection('vocabulary') }}>Vocabulary ({tabCount('vocabulary').toLocaleString('en-US')})</button>
        <button aria-pressed={!phrasesView && kind === 'grammar'} onClick={() => { goSection('grammar') }}>Grammar ({tabCount('grammar').toLocaleString('en-US')})</button>
        {sections.characters && <button aria-pressed={!phrasesView && kind === 'characters'} onClick={() => { goSection('characters') }}>Characters{catalog ? ` (${tabCount('characters').toLocaleString('en-US')})` : ''}</button>}
        {sections.phrases && <button aria-pressed={phrasesView} onClick={() => { goSection('phrases') }}>Phrases{phraseRows ? ` (${phraseRows.length.toLocaleString('en-US')})` : indexedTotal !== undefined && !packPhrases ? ` (${indexedTotal.toLocaleString('en-US')})` : ''}</button>}
      </div>
      {phrasesView ? <div className="segmented" role="group" aria-label="Phrase scope">
        {PHRASE_SCOPES.map(value => <button key={value} aria-pressed={phraseScope === value} onClick={() => goPhrases(value)}>{{ all: 'All', ready: 'Ready', pending: 'Pending', mine: 'Added by me' }[value]}{phraseRows ? ` (${phraseCounts[value].toLocaleString('en-US')})` : ''}</button>)}
      </div> : <div className="segmented" role="group" aria-label="Dictionary scope">
        <button aria-pressed={scope === 'all'} onClick={() => { setLimit(PAGE); go(kind, 'all') }}>Full list</button>
        <button aria-pressed={scope === 'knowledge'} onClick={() => { setLimit(PAGE); go(kind, 'knowledge') }}>My knowledge set ({knownCounts[kind]})</button>
        {sections.media && <button aria-pressed={scope === 'media'} onClick={() => { setLimit(PAGE); go('vocabulary', 'media') }}>From your media ({sourceEntries.length})</button>}
        {kind !== 'characters' && <button aria-pressed={scope === 'collections'} onClick={() => { setLimit(PAGE); go(kind, 'collections') }}>In {TERM.plural} ({collectedCount(kind)})</button>}
      </div>}
      {lookup && !phrasesView && scope === 'all' && (kind === 'vocabulary' || kind === 'grammar') && <div className="segmented" role="group" aria-label="Words shown">
        <button aria-pressed={!allWords} onClick={() => { setLimit(PAGE); setAllWords(false) }}>Lesson words ({catalogCounts[kind].toLocaleString('en-US')})</button>
        <button aria-pressed={allWords} onClick={() => { setLimit(PAGE); setAllWords(true) }}>All words{lookupData ? ` (${(catalogCounts[kind] + (kind === 'vocabulary' ? lookupData.words.length : lookupData.grammar.length)).toLocaleString('en-US')})` : ''}</button>
      </div>}
      <div className="search-field"><Search size={18} /><input type="search" value={query} onChange={event => select(setQuery)(event.target.value)} placeholder={phrasesView ? packPhrases?.placeholder ?? 'Chinese, pinyin, or English' : kind === 'characters' ? charText?.placeholder ?? 'Character, codepoint, or containing word' : pack.dictionary.placeholder[kind === 'vocabulary' ? 'vocabulary' : 'grammar']} aria-label="Search dictionary" />
        {sections.draw && <button type="button" className="search-draw" aria-expanded={drawing} disabled={!catalog} onClick={() => setDrawing(value => !value)}><PenLine size={16} />Draw</button>}</div>
      {phrasesView && packPhrases ? <label className="filter-label">Lessons <select value={band} onChange={event => select(setBand)(event.target.value)}><option value="all">All lessons</option>{lessonChoices.map(range => <option key={lessonRangeKey(range)} value={lessonRangeKey(range)}>{range[0]}–{range[1]}</option>)}</select></label>
      : kind === 'characters' && charList ? <label className="filter-label">Group <select value={group} onChange={event => select(setGroup)(event.target.value)}><option value="all">All ({characters.filter(entry => inCharacterGroup(entry, 'all', charList)).length.toLocaleString('en-US')})</option>{charList.groups().map(item => <option key={item.id} value={item.id}>{item.title} ({characters.filter(entry => inCharacterGroup(entry, item.id, charList)).length.toLocaleString('en-US')})</option>)}</select></label>
      : <label className="filter-label">Band <select value={band} onChange={event => select(setBand)(event.target.value)}><option value="all">All bands</option>{catalogBandList().map(value => <option key={value} value={value}>{bandName(pack, value)}{catalog && !phrasesView ? ` (${(bandCounts.get(value) ?? 0).toLocaleString('en-US')})` : ''}</option>)}</select></label>}
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
    {drawing && sections.draw && <HandwritingPad allowed={drawable} preferred={characterSet?.all} onClose={() => setDrawing(false)} onPick={character => select(setQuery)(query + character)} />}
    {kind === 'characters' && charText && <p className="small muted">{charText.note}</p>}
    {kind === 'characters' && !charText && <p className="small muted">Full list includes prepared Chinese characters and characters in app vocabulary, including those without guides. Band filters use containing words, not a separate character syllabus. The built-in writing guides cover every character in the HSK 2021 standard word lists (bands 1–9) and the app course tracks. Word meanings and readings below are context, not character definitions.</p>}
    <p className="small muted" role="status">{catalog ? phrasesView && !phraseRows ? 'Loading phrases...' : phrasesView ? `${count} ${count === 1 ? 'phrase' : 'phrases'}` : `${count} ${kind === 'characters' ? count === 1 ? 'character' : 'characters' : count === 1 ? 'item' : 'items'}` : 'Loading the curriculum...'}</p>
    {phrasesView && <>
      {phraseMatches.length > 0 && <PhraseTable rows={phraseMatches.slice(0, limit)} route={`dictionary/phrases/${phraseScope}`} pinyin={workspace.preferences.pinyin} busy={busy} view={phraseView} onPlay={zh => playBrowserSpeech('dictionary-phrases', zh, pack.speechLocale)} onRemove={zh => void run(async () => { await removeUserPhrase(zh) })} />}</>}
    {!phrasesView && scope === 'media' && <div className="word-grid">{sourceMatches.slice(0, limit).map(entry => <SourceEntryCard key={entry.id} entry={entry} known={known.has(`source:${entry.id}`)} card={workspace.studyCards.find(card => card.id === cardId(`source:${entry.id}`, DOMAIN))}
      added={entries.get(`source:${entry.id}`)} addedIndex={addedIndex} pinyin={workspace.preferences.pinyin} now={now} run={run} busy={busy} route={`dictionary/vocabulary/media`} />)}</div>}
    {catalog && !phrasesView && kind !== 'characters' && scope !== 'media' && <div className="word-grid"><Suspense fallback={null}>{listed.slice(0, limit).map(entry => 'unit' in entry ? renderZh(entry.unit) : 'word' in entry ? <LookupWordCard key={entry.word.id} word={entry.word} reading={workspace.preferences.pinyin} levelName={lookup?.levelName} /> : <LookupGrammarCard key={entry.item.id} item={entry.item} levelName={lookup?.levelName} />)}</Suspense></div>}
    {!phrasesView && scope !== 'media' && sourceMatches.length > 0 && <><h2 className="small muted">From your media</h2><div className="word-grid">{sourceMatches.slice(0, limit).map(entry => <SourceEntryCard key={entry.id} entry={entry} known={known.has(`source:${entry.id}`)} card={workspace.studyCards.find(card => card.id === cardId(`source:${entry.id}`, DOMAIN))}
      added={entries.get(`source:${entry.id}`)} addedIndex={addedIndex} pinyin={workspace.preferences.pinyin} now={now} run={run} busy={busy} route={`dictionary/vocabulary/${scope}`} />)}</div></>}
    {catalog && !phrasesView && kind === 'characters' && <div className="word-grid character-grid">{characterMatches.slice(0, limit).map(entry => <div key={entry.character} className={`select-item${picked.has(entry.character) ? ' picked' : ''}`}>{selecting && <div className="select-row">{pickRow(entry.character, entry.character, entry.character)}</div>}<CharacterCard entry={entry}
      automatic={characterSet?.automatic.has(entry.character) ?? false} manual={characterSet?.manual.has(entry.character) ?? false}
      state={workspace.characterStates.find(state => state.character === entry.character)} known={known} scope={scope === 'collections' || scope === 'media' ? 'all' : scope} pinyin={workspace.preferences.pinyin} run={run} busy={busy} /></div>)}</div>}
    {undo && <p className="history-toast" role="status">{undo.label}{undo.changes.length > 0 && <> <button type="button" className="button secondary" onClick={restore}>Undo</button></>}</p>}
    {count > limit && <div className="button-row"><button className="button secondary" onClick={() => setLimit(limit + PAGE)}>Show more ({count - limit} remaining)</button></div>}
    {catalog && !count && !(phrasesView && !phraseRows) && <EmptyState title={phrasesView ? 'No matching phrases' : scope === 'collections' && !collected.size ? `No ${TERM.plural} items yet` : scope === 'knowledge' && !knownCounts[kind] ? 'Your knowledge set is empty' : 'No matching items'}><p>{phrasesView ? 'Try another search, band, or scope.' : scope === 'knowledge' && !knownCounts[kind] ? kind === 'characters' ? 'Add a character from the full list, or add a word to your knowledge set.' : 'Add items here, or start with New in Lessons.' : 'Try another search, band, or section.'}</p><a href="#lessons" className="button secondary">Go to Lessons</a></EmptyState>}
    <p className="page-footnote">{phrasesView ? 'Practice-set sentences are not listed here. Heard counts come from Hands-free.' : kind === 'characters' ? <>Guided writing records completed practice, not mastery or an FSRS writing schedule. Most guides are source-derived and unreviewed. <a href={characterAttributionUrl} target="_blank" rel="noreferrer">Artwork sources and licenses</a>.</>
      : pack.dictionary.footnote}</p>
  </>
}
