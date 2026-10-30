import { useState } from 'react'
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
import { startRedoSession } from '../core/study/knowledge'
import { navigate } from '../core/routing'
import { useAIConnection } from '../components/study/useAIConnection'
import { Pinyin } from '../components/Pinyin'

function previewText(catalog: Catalog | undefined, refs: string[]): string {
  if (!catalog) return ''
  const text = refs.map(ref => { const unit = catalog.units.get(ref); return unit ? (unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt) : '' }).filter(Boolean).join(', ')
  return [...text].length > 40 ? `${[...text].slice(0, 40).join('').trimEnd()}…` : text
}

type Filter = 'all' | 'speak' | 'write' | 'lessons'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'speak', label: 'Spoken' }, { id: 'write', label: 'Written' }, { id: 'lessons', label: 'Lessons' },
]
const EMPTY: Record<Filter, string> = {
  all: 'Open Phrase Practice from the Assistant or a text selection, or finish a lesson, to add something here.',
  speak: 'No spoken phrases yet.', write: 'No written phrases yet.', lessons: 'No lesson sessions yet.',
}

interface LessonRow { id: string; at: number; mode: 'new' | 'review'; items: number; refs: string[]; exercises: number; answered: number; correct: number; status: string }
type Row = { type: 'phrase'; at: number; entry: PracticeHistoryEntry } | { type: 'lesson'; at: number; lesson: LessonRow }

export function History() {
  const entries = useLiveQuery(async () => (await db.practiceHistory.toArray()).map(entry => practiceHistoryEntrySchema.parse(entry)), [])
  const lessons = useLiveQuery(async (): Promise<LessonRow[]> => {
    const [sessions, attempts] = await Promise.all([db.exerciseSessions.toArray(), db.exerciseAttempts.toArray()])
    return sessions.map(session => {
      const mine = attempts.filter(attempt => attempt.sessionId === session.id && !attempt.redo)
      return { id: session.id, at: session.completedAt ?? session.createdAt, mode: session.mode, items: session.targetRefs.length + session.reviewRefs.length,
          refs: [...session.targetRefs, ...session.reviewRefs],
        exercises: session.exercises.length, answered: mine.length, correct: mine.filter(attempt => attempt.correct).length, status: session.status }
    })
  }, [])
  const stored = useLiveQuery(() => db.preferences.get('workspace').then(item => item?.historyFilter ?? 'all'), [])
  const filter: Filter = stored ?? 'all'
  const [practice, setPractice] = useState<PracticeHistoryEntry>()
  const [error, setError] = useState('')
  const connection = useAIConnection()
  const { catalog } = useCatalog()
  const [redoing, setRedoing] = useState('')
  const redo = (id: string) => {
    setError(''); setRedoing(id)
    startRedoSession(id).then(next => navigate(`lessons/session/${next}`), cause => setError(cause instanceof Error ? cause.message : 'The exercises could not be redone.')).finally(() => setRedoing(''))
  }
  const choose = (next: Filter) => { void savePreferences({ historyFilter: next }).catch(cause => setError(cause instanceof Error ? cause.message : 'The filter could not be saved.')) }
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
  const ready = entries && lessons && stored
  const rows: Row[] = ready ? [
    ...(filter === 'lessons' ? [] : entries.filter(entry => filter === 'all' || entryKinds(entry)[filter] !== undefined)
      .map((entry): Row => ({ type: 'phrase', at: filter === 'all' ? entry.lastOpenedAt : entryKinds(entry)[filter]!, entry }))),
    ...(filter === 'all' || filter === 'lessons' ? lessons.map((lesson): Row => ({ type: 'lesson', at: lesson.at, lesson })) : []),
  ].sort((a, b) => b.at - a.at) : []
  return <section className="phrase-history">
    <div className="page-heading"><div><p className="eyebrow">HISTORY</p><h1>Recently practiced</h1>
      <p>Phrases you spoke or wrote, and your lesson sessions, most recent first.</p></div></div>
    <div className="segmented history-filters" role="group" aria-label="Show">
      {FILTERS.map(item => <button key={item.id} type="button" className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => choose(item.id)}>{item.label}</button>)}
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!ready ? <p role="status">Loading history...</p>
      : !rows.length ? <div className="empty-state"><h2>{filter === 'all' ? 'No phrases yet' : EMPTY[filter]}</h2>
        {filter === 'all' && <p>{EMPTY.all}</p>}
        <a className="button secondary" href={filter === 'lessons' ? '#lessons' : '#conversation'}>{filter === 'lessons' ? 'Open Lessons' : 'Open Assistant'}</a></div>
        : <ol className="phrase-history-list">{rows.map(row => row.type === 'lesson'
          ? <li key={`lesson:${row.lesson.id}`} className="phrase-history-entry history-lesson">
            <span><span className="history-chips"><span className="chip">Lesson</span></span>
              <strong>{row.lesson.mode === 'new' ? 'New items' : 'Review'}</strong>
              <span className="small muted">{row.lesson.items} item{row.lesson.items === 1 ? '' : 's'} · {row.lesson.exercises} exercise{row.lesson.exercises === 1 ? '' : 's'}
                {row.lesson.answered > 0 ? ` · score ${row.lesson.correct}/${row.lesson.answered}` : ''}{row.lesson.status === 'completed' ? '' : ` · ${row.lesson.status}`}</span>
              <span className="small muted" lang="zh-Hans">{previewText(catalog, row.lesson.refs)}</span>
                <time className="small muted" dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleString()}</time></span>
            <a className="button secondary" href={`#lessons/session/${row.lesson.id}`} aria-label={`Open lesson session ${row.lesson.mode === 'new' ? 'New items' : 'Review'}`}>Open</a>
              <button type="button" className="button secondary" disabled={!connection || redoing !== ''} aria-label={`Redo lesson session ${row.lesson.mode === 'new' ? 'New items' : 'Review'}`} title={connection === null ? 'Connect an AI model in Settings to redo exercises.' : undefined} onClick={() => redo(row.lesson.id)}>{redoing === row.lesson.id ? 'Preparing...' : 'Redo'}</button>
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
          </li>)}</ol>}
    {practice && <PracticeSheet route="history" forced={lastKind(practice)} key={practice.text} phrase={practice.phrase} rate={practice.rate}
      savedEnds={practice.chain?.ends} savedItems={practice.chain?.items} busy={false} recordingActive={false}
      saveNotice="This playlist is saved in History. Editing it here does not change the source conversation."
      onClose={async () => setPractice(undefined)} />}
  </section>
}
