import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, EyeOff, Dumbbell } from 'lucide-react'
import { RowMenu } from '../components/RowMenu'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../core/database'
import { practiceHistoryEntrySchema, type PracticeHistoryEntry } from '../core/assistant/contracts'
import { entryKinds, lastKind } from '../core/assistant/practice-history'
import { interruptAudio } from '../core/assistant/audio-owner'
import { stopBrowserSpeech } from '../core/assistant/speech'
import { savePreferences } from '../core/learning'
import { PracticeSheet, PracticeSnippet } from '../components/assistant/SnippetActions'
import type { Catalog } from '../core/study/catalog'
import { useCatalog } from '../components/study/useCatalog'
import { navigate, useRoute } from '../core/routing'
import { removeHistoryItems, restoreHistoryItems, type HistoryKey } from '../core/history-removal'
import { Pinyin } from '../components/Pinyin'
import { DRILL_TYPES, countMarks, scoreOf, type DrillSet } from '../core/drills/contracts'
import { SaveToMenu } from '../components/collections/SaveToMenu'
import { RemoveFromKnowledge } from '../components/study/RemoveFromKnowledge'
import { practiceFrom, resumeRoute } from '../core/drills/store'
import { newCharacters } from '../core/drills/write-queue'

type Filter = 'all' | 'speak' | 'write' | 'lessons' | 'drills'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'speak', label: 'Spoken' }, { id: 'write', label: 'Written' }, { id: 'lessons', label: 'Lessons' }, { id: 'drills', label: 'Practice' },
]
const EMPTY: Record<Filter, string> = {
  all: 'Open Phrase Practice from the Assistant or a text selection, or finish a lesson, to add something here.',
  speak: 'No spoken phrases yet.', write: 'No written phrases yet.', lessons: 'No lesson sessions yet.', drills: 'No practice sets yet.',
}

interface LessonRow { id: string; at: number; mode: 'new' | 'review'; items: number; refs: string[]; exercises: number; answered: number; correct: number; status: string }
export const HISTORY_PAGE_SIZE = 30
const FILTER_IDS = FILTERS.map(item => item.id)
const rowKey = (row: Row): HistoryKey => row.type === 'phrase' ? `phrase:${row.entry.text}` : row.type === 'lesson' ? `lesson:${row.lesson.id}` : `drill:${row.set.id}`
const dayStart = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime() }
/** Today, Yesterday, then the date. */
function dayLabel(at: number, now = Date.now()): string {
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000)
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })
}
/** The filter and page live in the hash (#history?f=lessons&p=3) so Back returns to the same page. */
function readLocation(route: string): { filter?: Filter; page: number } {
  const params = new URLSearchParams(route.split('?').slice(1).join('?'))
  const f = params.get('f'), p = Number(params.get('p'))
  return { filter: FILTER_IDS.includes(f as Filter) ? f as Filter : undefined, page: Number.isInteger(p) && p > 0 ? p : 1 }
}
const locate = (filter: Filter, page: number) => `history?f=${filter}${page > 1 ? `&p=${page}` : ''}`

type Row = { type: 'phrase'; at: number; entry: PracticeHistoryEntry } | { type: 'lesson'; at: number; lesson: LessonRow } | { type: 'drill'; at: number; set: DrillSet }

/** Every item of a past lesson or drill set, as characters with pinyin: history hides nothing. */
function wordList(catalog: Catalog | undefined, refs: readonly string[]) {
  if (!catalog) return null
  const words = refs.flatMap(ref => { const unit = catalog.units.get(ref); return unit ? [{ ref, zh: unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt, py: unit.record.pr }] : [] })
  return words.length ? <span className="history-words" lang="zh-Hans">{words.map(word => <span key={word.ref} className="history-word"><span className="speech-native">{word.zh}</span>{word.py && <span className="small muted"><Pinyin text={word.py} /></span>}</span>)}</span> : null
}
/** "3 to write": the characters of a row's catalog words that have a stroke guide and were never written. Source words are not counted here. */
function toWrite(catalog: Catalog | undefined, refs: readonly string[], states: readonly { character: string; practiceCompletions: number }[]): ReactNode {
  if (!catalog) return null
  const count = newCharacters(refs.flatMap(ref => { const unit = catalog.units.get(ref); return unit?.kind === 'vocabulary' ? [unit.record.ch] : [] }), states).length
  return count ? <span className="small muted history-towrite">{count} to write</span> : null
}
/** One short line: each drill type done with its score. */
function scoreLine(set: DrillSet): string {
  return DRILL_TYPES.flatMap(type => { const progress = set.progress[type.id]; if (!progress) return []
    const score = scoreOf(countMarks(set, [type.id])); return score.total ? [`${type.name} ${score.correct}/${score.total}`] : [] }).join(' · ')
}

export function History() {
  const entries = useLiveQuery(async () => (await db.practiceHistory.toArray()).filter(entry => !entry.removedAt).map(entry => practiceHistoryEntrySchema.parse(entry)), [])
  const lessons = useLiveQuery(async (): Promise<LessonRow[]> => {
    const [sessions, attempts] = await Promise.all([db.exerciseSessions.toArray(), db.exerciseAttempts.toArray()])
    return sessions.filter(session => !session.removedAt).map(session => {
      const mine = attempts.filter(attempt => attempt.sessionId === session.id && !attempt.redo)
      return { id: session.id, at: session.completedAt ?? session.createdAt, mode: session.mode, items: session.targetRefs.length + session.reviewRefs.length,
          refs: [...session.targetRefs, ...session.reviewRefs],
        exercises: session.exercises.length, answered: mine.length, correct: mine.filter(attempt => attempt.correct).length, status: session.status }
    })
  }, [])
  const sets = useLiveQuery(() => db.drillSets.toArray().then(all => all.filter(set => !set.discarded && !set.removedAt)), [])
  const characterStates = useLiveQuery(() => db.characterStates.toArray(), []) ?? []
  const stored = useLiveQuery(() => db.preferences.get('workspace').then(item => item?.historyFilter ?? 'all'), [])
  const where = readLocation(useRoute())
  const filter: Filter = where.filter ?? stored ?? 'all'
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<HistoryKey>>(new Set())
  const [undo, setUndo] = useState<{ keys: HistoryKey[]; label: string } | null>(null)
  useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(null), 10000); return () => clearTimeout(timer) }, [undo])
  const [practice, setPractice] = useState<PracticeHistoryEntry>()
  const [error, setError] = useState('')
  const { catalog } = useCatalog()
  const choose = (next: Filter) => {
    setPicked(new Set()); navigate(locate(next, 1))
    void savePreferences({ historyFilter: next }).catch(cause => setError(cause instanceof Error ? cause.message : 'The filter could not be saved.'))
  }
  const remove = (keys: HistoryKey[], label: string) => {
    setError('');
    removeHistoryItems(keys).then(() => { setUndo({ keys, label }); setPicked(new Set()) }, cause => setError(cause instanceof Error ? cause.message : 'Could not remove from History.'))
  }
  const restore = () => { if (!undo) return; const { keys } = undo; setUndo(null); restoreHistoryItems(keys).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not undo.')) }
  const reopen = (entry: PracticeHistoryEntry) => {
    setError('')
    try {
      interruptAudio()
      const failure = stopBrowserSpeech()
      if (failure) throw new Error(failure)
      setPractice(entry)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Other audio could not be stopped. Try Practice again.')
    }
  }
  const ready = entries && lessons && sets && stored
  const rows: Row[] = ready ? [
    ...(filter === 'lessons' || filter === 'drills' ? [] : entries.filter(entry => filter === 'all' || entryKinds(entry)[filter] !== undefined)
      .map((entry): Row => ({ type: 'phrase', at: filter === 'all' ? entry.lastOpenedAt : entryKinds(entry)[filter]!, entry }))),
    ...(filter === 'all' || filter === 'lessons' ? lessons.map((lesson): Row => ({ type: 'lesson', at: lesson.at, lesson })) : []),
    ...(filter === 'all' || filter === 'drills' ? sets.map((set): Row => ({ type: 'drill', at: set.createdAt, set })) : []),
  ].sort((a, b) => b.at - a.at) : []
  const pages = Math.max(1, Math.ceil(rows.length / HISTORY_PAGE_SIZE))
  const page = Math.min(where.page, pages)
  const shown = rows.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE)
  const groups: { label: string; rows: Row[] }[] = []
  for (const row of shown) { const label = dayLabel(row.at); const last = groups[groups.length - 1]; if (last && last.label === label) last.rows.push(row); else groups.push({ label, rows: [row] }) }
  const go = (next: number) => { navigate(locate(filter, next)); window.scrollTo?.({ top: 0 }) }
  const pageKeys = shown.map(rowKey)
  const allPicked = pageKeys.length > 0 && pageKeys.every(key => picked.has(key))
  const toggle = (key: HistoryKey) => setPicked(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  /** The tail of every row: a checkbox in Select mode, otherwise the ⋯ menu (Remove from knowledge set when it applies, Remove from history). */
  const tools = (row: Row, name: string, extra?: ReactNode) => { const key = rowKey(row)
    return selecting
      ? <label className="history-pick"><input type="checkbox" checked={picked.has(key)} onChange={() => toggle(key)} aria-label={`Select ${name}`} /></label>
      : <RowMenu name={name}>{extra}
        <button type="button" role="menuitem" className="menu-item" title="Removes it from History only. What you learned stays." aria-label={`Remove ${name} from history`} onClick={() => remove([key], name)}><EyeOff size={15} /> Remove from history</button></RowMenu> }
  return <section className="phrase-history">
    <div className="page-heading"><div><p className="eyebrow">HISTORY</p><h1>Recently practiced</h1>
      <p>Phrases you spoke or wrote, your lessons and your practice sets, most recent first.</p></div></div>
    <div className="segmented history-filters" role="group" aria-label="Show">
      {FILTERS.map(item => <button key={item.id} type="button" className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => choose(item.id)}>{item.label}</button>)}
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {ready && rows.length > 0 && <div className="history-bar">
      <button type="button" className="button secondary" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setPicked(new Set()); }}>{selecting ? 'Done' : 'Select'}</button>
      {selecting && <><button type="button" className="button secondary" onClick={() => setPicked(allPicked ? new Set() : new Set(pageKeys))}>{allPicked ? 'Clear this page' : 'Select all on this page'}</button>
        <button type="button" className="button" disabled={!picked.size} onClick={() => remove([...picked], `${picked.size} items`)}>Remove selected ({picked.size})</button>
        <span className="small muted history-bar-note">Removes them from History only. What you learned stays.</span></>}</div>}
    {!ready ? <p role="status">Loading history...</p>
      : !rows.length ? <div className="empty-state"><h2>{filter === 'all' ? 'No phrases yet' : EMPTY[filter]}</h2>
        {filter === 'all' && <p>{EMPTY.all}</p>}
        <a className="button secondary" href={filter === 'lessons' ? '#lessons' : filter === 'drills' ? '#practice' : '#conversation'}>{filter === 'lessons' ? 'Open Lessons' : filter === 'drills' ? 'Open Practice' : 'Open Assistant'}</a></div>
        : <>{groups.map(group => <div key={group.label} className="history-group"><h2 className="history-day">{group.label}</h2>
        <ol className="phrase-history-list">{group.rows.map(row => row.type === 'drill'
          ? <li key={`drill:${row.set.id}`} className="phrase-history-entry history-lesson">
            <span><span className="history-chips"><span className="chip">Practice</span>{(row.set.handsfree?.started || row.set.handsfreeRecall?.started) && row.set.status === 'active' && <span className="chip">Stopped</span>}{row.set.status === 'completed' && <span className="chip">Finished</span>}{row.set.status === 'abandoned' && <span className="chip">Set aside</span>}</span>
              <strong>{row.set.title}</strong>
              <time className="small muted" dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleString()}</time>
              {wordList(catalog, row.set.refs)}{toWrite(catalog, row.set.refs, characterStates)}
              {scoreLine(row.set) && <span className="small muted history-score">{scoreLine(row.set)}</span>}</span>
            <span className="history-actions">
              {row.set.status === 'active' && <a className="icon-button" href={`#${resumeRoute(row.set)}`} aria-label={`Resume ${row.set.title}`} title="Resume"><ArrowRight size={18} /></a>}
              <a className="icon-button" href={`#${practiceFrom('drill', row.set.id)}`} aria-label={`Practice ${row.set.title}`} title="Practice"><Dumbbell size={18} /></a>
              <SaveToMenu refs={[...new Set(row.set.refs)]} name={row.set.title} />
              {tools(row, row.set.title, <RemoveFromKnowledge kind="drill" id={row.set.id} name={row.set.title} menuItem />)}</span>
          </li>
          : row.type === 'lesson'
          ? <li key={`lesson:${row.lesson.id}`} className="phrase-history-entry history-lesson">
            <span><span className="history-chips"><span className="chip">Lesson</span></span>
              <strong>{row.lesson.mode === 'new' ? 'New items' : 'Review'}</strong>
              <span className="small muted">{row.lesson.items} item{row.lesson.items === 1 ? '' : 's'} · {row.lesson.exercises} exercise{row.lesson.exercises === 1 ? '' : 's'}
                {row.lesson.answered > 0 ? ` · score ${row.lesson.correct}/${row.lesson.answered}` : ''}{row.lesson.status === 'completed' ? '' : ` · ${row.lesson.status}`}</span>
              {wordList(catalog, row.lesson.refs)}{toWrite(catalog, row.lesson.refs, characterStates)}
                <time className="small muted" dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleString()}</time></span>
            <span className="history-actions">
              <a className="icon-button" href={`#lessons/session/${row.lesson.id}`} aria-label={`Open lesson session ${row.lesson.mode === 'new' ? 'New items' : 'Review'}`} title="Open"><ArrowRight size={18} /></a>
              <a className="icon-button" href={`#${practiceFrom('lesson', row.lesson.id)}`} aria-label={`Practice lesson session ${row.lesson.mode === 'new' ? 'New items' : 'Review'}`} title="Practice"><Dumbbell size={18} /></a>
              <SaveToMenu refs={[...new Set(row.lesson.refs)]} name="lesson" />
              {tools(row, row.lesson.mode === 'new' ? 'New items lesson' : 'Review lesson', <RemoveFromKnowledge kind="lesson" id={row.lesson.id} name={row.lesson.mode === 'new' ? 'New items lesson' : 'Review lesson'} menuItem />)}</span>
          </li>
          : <li key={`phrase:${row.entry.text}`} className="phrase-history-entry">
            <span><span className="history-chips">
              {entryKinds(row.entry).speak !== undefined && <span className="chip">Spoken</span>}
              {entryKinds(row.entry).write !== undefined && <span className="chip">Written</span>}</span>
              <button type="button" className="history-phrase" aria-label={`Practice ${row.entry.text}`} onClick={() => reopen(row.entry)}>
                <span className="speech-native" lang="zh-Hans">{row.entry.text}</span>
                {row.entry.phrase.romanization && <span className="pinyin" lang="zh-Latn"><Pinyin text={row.entry.phrase.romanization} /></span>}
                {row.entry.phrase.meaning && <span className="small muted">{row.entry.phrase.meaning}</span>}</button>
              <time className="small muted" dateTime={new Date(row.entry.lastOpenedAt).toISOString()}>{new Date(row.entry.lastOpenedAt).toLocaleString()}</time></span>
            <PracticeSnippet source={{ text: row.entry.text, meaning: row.entry.phrase.meaning, locale: 'zh-Hans', title: 'History phrase', route: 'history' }} />
            {tools(row, row.entry.text)}
          </li>)}</ol></div>)}
        {pages > 1 && <nav className="history-pager" aria-label="History pages">
          <button type="button" className="button secondary" disabled={page <= 1} onClick={() => go(page - 1)}>Newer</button>
          <span role="status">Page {page} of {pages}</span>
          <button type="button" className="button secondary" disabled={page >= pages} onClick={() => go(page + 1)}>Older</button>
          <button type="button" className="button secondary" disabled={page >= pages} onClick={() => go(pages)}>Oldest</button></nav>}</>}
    {undo && <p className="history-toast" role="status">Removed {undo.label} from History. <button type="button" className="button secondary" onClick={restore}>Undo</button></p>}
    {practice && <PracticeSheet route="history" forced={lastKind(practice)} key={practice.text} phrase={practice.phrase} rate={practice.rate}
      savedEnds={practice.chain?.ends} savedItems={practice.chain?.items} busy={false} recordingActive={false}
      saveNotice="This playlist is saved in History. Editing it here does not change the source conversation."
      onClose={async () => setPractice(undefined)} />}
  </section>
}
