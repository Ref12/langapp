import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { normalizeSearch } from '../core/search'
import { catalogBands, catalogCounts, type Unit } from '../core/study/catalog'
import { cardId, type UnitKind } from '../core/study/contracts'
import { DOMAIN } from '../core/study/knowledge'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { UnitCard } from '../components/study/UnitCard'
import { useCatalog } from '../components/study/useCatalog'
import { characterKnowledge, dictionaryCharacters } from '../core/characters/dictionary'
import { characterAttributionUrl } from '../core/characters/assets'
import { CharacterCard } from '../components/characters/CharacterCard'
import './writing.css'

const PAGE = 48

function searchText(unit: Unit): string {
  return normalizeSearch(unit.kind === 'vocabulary'
    ? `${unit.record.ch} ${unit.record.pr} ${unit.record.ds} ${unit.record.lb}`
    : `${unit.record.pt} ${unit.record.pr} ${unit.record.ds} ${unit.record.lb}`)
}

export function Dictionary({ workspace, now, run, busy, section, initialScope }: PageProps & { section?: string; initialScope?: string }) {
  const { catalog, error } = useCatalog()
  const kind: UnitKind | 'characters' = section === 'characters' ? 'characters' : section === 'grammar' ? 'grammar' : 'vocabulary'
  const [scope, setScope] = useState<'all' | 'knowledge'>(initialScope === 'knowledge' ? 'knowledge' : 'all')
  const [band, setBand] = useState('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const known = new Set(workspace.knowledge.map(entry => entry.ref))
  const characters = useMemo(() => catalog ? dictionaryCharacters(catalog, undefined, workspace.characterStates) : [], [catalog, workspace.characterStates])
  const characterSet = useMemo(() => catalog ? characterKnowledge(catalog, workspace.knowledge, workspace.characterStates) : undefined,
    [catalog, workspace.knowledge, workspace.characterStates])
  const knownCounts = { vocabulary: workspace.knowledge.filter(entry => entry.kind === 'vocabulary').length, grammar: workspace.knowledge.filter(entry => entry.kind === 'grammar').length, characters: characterSet?.all.size ?? 0 }
  const normalized = normalizeSearch(query)
  const matches = catalog ? [...catalog.units.values()].filter(unit => unit.kind === kind
    && (scope === 'all' || known.has(unit.ref))
    && (band === 'all' || unit.band === band)
    && (!normalized || searchText(unit).includes(normalized))) : []
  const characterMatches = kind === 'characters' ? characters.filter(entry => (scope === 'all' || characterSet?.all.has(entry.character))
    && (band === 'all' || entry.bands.some(value => value === band))
    && (!normalized || normalizeSearch(`${entry.character} U+${entry.character.codePointAt(0)!.toString(16)} ${entry.words.map(word => `${word.record.ch} ${word.record.pr} ${word.record.ds}`).join(' ')}`).includes(normalized))) : []
  const count = kind === 'characters' ? characterMatches.length : matches.length
  const select = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setLimit(PAGE) }
  return <>
    <PageHeading eyebrow="THE WHOLE CURRICULUM" title={kind === 'characters' ? 'Characters, one stroke at a time.' : 'Vocabulary and grammar, by band.'}>
      {kind === 'characters' ? 'Your character set includes characters from words in your knowledge set, plus any you add manually. Practice their strokes here; inclusion does not claim writing proficiency.'
        : 'Every HSK 1-6 sense and construction in the curriculum, separate from your knowledge set. Adding an item makes it eligible for review; it does not claim you know it.'}</PageHeading>
    {error && <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>}
    <div className="library-toolbar">
      <div className="segmented" role="group" aria-label="Dictionary section">
        <button aria-pressed={kind === 'vocabulary'} onClick={() => { window.location.hash = 'dictionary' }}>Vocabulary ({catalogCounts.vocabulary})</button>
        <button aria-pressed={kind === 'grammar'} onClick={() => { window.location.hash = 'dictionary/grammar' }}>Grammar ({catalogCounts.grammar})</button>
        <button aria-pressed={kind === 'characters'} onClick={() => { window.location.hash = 'dictionary/characters' }}>Characters{catalog ? ` (${characters.length})` : ''}</button>
      </div>
      <div className="segmented" role="group" aria-label="Dictionary scope">
        <button aria-pressed={scope === 'all'} onClick={() => select(setScope)('all')}>Full list</button>
        <button aria-pressed={scope === 'knowledge'} onClick={() => select(setScope)('knowledge')}>My knowledge set ({knownCounts[kind]})</button>
      </div>
      <label className="search-field"><Search size={18} /><input type="search" value={query} onChange={event => select(setQuery)(event.target.value)} placeholder={kind === 'characters' ? 'Character, codepoint, or containing word' : kind === 'vocabulary' ? 'Character, pinyin, or meaning' : 'Pattern, pinyin, or meaning'} aria-label="Search dictionary" /></label>
      <label className="filter-label">Band <select value={band} onChange={event => select(setBand)(event.target.value)}><option value="all">All bands</option>{catalogBands.map(value => <option key={value} value={value}>HSK {value}</option>)}</select></label>
    </div>
    {kind === 'characters' && <p className="small muted">Full list includes prepared Chinese characters and characters in app vocabulary, including those without guides. Band filters use containing words, not a separate character syllabus. Word meanings and readings below are context, not character definitions.</p>}
    <p className="small muted" role="status">{catalog ? `${count} ${kind === 'characters' ? count === 1 ? 'character' : 'characters' : count === 1 ? 'item' : 'items'}` : 'Loading the curriculum...'}</p>
    {catalog && kind !== 'characters' && <div className="word-grid">{matches.slice(0, limit).map(unit => <UnitCard key={unit.ref} catalog={catalog} unit={unit} pinyin={workspace.preferences.pinyin} now={now}
      card={workspace.studyCards.find(card => card.id === cardId(unit.ref, DOMAIN))} run={run} busy={busy} route="dictionary" compact />)}</div>}
    {catalog && kind === 'characters' && <div className="word-grid character-grid">{characterMatches.slice(0, limit).map(entry => <CharacterCard key={entry.character} entry={entry}
      automatic={characterSet?.automatic.has(entry.character) ?? false} manual={characterSet?.manual.has(entry.character) ?? false}
      state={workspace.characterStates.find(state => state.character === entry.character)} scope={scope} pinyin={workspace.preferences.pinyin} run={run} busy={busy} />)}</div>}
    {count > limit && <div className="button-row"><button className="button secondary" onClick={() => setLimit(limit + PAGE)}>Show more ({count - limit} remaining)</button></div>}
    {catalog && !count && <EmptyState title={scope === 'knowledge' && !knownCounts[kind] ? 'Your knowledge set is empty' : 'No matching items'}><p>{scope === 'knowledge' && !knownCounts[kind] ? kind === 'characters' ? 'Add a character from the full list, or add a word to your knowledge set.' : 'Add items here, or start with New in Lessons.' : 'Try another search, band, or section.'}</p><a href="#lessons" className="button secondary">Go to Lessons</a></EmptyState>}
    <p className="page-footnote">{kind === 'characters' ? <>Guided writing records completed practice, not mastery or an FSRS writing schedule. Most guides are source-derived and unreviewed. <a href={characterAttributionUrl} target="_blank" rel="noreferrer">Artwork sources and licenses</a>.</>
      : 'Review timing for each item in your knowledge set follows FSRS spaced repetition for reading. Writing practice is available in Characters and is tracked separately. The inventory follows the November 2025 HSK examination syllabus; it is an AI-assisted editorial draft, not an official sense list.'}</p>
  </>
}
