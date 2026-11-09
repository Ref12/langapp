import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../core/database'
import { savePreferences } from '../core/learning'
import { PenLine, Search } from 'lucide-react'
import { playBrowserSpeech } from '../core/assistant/speech'
import { removeUserPhrase } from '../core/phrases/user'
import { catalogEntries, buildPhraseRows, filterPhraseRows, inPhraseScope, isPhraseScope, loadPhraseSources, mergePhrases, peekPhraseSources, phrasesRouteFor, phraseScopeCounts, PHRASE_SCOPES, type PhraseScope, type PhraseSources } from '../core/phrases/dictionary'
import { loadPhraseIndex, type PhraseIndex } from '../core/phrases/index'
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
import { characterAttributionUrl, characterAttributionUrlFor } from '../core/characters/assets'
import { CharacterCard } from '../components/characters/CharacterCard'
import { HandwritingPad } from '../components/characters/HandwritingPad'
import { TERM } from '../core/collections/terms'
import './writing.css'
import { fold, isFilterLanguage, languageLabel, loadDictionary, makeOtherMatcher, scriptHint, type DictGrammar, type DictLanguage, type DictWord, type Dictionary as OtherDictionary, type FilterLanguage } from '../core/dictionary/other'
import { loadParallel, type ParallelData, type ParallelPhrase } from '../core/parallel/data'
import { LanguageTag, OtherGrammarCard, OtherWordCard, DictPhrase } from '../components/dictionary/OtherEntries'
import { currentLanguageOf } from '../data/tracks'
import { isParallelRef } from '../core/parallel/refs'
import { loadLanguageIndex } from '../core/characters/otherLanguages'
import { OtherCharacterCard } from '../components/characters/OtherCharacterCard'
import { characterScript, isListed, matchesCharacter, scriptLabel, scriptsOf, type CharacterScript } from '../core/characters/other-list'

const PAGE = 48

export function Dictionary({ workspace, now, run, busy, section, initialScope, initialQuery, initialWrite, initialLanguage }: PageProps & { section?: string; initialScope?: string; initialQuery?: string; initialWrite?: string; initialLanguage?: string }) {
  const { catalog, error } = useCatalog()
  // The language filter travels in the route as ?lang=. All covers Chinese and the Japanese/Korean tracks the learner has started; picking Japanese or Korean always shows that language.
  const lang: FilterLanguage = isFilterLanguage(initialLanguage) ? initialLanguage : 'all'
  const started = workspace.preferences.startedTracks ?? []
  const others: DictLanguage[] = lang === 'all' ? started : lang === 'ja' || lang === 'ko' ? [lang] : []
  const showZh = lang === 'all' || lang === 'zh'
  const multi = !showZh || others.length > 0
  const [dicts, setDicts] = useState<Partial<Record<DictLanguage, OtherDictionary>>>({})
  const [dictError, setDictError] = useState('')
  const othersKey = others.join()
  useEffect(() => {
    let alive = true
    for (const language of others) loadDictionary(language).then(value => { if (alive) setDicts(previous => ({ ...previous, [language]: value })) }, reason => { if (alive) setDictError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [othersKey])
  const kind: UnitKind | 'characters' = section === 'characters' ? 'characters' : section === 'grammar' ? 'grammar' : 'vocabulary'
  // Japanese and Korean characters (kana, kanji, Hangul): the language's own stroke index, never the Chinese one.
  const [otherChars, setOtherChars] = useState<Partial<Record<DictLanguage, [string, number][]>>>({})
  const [script, setScript] = useState<CharacterScript | 'all'>('all')
  useEffect(() => { setScript('all') }, [lang])
  useEffect(() => {
    if (kind !== 'characters') return
    let alive = true
    for (const language of others) loadLanguageIndex(language).then(index => { if (alive) setOtherChars(previous => ({ ...previous, [language]: [...index].filter(([character]) => isListed(character)) })) }, reason => { if (alive) setDictError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [othersKey, kind === 'characters'])
  const [lessonData, setLessonData] = useState<Partial<Record<DictLanguage, ParallelData>>>({})
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
  // The search text survives a change of scope (and band): it travels in the route as ?q=. A change of section clears it.
  const withQuery = (parts: string[], language: FilterLanguage = lang) => { const all = [...(query.trim() ? [`q=${encodeURIComponent(query)}`] : []), ...(language !== 'all' ? [`lang=${language}`] : []), ...parts]; return all.length ? `?${all.join('&')}` : '' }
  const goPhrases = (next: PhraseScope) => { setLimit(PAGE); window.location.hash = `dictionary/phrases/${next}${withQuery([])}` }
  const go = (section: string, next: 'all' | 'knowledge' | 'collections' | 'media', write: 'all' | 'can' | 'not' = writeFilter) => { window.location.hash = `dictionary/${section}/${next}${withQuery(section === 'characters' && next === 'knowledge' && write !== 'all' ? [`write=${write}`] : [])}` }
  const goSection = (section: string) => { setQuery(''); setLimit(PAGE); window.location.hash = (section === 'phrases' ? 'dictionary/phrases/all' : `dictionary/${section}/${scope}`) + (lang !== 'all' ? `?lang=${lang}` : '') }
  const goLanguage = (next: FilterLanguage) => { setLimit(PAGE); window.location.hash = `${phrasesView ? `dictionary/phrases/${phraseScope}` : `dictionary/${kind}/${scope}`}${withQuery(!phrasesView && kind === 'characters' && scope === 'knowledge' && writeFilter !== 'all' ? [`write=${writeFilter}`] : [], next)}` }
  const [band, setBand] = useState('all')
  useEffect(() => { setBand('all') }, [lang])
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
    if (!phrasesView || !catalog || !showZh) return
    let alive = true
    void loadPhraseSources(catalog).then(value => { if (alive) setFetched(value) }).catch(() => undefined)
    return () => { alive = false }
  }, [phrasesView, catalog, showZh])
  const phraseSources = catalog ? fetched && peekPhraseSources(catalog) === fetched ? fetched : peekPhraseSources(catalog) : undefined
  const phraseRows = useMemo(() => catalog && phraseSources && userPhraseRows
    ? buildPhraseRows(catalog, mergePhrases(catalog, phraseSources, userPhraseRows), new Set(workspace.knowledge.map(entry => entry.ref)), new Map((heardRows ?? []).map(row => [row.zh, row])))
    : undefined, [catalog, phraseSources, userPhraseRows, heardRows, workspace.knowledge])
  // Counts without the band files: the shipped counts from the small index, plus the catalog's examples and the learner's own phrases.
  const [phraseIndex, setPhraseIndex] = useState<PhraseIndex | undefined>()
  useEffect(() => { let alive = true; void loadPhraseIndex().then(value => { if (alive) setPhraseIndex(value) }); return () => { alive = false } }, [])
  const examples = useMemo(() => catalog && phraseIndex ? catalogEntries(catalog) : [], [catalog, phraseIndex])
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
  // Japanese and Korean records live in the same table under ja:/ko: refs but are kept out of workspace.knowledge (the Chinese queues); read them here.
  const otherKnown = useLiveQuery(async () => new Set((await db.knowledge.toArray()).map(entry => entry.ref).filter(isParallelRef)), []) ?? new Set<string>()
  const known = new Set([...workspace.knowledge.map(entry => entry.ref), ...otherKnown])
  const inScope = (ref: string) => scope === 'all' || (scope === 'knowledge' ? known.has(ref) : collected.has(ref))
  const characters = useMemo(() => catalog ? dictionaryCharacters(catalog, undefined, workspace.characterStates) : [], [catalog, workspace.characterStates])
  const characterSet = useMemo(() => catalog ? characterKnowledge(catalog, workspace.knowledge, workspace.characterStates) : undefined,
    [catalog, workspace.knowledge, workspace.characterStates])
  const knownCounts = { vocabulary: workspace.knowledge.filter(entry => entry.kind === 'vocabulary').length, grammar: workspace.knowledge.filter(entry => entry.kind === 'grammar').length, characters: characterSet?.all.size ?? 0 }
  const collectedCount = (value: UnitKind) => [...collected].filter(ref => ref.startsWith(`${value}:`)).length
  const zhTab = (value: UnitKind | 'characters') => scope === 'media' ? (value === 'vocabulary' ? sourceEntries.length : 0) : scope === 'collections' ? (value === 'characters' ? 0 : collectedCount(value)) : scope === 'knowledge' ? knownCounts[value] : value === 'characters' ? characters.length : catalogCounts[value]
  /** Japanese and Korean items in a tab: everything for the full list, the records that exist (ja:w:<id>, ko:w:<id>) for the other scopes. */
  const otherTotal = (value: 'vocabulary' | 'grammar') => others.reduce((total, language) => {
    const dict = dicts[language]
    const letter = value === 'vocabulary' ? 'w' : 'g'
    const prefix = `${language}:${letter}:`
    return total + (scope === 'media' ? 0 : scope === 'all' ? (dict ? (value === 'vocabulary' ? dict.words.length : dict.grammar.length) : 0) : scope === 'knowledge' ? [...otherKnown].filter(ref => ref.startsWith(prefix)).length : [...collected].filter(ref => ref.startsWith(prefix)).length)
  }, 0)
  const otherCharCount = others.reduce((total, language) => total + (scope === 'all' ? otherChars[language]?.length ?? 0 : 0), 0)
  const tabCount = (value: UnitKind | 'characters') => multi ? (showZh ? zhTab(value) : 0) + (value === 'characters' ? otherCharCount : otherTotal(value)) : zhTab(value)
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
  const zhRanks = new Map<Unit, number>()
  const matches = catalog && !phrasesView && showZh ? (() => {
    const found: { unit: Extract<Unit, { kind: 'vocabulary' | 'grammar' }>; rank: number }[] = []
    for (const unit of catalog.units.values()) {
      if (unit.kind !== kind || !inScope(unit.ref) || (band !== 'all' && unit.band !== band)) continue
      const rank = matcher.empty ? 0 : matcher.rank({ text: [unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt], pr: unit.record.pr, ds: unit.record.ds })
      if (rank !== undefined) found.push({ unit, rank })
    }
    const ranks = new Map(found.map(entry => [entry.unit, entry.rank]))
    for (const [unit, rank] of ranks) zhRanks.set(unit, rank)
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
  // Japanese and Korean results: the same rank scale as Chinese; knowledge records are ja:w:<id> / ko:w:<id> (nothing matches when none exist).
  type Row = { language: 'zh'; unit: Unit; rank: number } | { language: DictLanguage; word?: DictWord; grammar?: DictGrammar; rank: number }
  const otherRows: Row[] = useMemo(() => {
    if (phrasesView || kind === 'characters' || !multi) return []
    const inOtherScope = (ref: string) => scope === 'media' ? false : scope === 'all' || (scope === 'knowledge' ? known.has(ref) : collected.has(ref))
    const other = makeOtherMatcher(query)
    const list: Row[] = []
    for (const language of others) {
      const dict = dicts[language]
      if (!dict) continue
      const found: { row: Row; index: number }[] = []
      if (kind === 'vocabulary') dict.words.forEach((word, index) => { if ((band === 'all' || word.level === band) && inOtherScope(word.ref)) { const rank = other.word(word); if (rank !== undefined) found.push({ row: { language, word, rank }, index }) } })
      else dict.grammar.forEach((grammar, index) => { if ((band === 'all' || grammar.level === band) && inOtherScope(grammar.ref)) { const rank = other.grammar(grammar); if (rank !== undefined) found.push({ row: { language, grammar, rank }, index }) } })
      const inSet = (row: Row) => known.has(row.language !== 'zh' && row.word ? row.word.ref : row.language !== 'zh' && row.grammar ? row.grammar.ref : '') ? 0 : 1
      const levelOf = (row: Row) => row.language !== 'zh' ? (row.word?.levelNo ?? row.grammar?.levelNo ?? 0) || 99 : 99
      found.sort((a, b) => a.row.rank - b.row.rank || inSet(a.row) - inSet(b.row) || levelOf(a.row) - levelOf(b.row) || a.index - b.index)
      list.push(...found.map(item => item.row))
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phrasesView, kind, multi, query, band, scope, dicts, workspace.knowledge, otherKnown, collected, othersKey])
  // Across languages: best rank first; ties by the language the typed script points to, then the current language (中/日/한 switch), then Chinese, Japanese, Korean.
  const rows: Row[] = (() => {
    if (!multi || phrasesView || kind === 'characters') return []
    const order = [...new Set([...scriptHint(query), currentLanguageOf(workspace.preferences) as 'zh' | DictLanguage, 'zh', 'ja', 'ko'])]
    // Matches on the written form or reading come before matches on a meaning; inside a tier the language order decides.
    const tier = (row: Row) => row.rank < 2 ? 0 : 1
    const zhRows: Row[] = matches.map(unit => ({ language: 'zh' as const, unit, rank: zhRanks.get(unit) ?? 0 }))
    return [...zhRows, ...otherRows].map((row, index) => ({ row, index })).sort((a, b) => tier(a.row) - tier(b.row) || order.indexOf(a.row.language) - order.indexOf(b.row.language) || a.row.rank - b.row.rank || a.index - b.index).map(item => item.row)
  })()
  // Phrases from the Japanese and Korean lessons, each with its Chinese original.
  useEffect(() => {
    if (!phrasesView) return
    let alive = true
    for (const language of others) loadParallel(language).then(value => { if (alive) setLessonData(previous => ({ ...previous, [language]: value })) }, () => undefined)
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phrasesView, othersKey])
  const otherPhrases = useMemo(() => {
    if (!phrasesView) return []
    const q = fold(query.trim())
    const out: { language: DictLanguage; lesson: number; phrase: ParallelPhrase }[] = []
    for (const language of others) for (const lesson of lessonData[language]?.lessons ?? []) for (const phrase of lesson.phrases) {
      if (!q || fold(phrase.text).includes(q) || fold(phrase.reading ?? '').includes(q) || phrase.en.toLowerCase().includes(q) || (phrase.zh ?? '').includes(q)) out.push({ language, lesson: lesson.number, phrase })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phrasesView, query, lessonData, othersKey])
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
  const filteredPhrases = useMemo(() => filterPhraseRows(phraseRows ?? [], { band, query, formOf }), [phraseRows, band, query, formOf])
  const phraseCounts = phraseScopeCounts(filteredPhrases)
  const phraseMatches = filteredPhrases.filter(row => inPhraseScope(row, phraseScope))
  const shownOther = (language: DictLanguage) => (otherChars[language] ?? []).filter(([character]) => (lang === 'all' || script === 'all' || characterScript(character) === script) && matchesCharacter(character, language, query))
  const otherCharacterMatches = kind === 'characters' && scope === 'all' ? others.flatMap(shownOther) : []
  const count = phrasesView ? (showZh ? phraseMatches.length : 0) + otherPhrases.length : scope === 'media' ? sourceMatches.length : (kind === 'characters' ? (showZh ? characterMatches.length : 0) + otherCharacterMatches.length : multi ? rows.length : matches.length)
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
  const renderZh = (unit: Extract<Unit, { kind: 'vocabulary' | 'grammar' }>, tagged: boolean) => <div key={unit.ref} className={`select-item${picked.has(unit.ref) ? ' picked' : ''}`}>{tagged && <LanguageTag language="zh" />}{unit.kind === 'vocabulary' && <div className="select-row">{pickRow(unit.ref, unit.record.ch, unit.record.ch)}{writeTag(unit.record.ch)}</div>}<UnitCard catalog={catalog!} unit={unit} pinyin={workspace.preferences.pinyin} now={now}
      card={workspace.studyCards.find(card => card.id === cardId(unit.ref, DOMAIN))} entry={entries.get(unit.ref)} addedIndex={addedIndex} run={run} busy={busy} route={`dictionary/${kind}/${scope}`} compact otherLines phrases={unit.kind === 'vocabulary' ? { href: `#${phrasesRouteFor(unit.record.ch)}`, count: phraseRows ? phraseUse.get(unit.ref) ?? 0 : indexedUse(unit.ref) } : undefined} /></div>
  return <>
    <PageHeading eyebrow="THE WHOLE CURRICULUM" title={phrasesView ? 'Phrases, ready or pending.' : kind === 'characters' ? 'Characters, one stroke at a time.' : 'Vocabulary and grammar, by band.'}>
      {phrasesView ? 'Every phrase the app can use: lesson examples, the generated bank and the phrases you added. A phrase is ready when you know all its words (and grammar, for a generated one).' : kind === 'characters' ? 'Your character set includes characters from words in your knowledge set, plus any you add manually. Practice their strokes here; inclusion does not claim writing proficiency.'
        : !multi ? 'Every HSK 1-6 sense and construction in the curriculum, separate from your knowledge set. Adding an item makes it eligible for review; it does not claim you know it.'
        : `Every ${lang === 'ja' ? 'JLPT N5-N1' : lang === 'ko' ? 'TOPIK 1-6' : 'HSK, JLPT and TOPIK'} word and grammar point in the curriculum, separate from your knowledge set. Adding an item makes it eligible for review; it does not claim you know it.`}</PageHeading>
    {error && <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>}
    {dictError && <div className="notice error" role="alert"><p>The Japanese or Korean dictionary could not be loaded. {dictError}</p></div>}
    <div className="library-toolbar">
      <div className="segmented" role="group" aria-label="Dictionary section">
        <button aria-pressed={!phrasesView && kind === 'vocabulary'} onClick={() => { goSection('vocabulary') }}>Vocabulary ({tabCount('vocabulary').toLocaleString('en-US')})</button>
        <button aria-pressed={!phrasesView && kind === 'grammar'} onClick={() => { goSection('grammar') }}>Grammar ({tabCount('grammar').toLocaleString('en-US')})</button>
        <button aria-pressed={!phrasesView && kind === 'characters'} onClick={() => { goSection('characters') }}>Characters{catalog ? ` (${tabCount('characters').toLocaleString('en-US')})` : ''}</button>
        <button aria-pressed={phrasesView} onClick={() => { goSection('phrases') }}>Phrases{!showZh ? '' : phraseRows ? ` (${phraseRows.length.toLocaleString('en-US')})` : indexedTotal !== undefined ? ` (${indexedTotal.toLocaleString('en-US')})` : ''}</button>
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
      <label className="filter-label">Language <select value={lang} onChange={event => goLanguage(event.target.value as FilterLanguage)} aria-label="Language filter">{(['all', 'zh', 'ja', 'ko'] as FilterLanguage[]).map(value => <option key={value} value={value}>{languageLabel[value]}</option>)}</select></label>
      {!multi && <label className="filter-label">Band <select value={band} onChange={event => select(setBand)(event.target.value)}><option value="all">All bands</option>{catalogBands.map(value => <option key={value} value={value}>HSK {value}{catalog && !phrasesView ? ` (${(bandCounts.get(value) ?? 0).toLocaleString('en-US')})` : ''}</option>)}</select></label>}
      {multi && lang !== 'all' && <label className="filter-label">Band <select value={band} onChange={event => select(setBand)(event.target.value)} aria-label="Band"><option value="all">All bands</option>{(dicts[lang as DictLanguage]?.levels ?? []).map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
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
    {kind === 'characters' && showZh && <p className="small muted">Full list includes prepared Chinese characters and characters in app vocabulary, including those without guides. Band filters use containing words, not a separate character syllabus. The built-in writing guides cover every character in the HSK 2021 standard word lists (bands 1–9) and the app course tracks. Word meanings and readings below are context, not character definitions.</p>}
    <p className="small muted" role="status">{others.some(language => !dicts[language]) && !dictError ? `Loading ${others.filter(language => !dicts[language]).map(language => languageLabel[language]).join(' and ')}...` : (catalog || !showZh) ? phrasesView && showZh && !phraseRows ? 'Loading phrases...' : phrasesView ? `${count} ${count === 1 ? 'phrase' : 'phrases'}` : `${count} ${kind === 'characters' ? count === 1 ? 'character' : 'characters' : count === 1 ? 'item' : 'items'}` : 'Loading the curriculum...'}</p>
    {phrasesView && <>
      {showZh && phraseMatches.length > 0 && <PhraseTable rows={phraseMatches.slice(0, limit)} route={`dictionary/phrases/${phraseScope}`} pinyin={workspace.preferences.pinyin} busy={busy} onPlay={zh => playBrowserSpeech('dictionary-phrases', zh, 'zh-Hans')} onRemove={zh => void run(async () => { await removeUserPhrase(zh) })} />}
      {otherPhrases.length > 0 && <><h2 className="small muted">Japanese and Korean lesson phrases</h2><ul className="plain-list" data-testid="other-phrases">{otherPhrases.slice(0, limit).map(item => <div key={item.language + item.lesson + item.phrase.id} className="dict-result"><LanguageTag language={item.language} /><DictPhrase phrase={item.phrase} language={item.language} lesson={item.lesson} /></div>)}</ul></>}</>}
    {!phrasesView && scope === 'media' && <div className="word-grid">{sourceMatches.slice(0, limit).map(entry => <SourceEntryCard key={entry.id} entry={entry} known={known.has(`source:${entry.id}`)} card={workspace.studyCards.find(card => card.id === cardId(`source:${entry.id}`, DOMAIN))}
      added={entries.get(`source:${entry.id}`)} addedIndex={addedIndex} pinyin={workspace.preferences.pinyin} now={now} run={run} busy={busy} route={`dictionary/vocabulary/media`} />)}</div>}
    {catalog && !phrasesView && !multi && kind !== 'characters' && scope !== 'media' && <div className="word-grid">{matches.slice(0, limit).map(unit => renderZh(unit, false))}</div>}
    {!phrasesView && multi && kind !== 'characters' && scope !== 'media' && <div className="word-grid" data-testid="dictionary-results">{rows.slice(0, limit).map(row => row.language === 'zh' ? (catalog ? renderZh(row.unit as Extract<Unit, { kind: 'vocabulary' | 'grammar' }>, true) : null)
      : row.word ? <OtherWordCard key={row.word.ref} word={row.word} language={row.language} known={known.has(row.word.ref)} catalog={catalog} tag />
      : row.grammar ? <OtherGrammarCard key={row.grammar.ref} item={row.grammar} language={row.language} known={known.has(row.grammar.ref)} tag /> : null)}</div>}
    {!phrasesView && scope !== 'media' && sourceMatches.length > 0 && <><h2 className="small muted">From your media</h2><div className="word-grid">{sourceMatches.slice(0, limit).map(entry => <SourceEntryCard key={entry.id} entry={entry} known={known.has(`source:${entry.id}`)} card={workspace.studyCards.find(card => card.id === cardId(`source:${entry.id}`, DOMAIN))}
      added={entries.get(`source:${entry.id}`)} addedIndex={addedIndex} pinyin={workspace.preferences.pinyin} now={now} run={run} busy={busy} route={`dictionary/vocabulary/${scope}`} />)}</div></>}
    {!phrasesView && kind === 'characters' && others.length > 0 && scope !== 'media' && <>
      {scope !== 'all' && <p className="notice" role="note" data-testid="characters-note">Your {others.map(language => languageLabel[language]).join(' and ')} characters are listed in the Full list: writing practice there is not tied to a knowledge set yet.</p>}
      {scope === 'all' && others.map(language => <section key={language} aria-label={`${languageLabel[language]} characters`} data-testid={`other-characters-${language}`}>
        {lang !== 'all' && <div className="segmented" role="group" aria-label="Script"><button type="button" aria-pressed={script === 'all'} onClick={() => select(setScript)('all')}>All scripts</button>{scriptsOf[language].map(value => <button key={value} type="button" aria-pressed={script === value} onClick={() => select(setScript)(value)}>{scriptLabel[value]}</button>)}</div>}
        {lang === 'all' && <h2 className="small muted">{languageLabel[language]}</h2>}
        {!otherChars[language] ? <p className="small muted" role="status">Loading the {languageLabel[language]} writing guides...</p> : <div className="word-grid character-grid">{shownOther(language).slice(0, limit).map(([character, strokes]) => <OtherCharacterCard key={character} character={character} strokes={strokes} language={language} dictionary={dicts[language]} />)}</div>}
      </section>)}
    </>}
    {catalog && !phrasesView && kind === 'characters' && showZh && <div className="word-grid character-grid">{characterMatches.slice(0, limit).map(entry => <div key={entry.character} className={`select-item${picked.has(entry.character) ? ' picked' : ''}`}>{selecting && <div className="select-row">{pickRow(entry.character, entry.character, entry.character)}</div>}<CharacterCard entry={entry}
      automatic={characterSet?.automatic.has(entry.character) ?? false} manual={characterSet?.manual.has(entry.character) ?? false}
      state={workspace.characterStates.find(state => state.character === entry.character)} known={known} scope={scope === 'collections' || scope === 'media' ? 'all' : scope} pinyin={workspace.preferences.pinyin} run={run} busy={busy} /></div>)}</div>}
    {undo && <p className="history-toast" role="status">{undo.label}{undo.changes.length > 0 && <> <button type="button" className="button secondary" onClick={restore}>Undo</button></>}</p>}
    {count > limit && <div className="button-row"><button className="button secondary" onClick={() => setLimit(limit + PAGE)}>Show more ({count - limit} remaining)</button></div>}
    {(catalog || !showZh) && !count && !(phrasesView && showZh && !phraseRows) && !(kind === 'characters' && !phrasesView && !showZh) && !others.some(language => !dicts[language]) && <EmptyState title={phrasesView ? 'No matching phrases' : scope === 'collections' && !collected.size ? `No ${TERM.plural} items yet` : scope === 'knowledge' && !(multi ? tabCount(kind) : knownCounts[kind]) ? 'Your knowledge set is empty' : 'No matching items'}><p>{phrasesView ? 'Try another search, band, or scope.' : scope === 'knowledge' && !(multi ? tabCount(kind) : knownCounts[kind]) ? kind === 'characters' ? 'Add a character from the full list, or add a word to your knowledge set.' : 'Add items here, or start with New in Lessons.' : 'Try another search, band, or section.'}</p><a href="#lessons" className="button secondary">Go to Lessons</a></EmptyState>}
    <p className="page-footnote">{phrasesView ? 'Practice-set sentences are not listed here. Heard counts come from Hands-free.' : kind === 'characters' ? <>Guided writing records completed practice, not mastery or an FSRS writing schedule. Most guides are source-derived and unreviewed. <a href={characterAttributionUrl} target="_blank" rel="noreferrer">Artwork sources and licenses</a>.</>
      : 'Review timing for each item in your knowledge set follows FSRS spaced repetition for reading. Writing practice is available in Characters and is tracked separately. The inventory follows the November 2025 HSK examination syllabus; it is an AI-assisted editorial draft, not an official sense list.'}</p>
    {kind === 'characters' && !phrasesView && others.length > 0 && <p className="page-footnote" data-testid="other-writing-attribution">{others.map(language => <span key={language}>{languageLabel[language]} stroke data: <a href={characterAttributionUrlFor(language)} target="_blank" rel="noreferrer">Artwork sources and licenses</a>. </span>)}</p>}
    {others.length > 0 && <p className="page-footnote" data-testid="other-attribution">{others.map(language => <span key={language}>{language === 'ja' ? 'Japanese words: JMdict/EDICT (EDRDG), levels from Waller\u2019s JLPT Resources.' : 'Korean words: National Institute of Korean Language, Korean-English Learners\u2019 Dictionary (CC BY-SA 2.0 KR).'} <a href={`${import.meta.env.BASE_URL}dictionary/${language === 'ja' ? 'japanese' : 'korean'}/ATTRIBUTION.txt`} target="_blank" rel="noreferrer">Sources and licenses</a>. </span>)}Levels are estimates, not an official list.</p>}
  </>
}
