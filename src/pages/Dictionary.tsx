import { useState } from 'react'
import { Search } from 'lucide-react'
import { normalizeSearch } from '../core/search'
import { catalogBands, catalogCounts, type Unit } from '../core/study/catalog'
import { cardId, type UnitKind } from '../core/study/contracts'
import { DOMAIN } from '../core/study/knowledge'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { UnitCard } from '../components/study/UnitCard'
import { useCatalog } from '../components/study/useCatalog'

const PAGE = 48

function searchText(unit: Unit): string {
  return normalizeSearch(unit.kind === 'vocabulary'
    ? `${unit.record.ch} ${unit.record.pr} ${unit.record.ds} ${unit.record.lb}`
    : `${unit.record.pt} ${unit.record.pr} ${unit.record.ds} ${unit.record.lb}`)
}

export function Dictionary({ workspace, now, run, busy }: PageProps) {
  const { catalog, error } = useCatalog()
  const [kind, setKind] = useState<UnitKind>('vocabulary')
  const [scope, setScope] = useState<'all' | 'knowledge'>('all')
  const [band, setBand] = useState('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const known = new Set(workspace.knowledge.map(entry => entry.ref))
  const knownCounts = { vocabulary: workspace.knowledge.filter(entry => entry.kind === 'vocabulary').length, grammar: workspace.knowledge.filter(entry => entry.kind === 'grammar').length }
  const normalized = normalizeSearch(query)
  const matches = catalog ? [...catalog.units.values()].filter(unit => unit.kind === kind
    && (scope === 'all' || known.has(unit.ref))
    && (band === 'all' || unit.band === band)
    && (!normalized || searchText(unit).includes(normalized))) : []
  const select = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setLimit(PAGE) }
  return <>
    <PageHeading eyebrow="THE WHOLE CURRICULUM" title="Vocabulary and grammar, by band.">Every HSK 1-6 sense and construction in the curriculum, separate from your knowledge set. Adding an item makes it eligible for review; it does not claim you know it.</PageHeading>
    {error && <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>}
    <div className="library-toolbar">
      <div className="segmented" role="group" aria-label="Dictionary section">
        <button aria-pressed={kind === 'vocabulary'} onClick={() => select(setKind)('vocabulary')}>Vocabulary ({catalogCounts.vocabulary})</button>
        <button aria-pressed={kind === 'grammar'} onClick={() => select(setKind)('grammar')}>Grammar ({catalogCounts.grammar})</button>
      </div>
      <div className="segmented" role="group" aria-label="Dictionary scope">
        <button aria-pressed={scope === 'all'} onClick={() => select(setScope)('all')}>Full list</button>
        <button aria-pressed={scope === 'knowledge'} onClick={() => select(setScope)('knowledge')}>My knowledge set ({knownCounts[kind]})</button>
      </div>
      <label className="search-field"><Search size={18} /><input type="search" value={query} onChange={event => select(setQuery)(event.target.value)} placeholder={kind === 'vocabulary' ? 'Character, pinyin, or meaning' : 'Pattern, pinyin, or meaning'} aria-label="Search dictionary" /></label>
      <label className="filter-label">Band <select value={band} onChange={event => select(setBand)(event.target.value)}><option value="all">All bands</option>{catalogBands.map(value => <option key={value} value={value}>HSK {value}</option>)}</select></label>
    </div>
    <p className="small muted" role="status">{catalog ? `${matches.length} ${matches.length === 1 ? 'item' : 'items'}` : 'Loading the curriculum...'}</p>
    {catalog && <div className="word-grid">{matches.slice(0, limit).map(unit => <UnitCard key={unit.ref} catalog={catalog} unit={unit} pinyin={workspace.preferences.pinyin} now={now}
      card={workspace.studyCards.find(card => card.id === cardId(unit.ref, DOMAIN))} run={run} busy={busy} route="dictionary" compact />)}</div>}
    {matches.length > limit && <div className="button-row"><button className="button secondary" onClick={() => setLimit(limit + PAGE)}>Show more ({matches.length - limit} remaining)</button></div>}
    {catalog && !matches.length && <EmptyState title={scope === 'knowledge' && !known.size ? 'Your knowledge set is empty' : 'No matching items'}><p>{scope === 'knowledge' && !known.size ? 'Add items here, or start with New in Lessons.' : 'Try another search, band, or section.'}</p><a href="#lessons" className="button secondary">Go to Lessons</a></EmptyState>}
    <p className="page-footnote">Review timing for each item in your knowledge set follows FSRS spaced repetition for reading. Other skills are not tracked yet. The inventory follows the November 2025 HSK examination syllabus; it is an AI-assisted editorial draft, not an official sense list.</p>
  </>
}
