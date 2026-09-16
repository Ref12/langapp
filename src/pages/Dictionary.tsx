import { useState } from 'react'
import { Search } from 'lucide-react'
import { words } from '../data/mandarin'
import { readingStage } from '../core/progress'
import { EmptyState, PageHeading, WordCard, type PageProps } from '../components/shared'

function searchable(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

export function Dictionary({ workspace, run, busy }: PageProps) {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const [stage, setStage] = useState('all')
  const matches = words.filter(word => {
    const state = workspace.words.find(item => item.wordId === word.id)
    return (all || state) && (stage === 'all' || readingStage(state) === stage)
      && searchable(`${word.native} ${word.pinyin} ${word.meaning}`).includes(searchable(query.trim()))
  })
  return <>
    <PageHeading eyebrow="YOUR WORDS, TOGETHER" title="Your learning set.">The words you meet in stories and lessons, with one shared reading history.</PageHeading>
    <div className="library-toolbar"><div className="segmented" role="group" aria-label="Dictionary collection"><button aria-pressed={!all} onClick={() => setAll(false)}>Learning set ({workspace.words.length})</button><button aria-pressed={all} onClick={() => setAll(true)}>Starter collection ({words.length})</button></div>
      <label className="search-field"><Search size={18} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Character, pinyin, or meaning" aria-label="Search dictionary" /></label>
      <label className="filter-label">Reading state <select value={stage} onChange={event => setStage(event.target.value)}><option value="all">All states</option>{['Not studied', 'Introduced', 'Practicing', 'Learned'].map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <p className="small muted" role="status">{matches.length} {matches.length === 1 ? 'word' : 'words'}</p>
    <div className="word-grid">{matches.map(word => <WordCard key={word.id} word={word} state={workspace.words.find(state => state.wordId === word.id)} pinyin={workspace.preferences.pinyin} source="dictionary" run={run} busy={busy} />)}</div>
    {!matches.length && <EmptyState title={workspace.words.length || all ? 'No matching words' : 'A little curiosity goes a long way.'}><p>{workspace.words.length || all ? 'Try another search or reading state.' : 'Add a word from a story, explore the starter collection, or begin a lesson.'}</p><a href="#lessons" className="button secondary">Explore lessons</a></EmptyState>}
    <p className="page-footnote">Introduced means added to your set. Practicing means you have checked an answer. Learned requires unaided reading success on three different days, using both question directions since the last miss or assisted answer. No automatic Mastered status is awarded.</p>
  </>
}
