import { useState } from 'react'
import { Search } from 'lucide-react'
import { starterWords, words } from '../data/mandarin'
import { curriculumWords } from '../data/curriculum'
import { readingStage } from '../core/progress'
import { normalizeSearch } from '../core/search'
import { EmptyState, PageHeading, WordCard, type PageProps } from '../components/shared'

export function Dictionary({ workspace, run, busy }: PageProps) {
  const [query, setQuery] = useState('')
  const [collection, setCollection] = useState<'learning' | 'curriculum' | 'starter'>('learning')
  const [stage, setStage] = useState('all')
  const matches = words.filter(word => {
    const state = workspace.words.find(item => item.wordId === word.id)
    return (collection === 'learning' ? state : collection === 'curriculum' ? word.curriculum : !word.curriculum)
      && (stage === 'all' || readingStage(state) === stage)
      && normalizeSearch(`${word.native} ${word.pinyin} ${word.meaning} ${word.label ?? ''} ${word.id}`).includes(normalizeSearch(query))
  })
  return <>
    <PageHeading eyebrow="YOUR WORDS, TOGETHER" title="Your learning set.">Precise vocabulary senses, with saved reading recognition. Different meanings of the same word keep separate evidence.</PageHeading>
    <div className="library-toolbar"><div className="segmented" role="group" aria-label="Dictionary collection">
      <button aria-pressed={collection === 'learning'} onClick={() => setCollection('learning')}>Learning set ({workspace.words.length})</button>
      <button aria-pressed={collection === 'curriculum'} onClick={() => setCollection('curriculum')}>Curriculum ({curriculumWords.length})</button>
      <button aria-pressed={collection === 'starter'} onClick={() => setCollection('starter')}>Starter examples ({starterWords.length})</button></div>
      <label className="search-field"><Search size={18} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Character, pinyin, or meaning" aria-label="Search dictionary" /></label>
      <label className="filter-label">Reading state <select value={stage} onChange={event => setStage(event.target.value)}><option value="all">All states</option>{['Not studied', 'Introduced', 'Practicing', 'Learned'].map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <p className="small muted" role="status">{matches.length} {matches.length === 1 ? 'word' : 'words'}</p>
    <div className="word-grid">{matches.map(word => <WordCard key={word.id} word={word} state={workspace.words.find(state => state.wordId === word.id)} pinyin={workspace.preferences.pinyin} source="dictionary" run={run} busy={busy} />)}</div>
    {!matches.length && <EmptyState title={workspace.words.length || collection !== 'learning' ? 'No matching words' : 'A little curiosity goes a long way.'}><p>{workspace.words.length || collection !== 'learning' ? 'Try another search, collection, or reading state.' : 'Add a word from a story, explore the curriculum collection, or begin a lesson.'}</p><a href="#lessons" className="button secondary">Explore lessons</a></EmptyState>}
    <p className="page-footnote">Introduced means added to your set. Practicing means you have checked an answer. Learned requires unaided reading success on three different days, using both question directions since the last miss or assisted answer. No automatic Mastered status is awarded.</p>
    <p className="page-footnote">The curriculum collection contains the 205 beginner senses, not every meaning in the reference dictionary. Original starter examples retain their own IDs and progress; they do not automatically count toward curriculum senses.</p>
  </>
}
