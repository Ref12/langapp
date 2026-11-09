import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { chineseRows } from '../../core/chinese-only'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Eye, EyeOff, GraduationCap, Headphones, Languages, ListChecks, MessageSquareText, PenLine, Play, Repeat, RefreshCw, RotateCcw, Shuffle, Trash2, Type, type LucideIcon } from 'lucide-react'
import { db } from '../../core/database'
import { navigate, useRoute } from '../../core/routing'
import { itemCount } from '../../core/collections/terms'
import { TERM } from '../../core/collections/terms'
import { useCatalog } from '../../components/study/useCatalog'
import { KnowledgeCounts } from '../../components/study/KnowledgeCounts'
import { UnitCard } from '../../components/study/UnitCard'
import { useAIConnection } from '../../components/study/useAIConnection'
import { EmptyState, PageHeading, type PageProps } from '../../components/shared'
import { cardId } from '../../core/study/contracts'
import { DOMAIN } from '../../core/study/knowledge'
import { NEW_COUNT_CHOICES, NEW_COUNT_MAX, clampCount, countItems, fillByItems, lessonCount, pickReviews, loadNewCount, loadReviewCount, saveNewCount, saveReviewCount } from '../../core/study/daily'
import { MARK_LABEL, DRILLS_LABEL, DRILL_TYPES, countMarks, scoreOf, type DrillSet, type DrillTypeId, type TypeProgress } from '../../core/drills/contracts'
import { effectiveContent } from '../../core/drills/content'
import { loadItems, type ItemInfo } from '../../core/drills/items'
import { describeItems } from '../../core/drills/write-queue'
import { UNWRITTEN_CHOICES, countUnwritten, loadBacklogWords, loadUnwrittenSize, pickUnwritten, saveUnwrittenSize } from '../../core/drills/unwritten'
import { startContent } from '../../core/drills/content'
import { MAX_UNFINISHED_SETS, shortDate, createDrillSet, discardDrillSet, finishDrillSet, newHandsfreeActivity, ensureHandsfree, restartHandsfree, activityOf, handsfreeRoute, type HandsfreeKind, restartDrillType, handsfreeStopped, retryContent, setFormat, unfinishedSets, type DrillSource } from '../../core/drills/store'
import { DrillRun } from './DrillRun'
import { EngineRun, EngineStart } from './EngineSet'
import { IntroCards } from './IntroCards'
import { Sheet } from './Sheet'
import { removeHistoryItems, restoreHistoryItems } from '../../core/history-removal'
import { RowMenu } from '../../components/RowMenu'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SaveToMenu } from '../../components/collections/SaveToMenu'
import { RemoveFromKnowledge } from '../../components/study/RemoveFromKnowledge'
import { isPhraseRef, isSourceRef } from '../../core/study/contracts'
import { loadHandsfreeSettings } from '../../core/handsfree/store'
import { HandsFree } from './HandsFree'
import { runAddedRefs } from '../../core/study/knowledge'
import { availability } from './tasks'
import { SKILLS, SKILL_LABEL, SKILL_SIZES, STRATEGY_LABEL, PICK_STRATEGIES, drillSkills, type Skill } from '../../core/study/skill-map'
import { ACTIVITY_SKILLS } from '../../core/study/skill-map'
import { recordSetIntro } from '../../core/study/skills'
import './drills.css'

const ICONS: Record<string, LucideIcon> = { Languages, Shuffle, GraduationCap, PenLine, Type, MessageSquareText, Repeat, Headphones, BookOpen }
const setRoute = (id: string, page = '') => `practice/set/${id}${page ? `/${page}` : ''}`
/** Completed sets listed on Practice home. */
const RECENT_SETS = 10
const CURRICULUM = 'curriculum'
const ORIGIN = 'origin'

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
  if (set === undefined) return <div className="opening-workspace" role="status">Opening the practice set...</div>
  if (set === null) return <EmptyState title="This practice set is not available"><p>It may have been discarded or removed from this workspace.</p><a className="button primary" href={`#practice`}>Back to {DRILLS_LABEL}</a></EmptyState>
  return <SetPage {...props} set={set} page={page} type={type as DrillTypeId | undefined} query={props.route.split('?')[1] ?? ''} />
}

function SetPage({ set, page, type, query, ...props }: PageProps & { set: DrillSet; page?: string; type?: DrillTypeId; query: string }) {
  const { catalog, error } = useCatalog()
  const items = useItems(set)
  if (error) return <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>
  if (!catalog || !items) return <div className="opening-workspace" role="status">Opening the practice set...</div>
  if (page === 'intro') return <Intro {...props} set={set} items={items} catalog={catalog} />
  if (page === 'run' && type && DRILL_TYPES.some(entry => entry.id === type)) {
    const only = new URLSearchParams(query).get('missed') ? Object.entries(set.progress[type]?.results ?? {}).filter(([, mark]) => mark === 'missed').map(([ref]) => ref) : undefined
    return <DrillRun key={`${type}:${only?.join() ?? ''}`} set={set} type={type} items={items} catalog={catalog} workspace={props.workspace} now={props.now} run={props.run} busy={props.busy} only={only} backHref={`#${setRoute(set.id)}`} />
  }
  // A set made for the engine opens on its Start screen. A set from before has no engine state (or has old-style progress) and keeps the classic view until it is finished.
  const engineSet = !!set.engine && set.status !== 'abandoned'
  if (page === 'engine' && set.engine) return <EngineRun {...props} set={set} items={items} catalog={catalog} />
  if (engineSet && !page) return <EngineStart {...props} set={set} items={items} catalog={catalog} />
  if (page === 'handsfree') return <HandsFree {...props} set={set} kind="introduction" />
  if (page === 'recall') return <HandsFree {...props} set={set} kind="recall" />
  if (page === 'summary' || set.status === 'abandoned') return <Summary {...props} set={set} items={items} />
  return <SetScreen {...props} set={set} items={items} />
}

/** New-item and lesson sets show their items as intro cards at once (and record the introduction). Review and study-set sets list the headwords as tiles; a tap reveals that item's card, and one toggle reveals all. Nothing is remembered between visits. */
function Intro({ set, items, catalog, workspace, now, run, busy }: PageProps & { set: DrillSet; items: ItemInfo[]; catalog: NonNullable<ReturnType<typeof useCatalog>['catalog']> }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const fresh = set.source === 'new' || set.source === 'lesson'
  useEffect(() => { if (fresh) void recordSetIntro(set.id, set.refs, ACTIVITY_SKILLS.introCard).catch(() => undefined) }, [fresh, set.id, set.refs])
  const start = <a className="button primary" href={`#${setRoute(set.id)}`}>Start practicing <ArrowRight size={16} /></a>
  const detail = describeItems(items, workspace.characterStates) || itemCount(items.length)
  const examplesFor = (ref: string) => (catalog.orderedGroups.find(entry => entry.group.units.some(unit => unit.ref === ref))?.group.examples ?? [])
    .filter(example => example.segments.some(segment => `vocabulary:${segment.word}` === ref) || example.grammar.some(label => `grammar:${label}` === ref))
  const card = (item: ItemInfo) => {
    const unit = catalog.units.get(item.ref)
    return unit ? <UnitCard key={item.ref} catalog={catalog} unit={unit} card={workspace.studyCards.find(entry => entry.id === cardId(item.ref, DOMAIN))} pinyin={workspace.preferences.pinyin} now={now}
      examples={examplesFor(item.ref)} run={run} busy={busy} route={setRoute(set.id, 'intro')} hideStatus />
      : <article key={item.ref} className="word-card"><div className="card-topline"><span className="eyebrow">{item.kind}</span></div><h3 lang="zh-Hans" className="word-native">{item.zh}</h3>
        {item.py && <p className="study-pinyin small muted">{item.py}</p>}<p className="word-meaning">{item.en}</p></article>
  }
  const count = `${items.length} ${items.length === 1 ? 'item' : 'items'}`
  const allOpen = items.length > 0 && items.every(item => open.has(item.ref))
  const toggle = (ref: string) => setOpen(previous => { const next = new Set(previous); if (!next.delete(ref)) next.add(ref); return next })
  return <div className="dr">
    <a className="back-link" href={`#${setRoute(set.id)}`}><ArrowLeft size={16} /> {set.title}</a>
    <PageHeading eyebrow={fresh ? 'New set' : set.source === 'review' ? 'Review set' : TERM.Singular} title={set.title} action={start}>{detail}. {fresh ? 'Read the intro cards first.' : 'Tap an item to see its meaning.'}</PageHeading>
    {fresh ? <>
      <h2 className="dr-h2">{count}</h2>
      <div className="word-grid">{items.map(card)}</div>
      <div className="button-row dr-end">{start}</div>
    </> : <section className="panel dr-panel">
      <div className="dr-toolbar"><h2 className="dr-h2">{count}. Tap one to see its meaning.</h2>
        <button type="button" className="button secondary" onClick={() => setOpen(allOpen ? new Set() : new Set(items.map(item => item.ref)))}>{allOpen ? <><EyeOff size={16} /> Hide meanings</> : <><Eye size={16} /> Show all meanings</>}</button></div>
      <ul className="dr-tiles">{items.map(item => <li key={item.ref} className={open.has(item.ref) ? 'open' : undefined}>
        <button type="button" className="dr-tile" aria-expanded={open.has(item.ref)} onClick={() => toggle(item.ref)}>
          <span lang="zh-Hans" className="dr-tile-zh">{item.zh}</span><span className="dr-tile-kind">{item.kind}</span></button>
        {open.has(item.ref) && <div className="dr-tile-card">{card(item)}</div>}</li>)}</ul>
      <div className="button-row dr-end">{start}</div>
    </section>}
  </div>
}

/** A failed generation reads as failed: short and plain, the transport text stays in the tooltip. */
const failedLine = (error?: string) => `Couldn't prepare these questions (${error && /unable to reach|timed out/i.test(error) ? 'AI service unreachable' : 'the AI request failed'}).`

/** Retries a failed generation once per page open, when it opens or the app comes back online or regains focus. */
function useQuietRetry(setId: string, failed: boolean) {
  const tried = useRef(false)
  useEffect(() => { tried.current = false }, [setId])
  useEffect(() => {
    if (!failed) return
    const retry = () => { if (tried.current || document.visibilityState === 'hidden' || navigator.onLine === false) return; tried.current = true; void retryContent(setId) }
    retry()
    window.addEventListener('online', retry); window.addEventListener('focus', retry); document.addEventListener('visibilitychange', retry)
    return () => { window.removeEventListener('online', retry); window.removeEventListener('focus', retry); document.removeEventListener('visibilitychange', retry) }
  }, [setId, failed])
}

const TYPE_COUNT = DRILL_TYPES.length + 2
/** The two Hands-free practice types of a set. */
const HANDSFREE_TYPES: { kind: HandsfreeKind; name: string; blurb: string }[] = [
  { kind: 'introduction', name: 'Hands-free introduction', blurb: 'A hands-free lesson: each word and its phrase introduced, then recalled' },
  { kind: 'recall', name: 'Hands-free recall', blurb: 'Scrambled recall of words and phrases, both directions' },
]
/** Types done, Hands-free included. */
const typesDoneOf = (set: DrillSet) => Object.values(set.progress).filter(entry => entry.done).length + (set.handsfree?.done ? 1 : 0) + (set.handsfreeRecall?.done ? 1 : 0)

function SetScreen({ set, items, run, busy, workspace }: PageProps & { set: DrillSet; items: ItemInfo[] }) {
  const content = effectiveContent(set)
  const connection = useAIConnection()
  const quiz = set.format === 'quiz'
  useQuietRetry(set.id, content.state === 'failed' && connection !== null)
  const rows = DRILL_TYPES.map(entry => ({ entry, avail: availability(entry.id, items, content), progress: set.progress[entry.id] }))
  // A Practice by skill set lists the types for its skill first.
  if (set.emphasis) rows.sort((a, b) => Number(drillSkills(b.entry.id).includes(set.emphasis!)) - Number(drillSkills(a.entry.id).includes(set.emphasis!)))
  const finished = set.status === 'completed'
  // A set made by the Hands-free shortcut starts without its sentences; opening its page writes them, so every practice type is there like for any other set.
  useEffect(() => { if (set.shortcut && set.content.state === 'pending') void startContent(set.id) }, [set.id, set.shortcut, set.content.state])
  const openHf = (again: boolean, kind: HandsfreeKind) => void run(async () => { if (again) await restartHandsfree(set.id, kind); else await ensureHandsfree(set.id, loadHandsfreeSettings(), kind); navigate(setRoute(set.id, handsfreeRoute(kind))) })
  const hfCount = itemCount(set.refs.length)
  const [restarting, setRestarting] = useState<{ type: DrillTypeId; name: string; answers: number }>()
  const answersOf = (progress: TypeProgress | undefined) => Object.keys(progress?.results ?? {}).length
  /** Restart of a started type: asks first when it has answers; a done type opens again without asking. */
  const restartType = (entry: { id: DrillTypeId; name: string }, progress: TypeProgress | undefined) => {
    const answers = answersOf(progress)
    if (progress && !progress.done && answers > 0) setRestarting({ type: entry.id, name: entry.name, answers })
    else void run(async () => { if (progress && !progress.done) await restartDrillType(set.id, entry.id); navigate(setRoute(set.id, `run/${entry.id}`)) })
  }
  const finish = () => void run(async () => { await finishDrillSet(set.id); navigate(setRoute(set.id, 'summary')) })
  const doneBadge = (icon: ReactNode) => <span className="dr-icon">{icon}<CheckCircle2 size={14} className="dr-check" aria-hidden="true" /></span>
  type Entry = { rank: number; node: ReactNode }
  const entries: Entry[] = [
    ...HANDSFREE_TYPES.map((entry): Entry => { const hf = activityOf(set, entry.kind); const stopped = !!hf?.started && !hf.done
      if (hf?.done) return { rank: 2, node: <li key={entry.kind} className="dr-done">{doneBadge(<Headphones size={20} aria-hidden="true" />)}
        <div><strong>{entry.name}</strong><span className="small muted"><span className="dr-sr">Done. </span>Played to the end</span></div>
        <span className="dr-actions"><button type="button" className="icon-button" disabled={busy} aria-label={`Redo ${entry.name}, done`} title="Redo" onClick={() => openHf(true, entry.kind)}><RotateCcw size={18} /></button></span></li> }
      return { rank: stopped ? 0 : 1, node: <li key={entry.kind}><Headphones size={20} aria-hidden="true" />
        <div><strong>{entry.name}</strong><span className="small muted">{entry.blurb} · {hfCount}{stopped ? ` · stopped at prompt ${hf!.position + 1}` : ''}</span></div>
        <span className="dr-actions">{stopped
          ? <><button type="button" className="icon-button" disabled={busy} aria-label={`Continue ${entry.name} at prompt ${hf!.position + 1}`} title={`Continue at prompt ${hf!.position + 1}`} onClick={() => openHf(false, entry.kind)}><ArrowRight size={18} /></button>
            <button type="button" className="icon-button" disabled={busy} aria-label={`Restart ${entry.name}`} title="Restart" onClick={() => openHf(true, entry.kind)}><RotateCcw size={18} /></button></>
          : <button type="button" className="icon-button" disabled={busy} aria-label={`Start ${entry.name}`} title="Start" onClick={() => openHf(false, entry.kind)}><Play size={18} /></button>}</span></li> } }),
    ...rows.map(({ entry, avail, progress }): Entry => { const Icon = ICONS[entry.icon]; const ready = avail.state === 'ready'
      if (progress?.done) { const counts = countMarks({ progress: { [entry.id]: progress } }, [entry.id]); const score = scoreOf(counts)
        return { rank: 2, node: <li key={entry.id} className="dr-done">{doneBadge(<Icon size={20} aria-hidden="true" />)}
          <div><strong>{entry.name}</strong><span className="small muted"><span className="dr-sr">Done. </span>{score.correct} of {score.total} correct · {counts.got} {MARK_LABEL.got.toLowerCase()}, {counts.hint} hint, {counts.missed} missed</span></div>
          <span className="dr-actions"><a className="icon-button" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Redo ${entry.name}, done`} title="Redo"><RotateCcw size={18} /></a></span></li> } }
      return { rank: progress ? 0 : 1, node: <li key={entry.id}><Icon size={20} aria-hidden="true" />
        <div><strong>{entry.name}</strong><span className="small muted">{avail.state === 'failed' ? <span title={content.error}>{failedLine(content.error)}</span> : ready ? `${entry.blurb} · ${avail.count} ${avail.count === 1 ? 'item' : 'items'}${progress ? ` · ${Object.keys(progress.results).length} of ${progress.scope.length} done` : ''}` : avail.message}</span>
          {avail.state === 'running' && <progress aria-label={`${entry.name} progress`} value={content.done ?? 0} max={Math.max(1, content.total ?? 1)} />}</div>
        <span className="dr-actions">{ready ? (progress
            ? <><a className="icon-button" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Continue ${entry.name}`} title="Continue"><ArrowRight size={18} /></a>
              <button type="button" className="icon-button" disabled={busy} aria-label={`Restart ${entry.name}`} title="Restart" onClick={() => restartType(entry, progress)}><RotateCcw size={18} /></button></>
            : <a className="icon-button" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Start ${entry.name}${quiz ? ' as a quiz' : ''}`} title={quiz ? 'Start as a quiz' : 'Start'}><Play size={18} /></a>)
          : avail.state === 'failed' ? <button type="button" className="button small dr-retry" disabled={busy} aria-label={`Try again ${entry.name}`} title="Try again" onClick={() => void run(async () => { void retryContent(set.id) })}><RefreshCw size={16} /> Try again</button>
            : <button type="button" className="icon-button" disabled aria-label={`${entry.name} ${avail.state === 'running' ? 'is being written' : 'is not available'}`} title={avail.state === 'running' ? 'Writing…' : 'Not available'}><Play size={18} /></button>}</span></li> } }),
  ].sort((x, y) => x.rank - y.rank)
  const todoCount = entries.filter(item => item.rank < 2).length
  return <div className="dr">
    <a className="back-link" href="#practice"><ArrowLeft size={16} /> {DRILLS_LABEL}</a>
    <PageHeading eyebrow={finished ? 'Finished' : 'Practice set'} title={set.title} action={finished ? <a className="button secondary" href={`#${setRoute(set.id, 'summary')}`}>Summary</a> : <button type="button" className="button secondary" disabled={busy} onClick={finish}>Finish set</button>}>{describeItems(items, workspace.characterStates) || itemCount(set.refs.length)} · {typesDoneOf(set)} of {TYPE_COUNT} types done</PageHeading>
    <div className="dr-toolbar dr-setbar">
      {(set.source === 'new' || set.source === 'lesson') && <a className="button secondary" href={`#${setRoute(set.id, 'intro')}`}><BookOpen size={16} /> Intro cards</a>}
      {set.source !== 'new' && set.source !== 'lesson' && <a className="button secondary" href={`#${setRoute(set.id, 'intro')}`}><Eye size={16} /> Items</a>}
      <div className="dr-format"><span className="eyebrow">Format for the next Start</span><div className="segmented" role="group" aria-label="Format">
        <button type="button" aria-pressed={!quiz} onClick={() => void run(async () => { await setFormat(set.id, 'single') })}>One at a time</button>
        <button type="button" aria-pressed={quiz} onClick={() => void run(async () => { await setFormat(set.id, 'quiz') })}>Quiz</button></div></div></div>
    {content.state === 'running' && <p className="small muted" role="status">Writing sentences and conversations with your AI model ({content.done ?? 0} of {content.total ?? 0} requests done). Types that need them say when they are ready.</p>}
    {content.state === 'no-ai' && connection === null && <p className="notice small" role="status">No AI model is connected, so only the types built from the catalog are available. <a className="text-link" href="#settings">Connect one in Settings</a>.</p>}
    <section className="panel dr-panel" aria-labelledby="dr-types"><h2 id="dr-types">Pick a practice type</h2><p className="small muted">{set.emphasis ? `${SKILL_LABEL[set.emphasis]} types first. ` : ''}In progress first, then not started, then done. Each type covers the items of the set it applies to.</p>
      <ul className="dr-rows">{entries.map(item => item.node)}
        {todoCount === 0 && <li><p className="small muted">Every type is done. Finish the set to see your summary, or redo any type.</p></li>}</ul></section>
    {restarting && <ConfirmDialog title={`Restart ${restarting.name}?`} confirmLabel="Restart" busy={busy} onCancel={() => setRestarting(undefined)}
      detail={<>Your {restarting.answers} {restarting.answers === 1 ? 'answer' : 'answers'} so far stay in your history.</>}
      onConfirm={() => { const item = restarting; setRestarting(undefined); void run(async () => { await restartDrillType(set.id, item.type); navigate(setRoute(set.id, `run/${item.type}`)) }) }} />}
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
    <a className="back-link" href={active ? `#${setRoute(set.id)}` : '#practice'}><ArrowLeft size={16} /> {active ? set.title : DRILLS_LABEL}</a>
    <PageHeading eyebrow={active ? 'Summary so far' : set.status === 'abandoned' ? 'Set ended early' : 'Set finished'} title={set.title}>{itemCount(set.refs.length)}. Practice results, not a measure of proficiency.</PageHeading>
    <section className="panel completion" aria-label="Score"><CheckCircle2 size={40} className="accent" aria-hidden="true" />
      <p className="completion-count">{score.total ? `${score.correct} / ${score.total}` : 'No answers yet'}</p><p>{score.total ? 'correct on the first pass (Got it and Needed a hint)' : 'Pick a practice type to start.'}</p>
      <p className="dr-stats"><span><strong>{counts.got}</strong>{MARK_LABEL.got}</span><span><strong>{counts.hint}</strong>{MARK_LABEL.hint}</span><span><strong>{counts.missed}</strong>{MARK_LABEL.missed}</span></p></section>
    <section className="panel dr-panel"><h2>By type</h2>
      <table className="dr-table"><thead><tr><th>Type</th><th>Score</th><th title="Got it · Needed a hint · Missed">Got · Hint · Missed</th><th className="dr-action-cell" /></tr></thead>
        <tbody>{DRILL_TYPES.map(entry => { const progress = set.progress[entry.id]; const c = countMarks({ progress: progress ? { [entry.id]: progress } : {} }, [entry.id]); const s = scoreOf(c)
          return <tr key={entry.id}><td>{entry.name}</td><td>{progress ? `${s.correct}/${s.total}${progress.done ? '' : ' (partial)'}` : '–'}</td><td>{progress ? `${c.got} · ${c.hint} · ${c.missed}` : '–'}</td>
            <td className="dr-action-cell">{progress?.done ? <a className="button secondary" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Redo ${entry.name}`}>Redo</a> : null}</td></tr> })}</tbody></table></section>
    <section className="panel dr-panel"><h2>Items to revisit</h2>
      {revisit.length === 0 ? <p className="small muted">{score.total ? 'Nothing to revisit: every answer was Got it.' : 'Nothing yet.'}</p>
        : <ul className="dr-rows">{revisit.map(({ item, mark }) => <li key={item.ref}><div><strong lang="zh-Hans" className="dr-zh">{item.zh}</strong><span className="small muted">{item.py} {item.en}</span></div><span className={`tag dr-tag-${mark}`}>{MARK_LABEL[mark]}</span></li>)}</ul>}
      {missedType && <div className="button-row"><a className="button secondary" href={`#${setRoute(set.id, `run/${missedType.id}?missed=1`)}`}>Practise missed (ungraded)</a></div>}</section>
    <div className="button-row">{active && <button type="button" className="button primary" disabled={busy} onClick={() => void run(async () => { await finishDrillSet(set.id); navigate('practice') })}>Finish set</button>}
      <a className="button secondary" href="#practice">{DRILLS_LABEL} home</a></div>
  </div>
}

/** What the set is about, never which practice type: its items, the types done and the date. */
function SetMeta({ set, typesDone, characterStates }: { set: DrillSet; typesDone: number; characterStates: PageProps['workspace']['characterStates'] }) {
  const leftOff = continueOf(set)?.type
  const items = useItems(set)
  const what = (items && describeItems(items, characterStates)) || itemCount(set.refs.length)
  return <span className="small muted dr-wrap">{what} · {typesDone} of {TYPE_COUNT} types done{leftOff && <> · left off in {leftOff}</>} · {shortDate(set.completedAt ?? set.updatedAt)}</span>
}

/** Where Continue goes for an unfinished set: the Hands-free activity or practice type last left part-way, if any. */
export function continueOf(set: DrillSet): { route: string; label: string; type: string } | undefined {
  if (set.status !== 'active') return undefined
  for (const entry of HANDSFREE_TYPES) if (handsfreeStopped(set, entry.kind)) return { route: `practice/set/${set.id}/${handsfreeRoute(entry.kind)}`, label: `Continue ${entry.name} at prompt ${activityOf(set, entry.kind)!.position + 1}`, type: entry.name }
  const type = DRILL_TYPES.find(entry => set.progress[entry.id] && !set.progress[entry.id]!.done)
  return type ? { route: setRoute(set.id, `run/${type.id}`), label: `Continue ${type.name}`, type: type.name } : undefined
}

/** Where an engine set stands, in words: "Practice session · finished, 6/20" or "Practice session · in progress, 14 of 26". */
export function engineStanding(set: DrillSet): string | undefined {
  const engine = set.engine
  if (!engine) return undefined
  if (engine.answers?.length && engine.planned && (engine.done ?? 0) < engine.planned) return `Practice session · in progress, ${engine.done ?? 0} of ${engine.planned}`
  if (engine.lastRun) return `Practice session · finished, ${engine.lastRun.correct}/${engine.lastRun.total}`
  return set.status === 'completed' ? 'Practice session · finished' : 'Practice session · not started'
}

/** One session (a drill set), unfinished, finished or set aside, in the Recent sessions list: title (In progress when unfinished) and the meta line on top (with "left off in <type>" when a type is part-way); below it a right-aligned row of icon-only buttons, like History's (history-actions, icon-button), each with a full aria-label and tooltip: Continue <type> (only when something is part-way; primary, arrow), Open session (the set page with its practice types; primary when there is no Continue), View items (the items page), Save to, and the ⋯ menu, which every row has: Discard (unfinished), Remove from knowledge set (when the session added items) and Remove from Recent sessions (a soft remove with Undo, like History's). */
function SetRow({ set, characterStates, onAsk, onRemove }: { set: DrillSet; characterStates: PageProps['workspace']['characterStates']; onAsk: () => void; onRemove: () => void }) {
  const unfinished = set.status === 'active'
  const removable = useLiveQuery(() => runAddedRefs('drill', set.id), [set.id, set.addedRefs])
  const typesDone = typesDoneOf(set)
  const resumeEngine = !!set.engine && !!set.engine.answers?.length && !!set.engine.planned && (set.engine.done ?? 0) < set.engine.planned
  const next = set.engine ? (resumeEngine ? { route: setRoute(set.id), label: `Resume ${set.title}`, type: 'Practice session' } : undefined) : continueOf(set)
  const openLabel = `Open session ${set.title}`
  return <div className="resume-row">
    <div className="resume-text"><strong>{set.title}{unfinished && <span className="tag in-progress">In progress</span>}</strong>
      {set.engine ? <span className="small muted dr-wrap">{engineStanding(set)} · {shortDate(set.completedAt ?? set.updatedAt)}</span> : <SetMeta set={set} typesDone={typesDone} characterStates={characterStates} />}</div>
  <div className="resume-actions history-actions">
    {next && <a className="icon-button primary-icon" href={`#${next.route}`} aria-label={next.label} title={next.label}><ArrowRight size={18} /></a>}
    <a className={`icon-button${next ? '' : ' primary-icon'}`} href={`#${setRoute(set.id)}`} aria-label={openLabel} title={openLabel}><ListChecks size={18} /></a>
    <a className="icon-button" href={`#${setRoute(set.id, 'intro')}`} aria-label={`View items in ${set.title}`} title="View items"><Eye size={18} /></a>
      <SaveToMenu refs={[...new Set(set.refs)]} name={set.title} />
    <RowMenu name={set.title}>
      {unfinished && <button type="button" role="menuitem" className="menu-item" title="Hides it from Recent sessions and History and stops any AI writing still running. What you learned stays." aria-label={`Discard ${set.title}`} aria-haspopup="dialog" onClick={onAsk}><Trash2 size={15} /> Discard</button>}
      {!!removable?.length && <RemoveFromKnowledge kind="drill" id={set.id} name={set.title} menuItem />}
      {!unfinished && <button type="button" role="menuitem" className="menu-item" title="Removes it from Recent sessions and History only. What you learned stays." aria-label={`Remove ${set.title} from Recent sessions`} onClick={onRemove}><EyeOff size={15} /> Remove from Recent sessions</button>}
    </RowMenu>
  </div>
  </div>
}

function DrillsHome({ workspace, now, run, busy }: PageProps) {
  const { catalog, error } = useCatalog()
  const connection = useAIConnection()
  const sets = useLiveQuery(() => db.drillSets.toArray(), []) ?? []
  const collections = useLiveQuery(() => db.collections.toArray(), []) ?? []
  const collectionItems = useLiveQuery(async () => chineseRows(await db.collectionItems.toArray()), []) ?? []
  const [from, setFrom] = useState(CURRICULUM)
  const originParam = new URLSearchParams(useRoute().split('?').slice(1).join('?')).get('from') ?? ''
  /** The items of a past lesson, practice set or Hands-free run named in the hash (undefined while loading, null when there is none). */
  const origin = useLiveQuery(async (): Promise<{ label: string; refs: string[] } | null> => {
    const at = originParam.indexOf(':'); const kind = originParam.slice(0, at), id = originParam.slice(at + 1)
    if (at < 0 || !id) return null
    if (kind === 'lesson') { const item = await db.exerciseSessions.get(id); return item ? { label: `Lesson · ${shortDate(item.completedAt ?? item.createdAt)}`, refs: [...new Set([...item.targetRefs, ...item.reviewRefs])] } : null }
    if (kind === 'drill' || kind === 'handsfree') { const item = await db.drillSets.get(id); return item ? { label: `Practice session · ${shortDate(item.createdAt)}`, refs: [...new Set(item.refs)] } : null }
    return null
  }, [originParam]) ?? null
  const [all, setAll] = useState(true)
  useEffect(() => setAll(true), [originParam])
  const [asking, setAsking] = useState<{ id: string; title: string }>()
  const [undo, setUndo] = useState<{ id: string; title: string }>()
  useEffect(() => { if (!undo) return; const timer = setTimeout(() => setUndo(undefined), 10000); return () => clearTimeout(timer) }, [undo])
  const removeSession = async (set: DrillSet) => { await removeHistoryItems([`drill:${set.id}`]); setUndo({ id: set.id, title: set.title }) }
  const unfinished = unfinishedSets(sets)
  const known = useMemo(() => new Set(workspace.knowledge.map(entry => entry.ref)), [workspace.knowledge])
  const wordsDue = workspace.words.filter(word => word.dueAt <= now).length
  // One list: every unfinished set, then the finished ones, by last activity; the last RECENT_SETS finished ones are kept.
  const touched = (set: DrillSet) => set.updatedAt
  const finished = sets.filter(set => set.status === 'completed' && !set.removedAt).sort((a, b) => touched(b) - touched(a)).slice(0, RECENT_SETS)
  const recent = [...unfinished, ...finished].sort((a, b) => touched(b) - touched(a))
  const fromSet = !origin && from !== CURRICULUM ? collections.find(entry => entry.id === from) : undefined
  const [chosenMode, setMode] = useState<'new' | 'review'>('new')
  const mode = origin ? 'review' : chosenMode
  const [counts, setCounts] = useState({ new: loadNewCount(), review: loadReviewCount() })
  const [typed, setTyped] = useState(String(counts.new))
  const [viewing, setViewing] = useState(false)
  const count = counts[mode]
  const setCount = (value: number) => { setAll(false); const next = clampCount(value); setCounts(before => ({ ...before, [mode]: next })); setTyped(String(next)); if (mode === 'new') saveNewCount(next); else saveReviewCount(next) }
  const pickMode = (next: 'new' | 'review') => { setMode(next); setTyped(String(counts[next])) }
  const inFrom = fromSet ? new Set(collectionItems.filter(item => item.collectionId === fromSet.id).map(item => item.ref)) : undefined
  // Reviews: the due items, then the ones coming up next to fill the count.
  const reviews = useMemo(() => pickReviews(workspace.studyCards.filter(card => card.domain === DOMAIN && known.has(card.ref) && (!inFrom || inFrom.has(card.ref)) && (!catalog || catalog.units.has(card.ref) || isSourceRef(card.ref) || isPhraseRef(card.ref))), now, counts.review),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [workspace.studyCards, now, known, catalog, from, collectionItems, counts.review])
  const freshFromSet = fromSet ? collectionItems.filter(item => item.collectionId === fromSet.id && !known.has(item.ref)).sort((a, b) => a.addedAt - b.addedAt).map(item => item.ref) : []
  /** The one selection: View items shows it and Start creates exactly it. */
  const selection = useMemo(() => origin ? (all ? origin.refs : origin.refs.slice(0, count)) : !catalog ? [] : mode === 'review' ? reviews.refs : fromSet ? freshFromSet.slice(0, count) : fillByItems(catalog, known, count),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [catalog, mode, count, reviews, from, known, collectionItems, origin, all])
  const selectionUnits = selection.flatMap(ref => { const unit = catalog?.units.get(ref); return unit ? [unit] : [] })
  const selectionCounts = countItems(selection.map(ref => ({ kind: ref.startsWith('grammar:') ? 'grammar' as const : 'vocabulary' as const })))
  const newCharacters = catalog ? describeItems(selectionUnits.map(unit => ({ kind: unit.kind, zh: unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt })), workspace.characterStates).match(/\d+ new characters?/)?.[0] : undefined
  const lessons = catalog && !origin && !fromSet && mode === 'new' ? lessonCount(catalog, selection) : 0
  const itemsNoun = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`
  const summary = origin ? `${selection.length} of ${itemsNoun(origin.refs.length)} from ${origin.label}` : !catalog ? 'Loading the curriculum...'
    : mode === 'review' ? (!selection.length ? 'Nothing is due for review right now' : [reviews.dueTotal ? `${reviews.due} of ${reviews.dueTotal} due` : 'Nothing due', reviews.upcoming ? `${reviews.upcoming} coming up next` : ''].filter(Boolean).join(' · '))
    : !selection.length ? (fromSet ? `Nothing new left in ${fromSet.name}` : 'Nothing new left here')
    : [itemsNoun(selection.length), `${selectionCounts.words} ${selectionCounts.words === 1 ? 'word' : 'words'}, ${selectionCounts.grammar} grammar`, lessons ? `${lessons} ${lessons === 1 ? 'lesson' : 'lessons'}` : '', newCharacters ?? ''].filter(Boolean).join(' · ')
  const nothing = !selection.length
  const [skill, setSkill] = useState<Skill>('reading')
  const [size, setSize] = useState<number>(10)
  const [strategy, setStrategy] = useState<typeof PICK_STRATEGIES[number]>('least')
  const [unwrittenSize, setUnwrittenSize] = useState(loadUnwrittenSize)
  const [backlog, setBacklog] = useState<Awaited<ReturnType<typeof loadBacklogWords>>>()
  useEffect(() => {
    if (!catalog) return
    let live = true
    void loadBacklogWords(catalog).then(words => { if (live) setBacklog(words) })
    return () => { live = false }
  }, [catalog, workspace.knowledge])
  const unwrittenTotal = backlog ? countUnwritten(backlog, workspace.characterStates) : 0
  const unwrittenNext = backlog ? pickUnwritten(backlog, workspace.characterStates, unwrittenSize) : undefined
  const skillSource = (): DrillSource => ({ kind: 'skill', skill, size, strategy })
  const selectionSource = (): DrillSource => mode === 'review' ? { kind: 'review', refs: selection, ...(fromSet ? { from: fromSet.id } : {}) } : { kind: 'new', count, refs: selection, ...(fromSet ? { from: fromSet.id } : {}) }
  const start = (source: DrillSource) => void run(async () => { navigate(setRoute(await createDrillSet(source), 'intro')) })
  /** The Hands-free shortcut: a practice set from the selection, opened straight on its Hands-free activity. */
  const startHandsfree = (source: DrillSource, kind: HandsfreeKind) => void run(async () => { const activity = newHandsfreeActivity(loadHandsfreeSettings()); navigate(setRoute(await createDrillSet(source, Date.now(), kind === 'recall' ? { handsfreeRecall: activity } : { handsfree: activity }), handsfreeRoute(kind))) })
  /** New items open the Hands-free introduction; Reviews open Hands-free recall. */
  const shortcutFor: HandsfreeKind = mode === 'review' ? 'recall' : 'introduction'
  return <div className="dr">
    <PageHeading eyebrow="Study" title={DRILLS_LABEL}>Practice sets of words and grammar patterns. Pick a type, do every item, pick another.</PageHeading>
    <KnowledgeCounts knowledge={workspace.knowledge} />
    {error && <div className="notice error" role="alert"><p>The curriculum could not be loaded. {error}</p></div>}
    {connection === null && <p className="notice small" role="status">Sentence and conversation exercises are written by your own AI model. <a className="text-link" href="#settings">Connect one in Settings</a>; the other types work without it.</p>}
    <section className="panel dr-panel dr-select" aria-labelledby="dr-select"><h2 id="dr-select">What you'll practise</h2>
      <label className="dr-source"><span className="eyebrow accent">Learning from</span>
        <select value={origin ? ORIGIN : from} aria-label="Learning from" onChange={event => { setFrom(event.target.value === ORIGIN ? from : event.target.value); if (origin && event.target.value !== ORIGIN) navigate('practice') }}>{origin && <option value={ORIGIN}>{origin.label}</option>}<option value={CURRICULUM}>Curriculum</option>{collections.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <div className="segmented" role="group" aria-label="What to practise"><button type="button" aria-pressed={mode === 'new'} disabled={!!origin} onClick={() => pickMode('new')}>New items</button><button type="button" aria-pressed={mode === 'review'} onClick={() => pickMode('review')}>Reviews</button></div>
      <div role="group" aria-label={mode === 'new' ? 'New items per set' : 'Reviews per set'} className="dr-count-picker">
        <span className="dr-count-label"><span className="small">{mode === 'new' ? 'New items per set' : 'Reviews per set'}</span><span className="small muted">{origin ? 'all of them, or the first few' : mode === 'new' ? 'at least — whole lessons are kept together' : 'the due ones first, then the ones coming up next'}</span></span>
        <span className="segmented">{origin && <button type="button" aria-pressed={all} onClick={() => { setAll(true) }}>All</button>}{NEW_COUNT_CHOICES.map(choice => <button type="button" key={choice} aria-pressed={!(origin && all) && count === choice} onClick={() => setCount(choice)}>{choice}</button>)}</span>
        <input type="number" inputMode="numeric" min={1} max={NEW_COUNT_MAX} aria-label={mode === 'new' ? 'Number of new items' : 'Number of reviews'} value={origin && all ? '' : typed} placeholder={origin && all ? 'All' : undefined} onChange={event => { setTyped(event.target.value); if (event.target.value !== '') setCount(Number(event.target.value)) }} onBlur={() => setTyped(String(count))} /></div>
      <p className="dr-summary" role="status" data-testid="selection-summary">{summary}</p>
      <div className="button-row"><button type="button" className="button secondary" disabled={nothing} onClick={() => setViewing(true)}><Eye size={16} /> View items</button></div>
    </section>
    {viewing && catalog && <ViewItems refs={selection} catalog={catalog} onClose={() => setViewing(false)} workspace={workspace} now={now} run={run} busy={busy} />}
    <section className="panel dr-panel dr-programs" aria-labelledby="dr-programs"><h2 id="dr-programs">Programs</h2>
      <ul className="dr-rows">
        <li><div><strong>Hands-free</strong><span className="small muted">Listen and answer aloud, with no screen. Uses the items above: New items open a Hands-free introduction, Reviews a Hands-free recall.</span></div>
          <span className="button-row"><button type="button" className="button primary" aria-label={`Start Hands-free ${shortcutFor}`} disabled={busy || nothing} onClick={() => startHandsfree(selectionSource(), shortcutFor)}>Start <ArrowRight size={16} /></button>
            <button type="button" className="button secondary" aria-label="Hands-free least practised (listening)" disabled={busy || !known.size} onClick={() => startHandsfree({ kind: 'skill', skill: 'listening', size: 10, strategy: 'least' }, 'recall')}>Least practised (listening)</button></span></li>
      </ul>
    </section>
    <div className="dr-columns">
      <section className="panel dr-panel" aria-labelledby="dr-start"><h2 id="dr-start">Start a set</h2>
        <ul className="dr-rows">
          <li><div><strong>Practice session</strong><span className="small muted">{summary}</span></div>
            <button type="button" className="button primary" aria-label="Start practice session" disabled={busy || nothing} onClick={() => start(selectionSource())}>Start <ArrowRight size={16} /></button></li>
          <li className="dr-skill dr-skill-block"><div><strong>Practice by skill</strong><span className="small muted dr-skill-note">Picks its own items by skill, not from the selection above. </span><span className="small muted">{known.size ? `${Math.min(size, known.size)} of your ${known.size} items, ${strategy === 'least' ? 'least practised first' : 'added in the last 3 days'}` : 'Add items to your knowledge set first'}</span>
            <span className="dr-skill-pickers"><select aria-label="Skill" value={skill} onChange={event => setSkill(event.target.value as Skill)}>{SKILLS.map(entry => <option key={entry} value={entry}>{SKILL_LABEL[entry]}</option>)}</select>
              <select aria-label="Set size" value={size} onChange={event => setSize(Number(event.target.value))}>{SKILL_SIZES.map(entry => <option key={entry} value={entry}>{entry}</option>)}</select>
              <select aria-label="Strategy" value={strategy} onChange={event => setStrategy(event.target.value as typeof strategy)}>{PICK_STRATEGIES.map(entry => <option key={entry} value={entry}>{STRATEGY_LABEL[entry]}</option>)}</select></span></div>
            <button type="button" className="button primary" aria-label="Start practice by skill" disabled={busy || !known.size} onClick={() => start(skillSource())}>Start <ArrowRight size={16} /></button></li>
          {unwrittenTotal > 0 && <li className="dr-skill dr-skill-block"><div><strong>Characters to write: {unwrittenTotal}</strong><span className="small muted">From words you know. Starts a set of the oldest words, about {unwrittenSize} new characters{unwrittenNext ? ` (${unwrittenNext.refs.length} ${unwrittenNext.refs.length === 1 ? 'word' : 'words'})` : ''}.</span>
            <span className="dr-skill-pickers"><select aria-label="Characters per set" value={unwrittenSize} onChange={event => { const next = Number(event.target.value); setUnwrittenSize(next); saveUnwrittenSize(next) }}>{UNWRITTEN_CHOICES.map(entry => <option key={entry} value={entry}>{entry}</option>)}</select></span></div>
            <button type="button" className="button primary" aria-label="Start unwritten characters" disabled={busy} onClick={() => start({ kind: 'unwritten', size: unwrittenSize })}>Start <ArrowRight size={16} /></button></li>}
        </ul>
      </section>
      <div className="dr-stack">
      <section className="panel dr-panel" aria-labelledby="dr-recent"><h2 id="dr-recent">Recent sessions</h2>
        {recent.length === 0 ? <p className="muted small">No sessions yet.</p> : <div className="resume-list">{recent.map(set =>
          <SetRow key={set.id} set={set} characterStates={workspace.characterStates} onAsk={() => setAsking({ id: set.id, title: set.title })} onRemove={() => void removeSession(set)} />)}</div>}
        {undo && <p className="history-toast" role="status">Removed {undo.title} from Recent sessions. <button type="button" className="button secondary" onClick={() => { void restoreHistoryItems([`drill:${undo.id}`]); setUndo(undefined) }}>Undo</button></p>}
        {unfinished.length >= MAX_UNFINISHED_SETS && <p className="small muted">Up to {MAX_UNFINISHED_SETS} unfinished sets are kept; starting another sets the oldest untouched one aside.</p>}
      </section>
      </div>
    </div>
    {asking && <ConfirmDialog title="Discard this session?" confirmLabel="Discard" busy={busy} onCancel={() => setAsking(undefined)}
      detail={<>It leaves Recent sessions and History. What you learned stays.</>}
      onConfirm={() => { const item = asking; setAsking(undefined); void run(() => discardDrillSet(item.id)) }} />}
    <section className="panel dr-classic"><div><strong>Classic practice</strong><span className="small muted">Word-recognition sessions, the due badge and Mahjong keep working as before.</span></div>
      <div className="button-row"><a className="button secondary" href="#review">Classic practice {wordsDue > 0 && <span className="tag">{wordsDue} due</span>}</a><a className="button secondary" href="#practice/mahjong">Mahjong</a></div></section>
  </div>
}

export type { ReactNode }

/** The intro cards and compact list for exactly the selected items, in a dialog. */
function ViewItems({ refs, catalog, onClose, workspace, now, run, busy }: Pick<PageProps, 'workspace' | 'now' | 'run' | 'busy'> & { refs: readonly string[]; catalog: NonNullable<ReturnType<typeof useCatalog>['catalog']>; onClose: () => void }) {
  const [items, setItems] = useState<ItemInfo[]>()
  useEffect(() => {
    let live = true
    void loadItems([...refs], catalog).then(found => { if (live) setItems(found) })
    return () => { live = false }
  }, [refs, catalog])
  return <Sheet title="Items" label="Items you will practise" wide onClose={onClose}>
    {items ? <IntroCards items={items} catalog={catalog} workspace={workspace} now={now} run={run} busy={busy} route="practice" /> : <p className="small muted" role="status">Opening the intro cards...</p>}
  </Sheet>
}
