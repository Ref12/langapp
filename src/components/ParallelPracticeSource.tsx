import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, Eye } from 'lucide-react'
import type { Workspace } from '../core/model'
import { LESSON_COUNT, loadParallel, glossOf, type ParallelData } from '../core/parallel/data'
import type { ParallelLanguage } from '../core/language/ids'
import { parallelDue, parallelKnown } from '../core/parallel/practice'
import { nextParallelLesson, studiedLessons } from '../core/parallel/progress'
import { itemsUpTo, lessonItems } from '../core/parallel/session'
import { languageName } from '../core/characters/language'
import { Sheet } from '../pages/drills/Sheet'
import { Form } from './ParallelForm'
import { ParallelHear } from './ParallelHear'

/** Practice home for a Japanese or Korean track: the curriculum as the source, New items or Reviews, View items and Start. */
export function ParallelPracticeSource({ language, workspace, now }: { language: ParallelLanguage; workspace: Workspace; now: number }) {
  const name = languageName[language]
  const [data, setData] = useState<ParallelData>()
  const [mode, setMode] = useState<'new' | 'review'>('new')
  const [viewing, setViewing] = useState(false)
  useEffect(() => {
    let live = true
    setData(undefined)
    loadParallel(language).then(value => { if (live) setData(value) }, () => undefined)
    return () => { live = false }
  }, [language])
  const counts = useLiveQuery(async () => ({ due: await parallelDue(language, now), known: await parallelKnown(language) }), [language, now])
  const studied = useMemo(() => studiedLessons(workspace.lessons, language), [workspace.lessons, language])
  const number = nextParallelLesson(studied, LESSON_COUNT)
  const all = useMemo(() => data ? itemsUpTo(data, language, LESSON_COUNT) : undefined, [data, language])
  const fresh = data && number !== undefined ? lessonItems(data, language, data.lessons.find(item => item.number === number)!) : []
  const due = counts && all ? counts.due.flatMap(card => all.get(card.ref) ?? []).slice(0, 12) : []
  const items = mode === 'new' ? fresh : due
  const href = mode === 'new' ? (number !== undefined ? `#lessons/${language}/${number}/practise` : undefined) : (due.length ? `#lessons/${language}/review` : undefined)
  const summary = !data ? `Loading the ${name} lessons...` : mode === 'new'
    ? (number === undefined ? 'Nothing new left here' : `${items.length} ${items.length === 1 ? 'item' : 'items'} · ${name} lesson ${number}`)
    : (due.length ? `${due.length} of ${counts?.due.length ?? 0} due` : 'Nothing is due for review right now')
  return <section className="panel dr-panel dr-select" aria-labelledby="dr-parallel"><h2 id="dr-parallel">Practise <span lang={language}>{language === 'ja' ? '日本語' : '한국어'}</span></h2>
    <p className="eyebrow accent">Learning from · {name} curriculum</p>
    <div className="segmented" role="group" aria-label={`What to practise in ${name}`}><button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>New items</button><button type="button" aria-pressed={mode === 'review'} onClick={() => setMode('review')}>Reviews</button></div>
    <p className="dr-summary" role="status">{summary}</p>
    <div className="button-row"><button type="button" className="button secondary" disabled={!items.length} onClick={() => setViewing(true)}><Eye size={16} /> View items</button>
      <a className={`button primary${href ? '' : ' disabled'}`} aria-disabled={!href} href={href} aria-label={`Start ${name} practice`}>Start <ArrowRight size={16} /></a></div>
    {viewing && <Sheet title="Items" label="Items you will practise" wide onClose={() => setViewing(false)}>
      <h2 className="dr-h2">{items.length} {items.length === 1 ? 'item' : 'items'}</h2>
      <div className="word-grid">{items.map(item => <article key={item.ref} className="word-card study-unit-card parallel-word"><div className="phrase-row"><div className="phrase-row-text">
        <h3 className="parallel-form" lang={language}><Form text={item.target} reading={item.reading} language={language} /></h3>
        <p className="word-meaning">{item.kind === 'word' ? glossOf(item) : item.english}</p></div>
        {item.kind === 'word' && <ParallelHear text={item.target} language={language} label={`Hear ${item.target}`} actions={{ meaning: glossOf(item), title: `${name} word`, route: 'practice' }} />}</div></article>)}</div>
    </Sheet>}
  </section>
}
