import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Eye, EyeOff, Headphones, Languages, MessageSquareText, PenLine, Repeat, RotateCcw, Trash2, Type, type LucideIcon } from 'lucide-react'
import { db } from '../../core/database'
import { navigate } from '../../core/routing'
import { itemCount } from '../../core/collections/terms'
import { TERM } from '../../core/collections/terms'
import { useCatalog } from '../../components/study/useCatalog'
import { UnitCard } from '../../components/study/UnitCard'
import { useAIConnection } from '../../components/study/useAIConnection'
import { EmptyState, PageHeading, type PageProps } from '../../components/shared'
import { cardId } from '../../core/study/contracts'
import { DOMAIN, groupProgress, nextGroup } from '../../core/study/knowledge'
import { MARK_LABEL, DRILLS_LABEL, DRILL_TYPES, countMarks, scoreOf, type DrillSet, type DrillTypeId } from '../../core/drills/contracts'
import { effectiveContent } from '../../core/drills/content'
import { loadItems, type ItemInfo } from '../../core/drills/items'
import { MAX_UNFINISHED_SETS, NEW_SET_SIZE, createDrillSet, discardDrillSet, finishDrillSet, retryContent, setFormat, unfinishedSets, type DrillSource } from '../../core/drills/store'
import { DrillRun } from './DrillRun'
import { availability } from './tasks'
import './drills.css'

const ICONS: Record<string, LucideIcon> = { Languages, PenLine, Type, MessageSquareText, Repeat, Headphones, BookOpen }
const setRoute = (id: string, page = '') => `drills/set/${id}${page ? `/${page}` : ''}`
const CURRICULUM = 'curriculum'

function useItems(set: DrillSet | undefined | null): ItemInfo[] | undefined {
  const { catalog } = useCatalog()
  const [items, setItems] = useState<ItemInfo[]>()
  const key = set?.refs.join(',')
  useEffect(() => {
    if (!set || !catalog) return
    let live = true
    void loadItems(set.refs, catalog).then(found => { if (live) setItems(found) })
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, catalog])
  return items
}

export function Drills(props: PageProps & { route: string }) {
  const [path] = props.route.split('?')
  const [, kind, id, page, type] = path.split('/')
  const set = useLiveQuery(async () => id ? (await db.drillSets.get(id)) ?? null : null, [id])
  if (kind !== 'set' || !id) return <DrillsHome {...props} />
  if (set === undefined) return <div className="opening-workspace" role="status">Opening the drill set...</div>
  if (set === null) return <EmptyState title="This drill set is not available"><p>It may have been discarded or removed from this workspace.</p><a className="button primary" href={`#${'drills'}`}>Back to {DRILLS_LABEL}</a></EmptyState>
  return <SetPage {...props} set={set} page={page} type={type as DrillTypeId | undefined} query={props.route.split('?')[1] ?? ''} />
}

function SetPage({ set, page, type, query, ...props }: PageProps & { set: DrillSet; page?: string; type?: DrillTypeId; query: string }) {
  const { catalog, error } = useCatalog()
  const items = useItems(set)
  if (error) return <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>
  if (!catalog || !items) return <div className="opening-workspace" role="status">Opening the drill set...</div>
  if (page === 'intro') return <Intro {...props} set={set} items={items} catalog={catalog} />
  if (page === 'run' && type && DRILL_TYPES.some(entry => entry.id === type)) {
    const only = new URLSearchParams(query).get('missed') ? Object.entries(set.progress[type]?.results ?? {}).filter(([, mark]) => mark === 'missed').map(([ref]) => ref) : undefined
    return <DrillRun key={`${type}:${only?.join() ?? ''}`} set={set} type={type} items={items} catalog={catalog} workspace={props.workspace} only={only} backHref={`#${setRoute(set.id)}`} />
  }
  if (page === 'summary' || set.status !== 'active') return <Summary {...props} set={set} items={items} />
  return <SetScreen {...props} set={set} items={items} />
}

/** New-item sets open on the lesson's intro cards; review and study-set sets keep their items out of sight until asked. */
function Intro({ set, items, catalog, workspace, now, run, busy }: PageProps & { set: DrillSet; items: ItemInfo[]; catalog: NonNullable<ReturnType<typeof useCatalog>['catalog']> }) {
  const [shown, setShown] = useState(false)
  const fresh = set.source === 'new'
  const start = <a className="button primary" href={`#${setRoute(set.id)}`}>Start drilling <ArrowRight size={16} /></a>
  const words = items.filter(item => item.kind === 'vocabulary').length
  const detail = `${itemCount(items.length)}: ${words} ${words === 1 ? 'word' : 'words'}, ${items.length - words} other`
  const examplesFor = (ref: string) => (catalog.orderedGroups.find(entry => entry.group.units.some(unit => unit.ref === ref))?.group.examples ?? [])
    .filter(example => example.segments.some(segment => `vocabulary:${segment.word}` === ref) || example.grammar.some(label => `grammar:${label}` === ref))
  return <div className="dr">
    <a className="back-link" href={`#${'drills'}`}><ArrowLeft size={16} /> {DRILLS_LABEL}</a>
    <PageHeading eyebrow={fresh ? 'New set' : set.source === 'review' ? 'Review set' : TERM.Singular} title={set.title} action={start}>{detail}. {fresh ? 'Read the intro cards first.' : 'Your items are hidden so the list gives no hints.'}</PageHeading>
    {fresh ? <>
      <h2 className="dr-h2">Intro cards <span className="small muted">1–{items.length} of {items.length}</span></h2>
      <div className="word-grid">{items.map(item => {
        const unit = catalog.units.get(item.ref)
        return unit ? <UnitCard key={item.ref} catalog={catalog} unit={unit} card={workspace.studyCards.find(card => card.id === cardId(item.ref, DOMAIN))} pinyin={workspace.preferences.pinyin} now={now}
          examples={examplesFor(item.ref)} run={run} busy={busy} route={setRoute(set.id, 'intro')} hideStatus />
          : <article key={item.ref} className="word-card"><div className="card-topline"><span className="eyebrow">{item.kind}</span></div><h3 lang="zh-Hans" className="word-native">{item.zh}</h3>
            {item.py && <p className="study-pinyin small muted">{item.py}</p>}<p className="word-meaning">{item.en}</p></article>
      })}</div>
      <div className="button-row dr-end">{start}</div>
    </> : <section className="panel dr-panel">
      <div className="dr-toolbar"><h2>Items</h2><button type="button" className="button secondary" aria-expanded={shown} onClick={() => setShown(!shown)}>{shown ? <><EyeOff size={16} /> Hide words</> : <><Eye size={16} /> Show words</>}</button></div>
      {shown ? <table className="dr-table"><thead><tr><th>Item</th><th>Pinyin</th><th>Meaning</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.ref}><td lang="zh-Hans" className="dr-zh">{item.zh}</td><td>{item.py || '–'}</td><td>{item.en}</td></tr>)}</tbody></table>
        : <div className="notice"><p><strong>{itemCount(items.length)} hidden.</strong> The list is kept out of sight so it does not give hints. Show it only if you want to look first.</p></div>}
    </section>}
  </div>
}

function SetScreen({ set, items, run, busy }: PageProps & { set: DrillSet; items: ItemInfo[] }) {
  const content = effectiveContent(set)
  const connection = useAIConnection()
  const quiz = set.format === 'quiz'
  const rows = DRILL_TYPES.map(entry => ({ entry, avail: availability(entry.id, items, content), progress: set.progress[entry.id] }))
  const done = rows.filter(row => row.progress?.done)
  const todo = rows.filter(row => !row.progress?.done)
  const finish = () => void run(async () => { await finishDrillSet(set.id); navigate(setRoute(set.id, 'summary')) })
  return <div className="dr">
    <a className="back-link" href="#drills"><ArrowLeft size={16} /> {DRILLS_LABEL}</a>
    <PageHeading eyebrow="Drill set" title={set.title} action={<button type="button" className="button secondary" disabled={busy} onClick={finish}>Finish set</button>}>{itemCount(set.refs.length)} · {done.length} of {DRILL_TYPES.length} types done</PageHeading>
    <div className="dr-toolbar dr-setbar">
      {set.source === 'new' && <a className="button secondary" href={`#${setRoute(set.id, 'intro')}`}><BookOpen size={16} /> Intro cards</a>}
      {set.source !== 'new' && <a className="button secondary" href={`#${setRoute(set.id, 'intro')}`}><Eye size={16} /> Items</a>}
      <div className="dr-format"><span className="eyebrow">Format for the next Start</span><div className="segmented" role="group" aria-label="Format">
        <button type="button" aria-pressed={!quiz} onClick={() => void run(async () => { await setFormat(set.id, 'single') })}>One at a time</button>
        <button type="button" aria-pressed={quiz} onClick={() => void run(async () => { await setFormat(set.id, 'quiz') })}>Quiz</button></div></div></div>
    {content.state === 'running' && <p className="small muted" role="status">Writing sentences and conversations with your AI model ({content.done ?? 0} of {content.total ?? 0} requests done). Types that need them say when they are ready.</p>}
    {content.state === 'no-ai' && connection === null && <p className="notice small" role="status">No AI model is connected, so only the types built from the catalog are available. <a className="text-link" href="#settings">Connect one in Settings</a>.</p>}
    <div className="dr-columns">
      <section className="panel dr-panel" aria-labelledby="dr-types"><h2 id="dr-types">Pick a drill type</h2><p className="small muted">Any order. Each type covers the items of the set it applies to.</p>
        <ul className="dr-rows">{todo.map(({ entry, avail, progress }) => { const Icon = ICONS[entry.icon]; const ready = avail.state === 'ready'
          return <li key={entry.id}><Icon size={20} aria-hidden="true" />
            <div><strong>{entry.name}</strong><span className="small muted">{ready ? `${entry.blurb} · ${avail.count} ${avail.count === 1 ? 'item' : 'items'}${progress ? ` · ${Object.keys(progress.results).length} of ${progress.scope.length} done` : ''}` : avail.message}</span>
              {avail.state === 'running' && <progress aria-label={`${entry.name} progress`} value={content.done ?? 0} max={Math.max(1, content.total ?? 1)} />}</div>
            {ready ? <a className="button primary" href={`#${setRoute(set.id, `run/${entry.id}`)}`}>{progress ? 'Continue' : quiz ? 'Quiz' : 'Start'}</a>
              : avail.state === 'failed' ? <button type="button" className="button secondary" disabled={busy} onClick={() => void run(async () => { void retryContent(set.id) })}><RotateCcw size={14} /> Try again</button>
                : <button type="button" className="button secondary" disabled>{avail.state === 'running' ? 'Writing…' : 'Not available'}</button>}</li> })}
          {todo.length === 0 && <li><p className="small muted">Every type is done. Finish the set to see your summary, or redo any type.</p></li>}</ul></section>
      <section className="panel dr-panel" aria-labelledby="dr-done"><h2 id="dr-done">Done</h2>
        {done.length === 0 && <p className="small muted">Finished types move here with their score and a Redo.</p>}
        <ul className="dr-rows">{done.map(({ entry, progress }) => { const counts = countMarks({ progress: { [entry.id]: progress! } }, [entry.id]); const score = scoreOf(counts)
          return <li key={entry.id}><CheckCircle2 size={20} className="accent" aria-hidden="true" />
            <div><strong>{entry.name}</strong><span className="small muted">{score.correct} of {score.total} correct · {counts.got} {MARK_LABEL.got.toLowerCase()}, {counts.hint} hint, {counts.missed} missed</span></div>
            <a className="button secondary" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Redo ${entry.name}`}>Redo</a></li> })}</ul></section>
    </div>
  </div>
}

function Summary({ set, items, run, busy }: PageProps & { set: DrillSet; items: ItemInfo[] }) {
  const counts = countMarks(set)
  const score = scoreOf(counts)
  const revisit = useMemo(() => {
    const worst = new Map<string, 'hint' | 'missed'>()
    for (const progress of Object.values(set.progress)) for (const [ref, mark] of Object.entries(progress.results)) if (mark !== 'got' && worst.get(ref) !== 'missed') worst.set(ref, mark)
    return items.filter(item => worst.has(item.ref)).map(item => ({ item, mark: worst.get(item.ref)! }))
  }, [set.progress, items])
  const missedType = DRILL_TYPES.find(entry => Object.values(set.progress[entry.id]?.results ?? {}).includes('missed'))
  const active = set.status === 'active'
  return <div className="dr">
    <a className="back-link" href={active ? `#${setRoute(set.id)}` : '#drills'}><ArrowLeft size={16} /> {active ? set.title : DRILLS_LABEL}</a>
    <PageHeading eyebrow={active ? 'Summary so far' : set.status === 'abandoned' ? 'Set ended early' : 'Set finished'} title={set.title}>{itemCount(set.refs.length)}. Practice results, not a measure of proficiency.</PageHeading>
    <section className="panel completion" aria-label="Score"><CheckCircle2 size={40} className="accent" aria-hidden="true" />
      <p className="completion-count">{score.total ? `${score.correct} / ${score.total}` : 'No answers yet'}</p><p>{score.total ? 'correct on the first pass (Got it and Needed a hint)' : 'Pick a drill type to start.'}</p>
      <p className="dr-stats"><span><strong>{counts.got}</strong>{MARK_LABEL.got}</span><span><strong>{counts.hint}</strong>{MARK_LABEL.hint}</span><span><strong>{counts.missed}</strong>{MARK_LABEL.missed}</span></p></section>
    <section className="panel dr-panel"><h2>By type</h2>
      <table className="dr-table"><thead><tr><th>Type</th><th>Score</th><th title="Got it · Needed a hint · Missed">Got · Hint · Missed</th><th /></tr></thead>
        <tbody>{DRILL_TYPES.map(entry => { const progress = set.progress[entry.id]; const c = countMarks({ progress: progress ? { [entry.id]: progress } : {} }, [entry.id]); const s = scoreOf(c)
          return <tr key={entry.id}><td>{entry.name}</td><td>{progress ? `${s.correct}/${s.total}${progress.done ? '' : ' (partial)'}` : '–'}</td><td>{progress ? `${c.got} · ${c.hint} · ${c.missed}` : '–'}</td>
            <td>{progress?.done ? <a className="button secondary" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Redo ${entry.name}`}>Redo</a> : null}</td></tr> })}</tbody></table></section>
    <section className="panel dr-panel"><h2>Items to revisit</h2>
      {revisit.length === 0 ? <p className="small muted">{score.total ? 'Nothing to revisit: every answer was Got it.' : 'Nothing yet.'}</p>
        : <ul className="dr-rows">{revisit.map(({ item, mark }) => <li key={item.ref}><div><strong lang="zh-Hans" className="dr-zh">{item.zh}</strong><span className="small muted">{item.py} {item.en}</span></div><span className={`tag dr-tag-${mark}`}>{MARK_LABEL[mark]}</span></li>)}</ul>}
      {missedType && <div className="button-row"><a className="button secondary" href={`#${setRoute(set.id, `run/${missedType.id}?missed=1`)}`}>Practise missed (ungraded)</a></div>}</section>
    <div className="button-row">{active && <button type="button" className="button primary" disabled={busy} onClick={() => void run(async () => { await finishDrillSet(set.id); navigate('drills') })}>Finish set</button>}
      <a className="button secondary" href="#drills">{DRILLS_LABEL} home</a></div>
  </div>
}

function DrillsHome({ workspace, now, run, busy }: PageProps) {
  const { catalog, error } = useCatalog()
  const connection = useAIConnection()
  const sets = useLiveQuery(() => db.drillSets.toArray(), []) ?? []
  const collections = useLiveQuery(() => db.collections.toArray(), []) ?? []
  const collectionItems = useLiveQuery(() => db.collectionItems.toArray(), []) ?? []
  const [from, setFrom] = useState(CURRICULUM)
  const [asking, setAsking] = useState<string>()
  const known = useMemo(() => new Set(workspace.knowledge.map(entry => entry.ref)), [workspace.knowledge])
  const wordsDue = workspace.words.filter(word => word.dueAt <= now).length
  const unfinished = unfinishedSets(sets)
  const next = catalog ? nextGroup(catalog, known) : undefined
  const progress = catalog ? groupProgress(catalog, known) : undefined
  const fromSet = from !== CURRICULUM ? collections.find(entry => entry.id === from) : undefined
  const fresh = fromSet ? collectionItems.filter(item => item.collectionId === fromSet.id && !known.has(item.ref)).length : next?.newUnits.length ?? 0
  const inFrom = fromSet ? new Set(collectionItems.filter(item => item.collectionId === fromSet.id).map(item => item.ref)) : undefined
  const due = workspace.studyCards.filter(card => card.domain === DOMAIN && card.due <= now && known.has(card.ref) && (!inFrom || inFrom.has(card.ref))).length
  const start = (source: DrillSource) => void run(async () => { navigate(setRoute(await createDrillSet(source), 'intro')) })
  const countsOf = (id: string) => collectionItems.filter(item => item.collectionId === id)
  return <div className="dr">
    <PageHeading eyebrow="Practice" title={DRILLS_LABEL}>Drill sets of words and grammar patterns. Pick a type, do every item, pick another.</PageHeading>
    {error && <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>}
    {connection === null && <p className="notice small" role="status">Sentence and conversation drills are written by your own AI model. <a className="text-link" href="#settings">Connect one in Settings</a>; the other types work without it.</p>}
    <div className="dr-columns">
      <section className="panel dr-panel" aria-labelledby="dr-start"><h2 id="dr-start">Start a set</h2>
        <div className="dr-from dr-from-top"><label className="dr-source"><span className="eyebrow accent">Learning from</span>
          <select value={from} aria-label="Learning from" onChange={event => setFrom(event.target.value)}><option value={CURRICULUM}>Curriculum</option>{collections.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label></div>
        <ul className="dr-rows">
          <li><div><strong>New words</strong><span className="small muted">{catalog ? fresh ? fromSet ? `Next ${Math.min(fresh, NEW_SET_SIZE)} of ${fresh} new ${fresh === 1 ? 'item' : 'items'} in ${fromSet.name}` : `Next ${Math.min(fresh, NEW_SET_SIZE)} curriculum items${progress ? ` · group ${Math.min(progress.completed + 1, progress.total)} of ${progress.total}` : ''}` : fromSet ? `Nothing new left in ${fromSet.name}` : 'Nothing new left here' : 'Loading the curriculum...'}</span></div>
            <button type="button" className="button primary" aria-label="Start new words" disabled={busy || !fresh} onClick={() => start({ kind: 'new', ...(fromSet ? { from: fromSet.id } : {}) })}>Start <ArrowRight size={16} /></button></li>
          <li><div><strong>Reviews</strong><span className="small muted">{due} {due === 1 ? 'item' : 'items'} due{fromSet ? ` in ${fromSet.name}` : ''} · titles hidden</span></div>
            <button type="button" className="button primary" aria-label="Start reviews" disabled={busy || !due} onClick={() => start({ kind: 'review', ...(fromSet ? { from: fromSet.id } : {}) })}>Start <ArrowRight size={16} /></button></li>
        </ul>
        <div className="dr-from">
          <p className="small muted">{TERM.Plural} can also be started whole:</p>
          {collections.length === 0 ? <p className="small muted">No {TERM.plural} yet. <a className="text-link" href="#collections">Create one</a>.</p>
            : <ul className="dr-rows">{collections.map(entry => { const own = countsOf(entry.id); const learned = own.filter(item => known.has(item.ref)).length
              return <li key={entry.id}><div><strong>{entry.name}</strong><span className="small muted">{itemCount(own.length)} · {learned} learned</span></div>
                <button type="button" className="button secondary" aria-label={`Start ${entry.name}`} disabled={busy || !own.length} onClick={() => start({ kind: 'study-set', collectionId: entry.id })}>Start</button></li> })}</ul>}</div>
      </section>
      <section className="panel dr-panel" aria-labelledby="dr-unfinished"><h2 id="dr-unfinished">Unfinished sets</h2>
        {unfinished.length === 0 ? <p className="muted small">No unfinished sets.</p> : <div className="resume-list">{unfinished.map(set => { const typesDone = Object.values(set.progress).filter(entry => entry.done).length
          return <div className="resume-row" key={set.id}>
            <a className="resume-main" href={`#${setRoute(set.id)}`}><div><strong>{set.title}</strong><span className="small muted">{itemCount(set.refs.length)} · {typesDone} of {DRILL_TYPES.length} types done</span></div><ArrowRight size={18} /></a>
            {asking === set.id
              ? <span className="dr-confirm"><button type="button" className="button secondary" disabled={busy} onClick={() => { setAsking(undefined); void run(() => discardDrillSet(set.id)) }}>Discard</button><button type="button" className="button secondary" onClick={() => setAsking(undefined)}>Keep</button></span>
              : <button type="button" className="icon-button" aria-label={`Discard ${set.title}`} onClick={() => setAsking(set.id)}><Trash2 size={17} /></button>}
          </div> })}</div>}
        {unfinished.length >= MAX_UNFINISHED_SETS && <p className="small muted">Up to {MAX_UNFINISHED_SETS} unfinished sets are kept; starting another sets the oldest untouched one aside.</p>}
      </section>
    </div>
    <section className="panel dr-classic"><div><strong>Classic practice</strong><span className="small muted">Word-recognition sessions, the due badge and Mahjong keep working as before.</span></div>
      <div className="button-row"><a className="button secondary" href="#practice">Classic practice {wordsDue > 0 && <span className="tag">{wordsDue} due</span>}</a><a className="button secondary" href="#practice/mahjong">Mahjong</a></div></section>
  </div>
}

export type { ReactNode }
