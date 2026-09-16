import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Search } from 'lucide-react'
import { getWord, stories } from '../data/mandarin'
import { moveReading, openStory, savePreferences } from '../core/learning'
import type { ReadingMode, Segment, Story } from '../core/model'
import { EmptyState, PageHeading, WordCard, type PageProps } from '../components/shared'

export function Library({ workspace }: PageProps) {
  const [query, setQuery] = useState('')
  const matches = stories.filter(story => `${story.title} ${story.topic}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <>
    <PageHeading eyebrow="MEANING BEFORE MEMORIZATION" title="Your next good read.">Original stories with prepared Mandarin translations. No AI setup required.</PageHeading>
    <div className="library-toolbar"><span className="small muted">{matches.length} stories</span>
      <label className="search-field"><Search size={18} /><input type="search" aria-label="Search library" placeholder="Search your library" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    <div className="book-grid">{matches.map(story => {
      const progress = workspace.readings.find(item => item.storyId === story.id)
      return <a key={story.id} className="book-card" href={`#reader/${story.id}`}>
        <div className={`book-cover ${story.id === 'zh:after-rain' ? 'cover-rain' : ''}`}><span className="eyebrow">{story.topic}</span><span lang="zh-Hans" className="cover-glyph">{story.glyph}</span><span>ORIGINAL STORY</span></div>
        <div className="book-details"><div className="card-topline"><span className="tag">{progress?.completed.length === story.passages.length ? 'Read' : progress ? 'In progress' : 'Ready to read'}</span><BookOpen size={18} /></div>
          <h2>{story.title}</h2><p>{story.description}</p>
          <progress aria-label={`${story.title} reading progress`} value={progress?.completed.length ?? 0} max={story.passages.length} />
          <p className="small muted">{progress?.completed.length ?? 0} of {story.passages.length} passages read</p>
        </div>
      </a>
    })}</div>
    {!matches.length && <EmptyState title="No matching stories"><p>Try a title or topic such as tea, rain, or nature.</p><button className="button secondary" onClick={() => setQuery('')}>Clear search</button></EmptyState>}
    <p className="page-footnote">Personal imports and generated translations are not connected yet. The original import tools remain in <a href="./v1/#/modules/reading">v1</a>, with separate learning data.</p>
  </>
}

function Passage({ story, index, ...props }: PageProps & { story: Story; index: number }) {
  const { workspace, busy, run } = props
  const passage = story.passages[index]
  const vocabulary = [...new Set([...passage.source, ...passage.target].flatMap(segment => typeof segment === 'string' ? [] : [segment.wordId]))]
  const [selected, setSelected] = useState(vocabulary[0])
  const help = useRef<HTMLElement>(null)
  const word = getWord(selected)
  const mode = workspace.preferences.readingMode
  const render = (segment: Segment, key: number) => {
    if (typeof segment === 'string') return <span key={key}>{segment}</span>
    const item = getWord(segment.wordId)
    const woven = mode === 'weave' && workspace.words.some(state => state.wordId === item.id)
    const target = mode === 'target' || woven
    return <button key={key} className={`reading-token ${target ? 'target-token' : ''}`} aria-label={`Word help: ${item.meaning}`}
      aria-pressed={selected === item.id} aria-controls="reader-word-help" onClick={() => {
        setSelected(item.id)
        if (window.innerWidth <= 760) requestAnimationFrame(() => help.current?.scrollIntoView({ block: 'nearest' }))
      }}>
      {target ? <ruby lang="zh-Hans">{segment.text ?? item.native}{workspace.preferences.pinyin && <rt>{item.pinyin}</rt>}</ruby> : segment.text ?? item.meaning}
    </button>
  }
  return <div className="reader-layout">
    <article className="reading-surface"><p className="eyebrow">PASSAGE {index + 1} OF {story.passages.length}</p>
      <div className="reading-text" lang={mode === 'target' ? 'zh-Hans' : 'en'}>{(mode === 'target' ? passage.target : passage.source).map(render)}</div>
      <p className="small muted">Select an underlined word for help. Weave replaces only the annotated words you have added to your learning set.</p>
      <div className="button-row reader-navigation">
        <button className="button secondary" disabled={busy || index === 0} onClick={() => void run(() => moveReading(story.id, index, index - 1, false))}><ArrowLeft size={16} /> Previous</button>
        <button className="button primary" disabled={busy} onClick={() => void run(() => moveReading(story.id, index, Math.min(index + 1, story.passages.length - 1), true))}>
          {index === story.passages.length - 1 ? 'Mark passage read' : 'Read & continue'} <ArrowRight size={16} /></button>
      </div>
    </article>
    <aside id="reader-word-help" ref={help} className="word-help" aria-label="Word help" aria-live="polite"><WordCard word={word} state={workspace.words.find(item => item.wordId === word.id)} pinyin={workspace.preferences.pinyin} source={`story:${story.id}`} run={run} busy={busy} /></aside>
  </div>
}

export function Reader(props: PageProps & { story: Story }) {
  const { story, workspace, run, busy } = props
  const progress = workspace.readings.find(item => item.storyId === story.id)
  useEffect(() => { void run(() => openStory(story.id)) }, [run, story.id])
  return <>
    <a className="back-link" href="#library"><ArrowLeft size={16} /> Library</a>
    <PageHeading eyebrow={story.topic} title={story.title} action={<a className="button secondary" href="#lessons">Explore Mandarin lessons <ArrowRight size={16} /></a>}>{story.description}</PageHeading>
    <div className="reader-toolbar">
      <div className="segmented" role="group" aria-label="Reading mode">{(['source', 'weave', 'target'] as ReadingMode[]).map(mode => <button key={mode} disabled={busy} aria-pressed={workspace.preferences.readingMode === mode}
        onClick={() => void run(() => savePreferences({ readingMode: mode }))}>{mode === 'source' ? 'English' : mode === 'target' ? 'Mandarin' : 'Weave'}</button>)}</div>
      <label className="toggle"><input type="checkbox" disabled={busy} checked={workspace.preferences.pinyin} onChange={event => void run(() => savePreferences({ pinyin: event.target.checked }))} /> Show pinyin</label>
      <span className="small muted">{progress?.completed.length ?? 0} of {story.passages.length} passages read</span>
    </div>
    {progress ? <Passage key={`${story.id}:${progress.passage}`} {...props} index={progress.passage} />
      : <div className="panel"><p>Opening your saved reading place...</p><button className="button secondary" disabled={busy} onClick={() => void run(() => openStory(story.id))}>Retry opening story</button></div>}
    {progress?.completed.length === story.passages.length && <div className="notice success" role="status"><strong>Story read.</strong> Your place is saved. Explore the <a href="#lessons">Mandarin curriculum</a> or revisit any passage.</div>}
    <p className="page-footnote">{story.attribution}</p>
  </>
}
