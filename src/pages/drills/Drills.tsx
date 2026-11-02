import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, Eye, EyeOff, GraduationCap, Headphones, Languages, MessageSquareText, PenLine, Play, Repeat, RotateCcw, Shuffle, Trash2, Type, type LucideIcon } from 'lucide-react'
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
import { NEW_COUNT_CHOICES, NEW_COUNT_MAX, clampCount, countItems, fillByItems, lessonCount, loadNewCount, loadReviewCount, saveNewCount, saveReviewCount } from '../../core/study/daily'
import { MARK_LABEL, DRILLS_LABEL, DRILL_TYPES, countMarks, scoreOf, type DrillSet, type DrillTypeId, type TypeProgress } from '../../core/drills/contracts'
import { effectiveContent } from '../../core/drills/content'
import { loadItems, type ItemInfo } from '../../core/drills/items'
import { describeItems } from '../../core/drills/write-queue'
import { MAX_UNFINISHED_SETS, shortDate, createDrillSet, discardDrillSet, finishDrillSet, newHandsfreeActivity, ensureHandsfree, restartHandsfree, restartDrillType, resumeRoute, retryContent, setFormat, unfinishedSets, type DrillSource } from '../../core/drills/store'
import { DrillRun } from './DrillRun'
import { IntroCards } from './IntroCards'
import { Sheet } from './Sheet'
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
  if (page === 'handsfree') return <HandsFree {...props} set={set} />
  if (page === 'summary' || set.status === 'abandoned') return <Summary {...props} set={set} items={items} />
  return <SetScreen {...props} set={set} items={items} />
}

/** New-item sets open on the lesson's intro cards; review and study-set sets keep their items out of sight until asked. */
function Intro({ set, items, catalog, workspace, now, run, busy }: PageProps & { set: DrillSet; items: ItemInfo[]; catalog: NonNullable<ReturnType<typeof useCatalog>['catalog']> }) {
  const [shown, setShown] = useState(false)
  const fresh = set.source === 'new' || set.source === 'lesson'
  useEffect(() => { if (fresh) void recordSetIntro(set.id, set.refs, ACTIVITY_SKILLS.introCard).catch(() => undefined) }, [fresh, set.id, set.refs])
  const start = <a className="button primary" href={`#${setRoute(set.id)}`}>Start practicing <ArrowRight size={16} /></a>
  const detail = describeItems(items, workspace.characterStates) || itemCount(items.length)
  const examplesFor = (ref: string) => (catalog.orderedGroups.find(entry => entry.group.units.some(unit => unit.ref === ref))?.group.examples ?? [])
    .filter(example => example.segments.some(segment => `vocabulary:${segment.word}` === ref) || example.grammar.some(label => `grammar:${label}` === ref))
  return <div className="dr">
    <a className="back-link" href={`#practice`}><ArrowLeft size={16} /> {DRILLS_LABEL}</a>
    <PageHeading eyebrow={fresh ? 'New set' : set.source === 'review' ? 'Review set' : TERM.Singular} title={set.title} action={start}>{detail}. {fresh ? 'Read the intro cards first.' : 'Your items are hidden so the list gives no hints.'}</PageHeading>
    {fresh ? <>
      <h2 className="dr-h2">{items.length} {items.length === 1 ? 'item' : 'items'}</h2>
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

const TYPE_COUNT = DRILL_TYPES.length + 1
/** Types done, Hands-free included. */
const typesDoneOf = (set: DrillSet) => Object.values(set.progress).filter(entry => entry.done).length + (set.handsfree?.done ? 1 : 0)

function SetScreen({ set, items, run, busy, workspace }: PageProps & { set: DrillSet; items: ItemInfo[] }) {
  const content = effectiveContent(set)
  const connection = useAIConnection()
  const quiz = set.format === 'quiz'
  const rows = DRILL_TYPES.map(entry => ({ entry, avail: availability(entry.id, items, content), progress: set.progress[entry.id] }))
  // A Practice by skill set lists the types for its skill first.
  if (set.emphasis) rows.sort((a, b) => Number(drillSkills(b.entry.id).includes(set.emphasis!)) - Number(drillSkills(a.entry.id).includes(set.emphasis!)))
  const done = rows.filter(row => row.progress?.done)
  const todo = rows.filter(row => !row.progress?.done)
  const finished = set.status === 'completed'
  const hf = set.handsfree
  const hfDone = !!hf?.done
  const hfStopped = !!hf?.started && !hfDone
  const openHf = (again: boolean) => void run(async () => { if (again) await restartHandsfree(set.id); else await ensureHandsfree(set.id, loadHandsfreeSettings()); navigate(setRoute(set.id, 'handsfree')) })
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
  return <div className="dr">
    <a className="back-link" href="#practice"><ArrowLeft size={16} /> {DRILLS_LABEL}</a>
    <PageHeading eyebrow={finished ? 'Finished' : 'Practice set'} title={set.title} action={finished ? <a className="button secondary" href={`#${setRoute(set.id, 'summary')}`}>Summary</a> : <button type="button" className="button secondary" disabled={busy} onClick={finish}>Finish set</button>}>{describeItems(items, workspace.characterStates) || itemCount(set.refs.length)} · {done.length + (hfDone ? 1 : 0)} of {TYPE_COUNT} types done</PageHeading>
    <div className="dr-toolbar dr-setbar">
      {(set.source === 'new' || set.source === 'lesson') && <a className="button secondary" href={`#${setRoute(set.id, 'intro')}`}><BookOpen size={16} /> Intro cards</a>}
      {set.source !== 'new' && set.source !== 'lesson' && <a className="button secondary" href={`#${setRoute(set.id, 'intro')}`}><Eye size={16} /> Items</a>}
      <div className="dr-format"><span className="eyebrow">Format for the next Start</span><div className="segmented" role="group" aria-label="Format">
        <button type="button" aria-pressed={!quiz} onClick={() => void run(async () => { await setFormat(set.id, 'single') })}>One at a time</button>
        <button type="button" aria-pressed={quiz} onClick={() => void run(async () => { await setFormat(set.id, 'quiz') })}>Quiz</button></div></div></div>
    {content.state === 'running' && <p className="small muted" role="status">Writing sentences and conversations with your AI model ({content.done ?? 0} of {content.total ?? 0} requests done). Types that need them say when they are ready.</p>}
    {content.state === 'no-ai' && connection === null && <p className="notice small" role="status">No AI model is connected, so only the types built from the catalog are available. <a className="text-link" href="#settings">Connect one in Settings</a>.</p>}
    <div className="dr-columns">
      <section className="panel dr-panel" aria-labelledby="dr-types"><h2 id="dr-types">Pick a practice type</h2><p className="small muted">{set.emphasis ? `${SKILL_LABEL[set.emphasis]} types first. ` : ''}Any order. Each type covers the items of the set it applies to.</p>
        <ul className="dr-rows">{!hfDone && <li><Headphones size={20} aria-hidden="true" />
              <div><strong>Hands-free</strong><span className="small muted">Listen and repeat, screen optional · {hfCount}{hfStopped ? ` · stopped at prompt ${hf!.position + 1}` : ''}</span></div>
              <span className="dr-actions">{hfStopped
                ? <><button type="button" className="icon-button" disabled={busy} aria-label={`Continue Hands-free at prompt ${hf!.position + 1}`} title={`Continue at prompt ${hf!.position + 1}`} onClick={() => openHf(false)}><ArrowRight size={18} /></button>
                  <button type="button" className="icon-button" disabled={busy} aria-label="Restart Hands-free" title="Restart" onClick={() => openHf(true)}><RotateCcw size={18} /></button></>
                : <button type="button" className="icon-button" disabled={busy} aria-label="Start Hands-free" title="Start" onClick={() => openHf(false)}><Play size={18} /></button>}</span></li>}
            {todo.map(({ entry, avail, progress }) => { const Icon = ICONS[entry.icon]; const ready = avail.state === 'ready'
          return <li key={entry.id}><Icon size={20} aria-hidden="true" />
            <div><strong>{entry.name}</strong><span className="small muted">{ready ? `${entry.blurb} · ${avail.count} ${avail.count === 1 ? 'item' : 'items'}${progress ? ` · ${Object.keys(progress.results).length} of ${progress.scope.length} done` : ''}` : avail.message}</span>
              {avail.state === 'running' && <progress aria-label={`${entry.name} progress`} value={content.done ?? 0} max={Math.max(1, content.total ?? 1)} />}</div>
            <span className="dr-actions">{ready ? (progress
                ? <><a className="icon-button" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Continue ${entry.name}`} title="Continue"><ArrowRight size={18} /></a>
                  <button type="button" className="icon-button" disabled={busy} aria-label={`Restart ${entry.name}`} title="Restart" onClick={() => restartType(entry, progress)}><RotateCcw size={18} /></button></>
                : <a className="icon-button" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Start ${entry.name}${quiz ? ' as a quiz' : ''}`} title={quiz ? 'Start as a quiz' : 'Start'}><Play size={18} /></a>)
              : avail.state === 'failed' ? <button type="button" className="icon-button" disabled={busy} aria-label={`Try again ${entry.name}`} title="Try again" onClick={() => void run(async () => { void retryContent(set.id) })}><RotateCcw size={18} /></button>
                : <button type="button" className="icon-button" disabled aria-label={`${entry.name} ${avail.state === 'running' ? 'is being written' : 'is not available'}`} title={avail.state === 'running' ? 'Writing…' : 'Not available'}><Play size={18} /></button>}</span></li> })}
          {todo.length === 0 && hfDone && <li><p className="small muted">Every type is done. Finish the set to see your summary, or redo any type.</p></li>}</ul></section>
      <section className="panel dr-panel" aria-labelledby="dr-done"><h2 id="dr-done">Done</h2>
        {done.length === 0 && !hfDone && <p className="small muted">Finished types move here with their score and a Restart.</p>}
        <ul className="dr-rows">{hfDone && <li><CheckCircle2 size={20} className="accent" aria-hidden="true" />
              <div><strong>Hands-free</strong><span className="small muted">Played to the end</span></div>
              <span className="dr-actions"><button type="button" className="icon-button" disabled={busy} aria-label="Restart Hands-free" title="Restart" onClick={() => openHf(true)}><RotateCcw size={18} /></button></span></li>}
            {done.map(({ entry, progress }) => { const counts = countMarks({ progress: { [entry.id]: progress! } }, [entry.id]); const score = scoreOf(counts)
          return <li key={entry.id}><CheckCircle2 size={20} className="accent" aria-hidden="true" />
            <div><strong>{entry.name}</strong><span className="small muted">{score.correct} of {score.total} correct · {counts.got} {MARK_LABEL.got.toLowerCase()}, {counts.hint} hint, {counts.missed} missed</span></div>
            <span className="dr-actions"><a className="icon-button" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Restart ${entry.name}`} title="Restart"><RotateCcw size={18} /></a></span></li> })}</ul></section>
    </div>
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
      <table className="dr-table"><thead><tr><th>Type</th><th>Score</th><th title="Got it · Needed a hint · Missed">Got · Hint · Missed</th><th /></tr></thead>
        <tbody>{DRILL_TYPES.map(entry => { const progress = set.progress[entry.id]; const c = countMarks({ progress: progress ? { [entry.id]: progress } : {} }, [entry.id]); const s = scoreOf(c)
          return <tr key={entry.id}><td>{entry.name}</td><td>{progress ? `${s.correct}/${s.total}${progress.done ? '' : ' (partial)'}` : '–'}</td><td>{progress ? `${c.got} · ${c.hint} · ${c.missed}` : '–'}</td>
            <td>{progress?.done ? <a className="button secondary" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Redo ${entry.name}`}>Redo</a> : null}</td></tr> })}</tbody></table></section>
    <section className="panel dr-panel"><h2>Items to revisit</h2>
      {revisit.length === 0 ? <p className="small muted">{score.total ? 'Nothing to revisit: every answer was Got it.' : 'Nothing yet.'}</p>
        : <ul className="dr-rows">{revisit.map(({ item, mark }) => <li key={item.ref}><div><strong lang="zh-Hans" className="dr-zh">{item.zh}</strong><span className="small muted">{item.py} {item.en}</span></div><span className={`tag dr-tag-${mark}`}>{MARK_LABEL[mark]}</span></li>)}</ul>}
      {missedType && <div className="button-row"><a className="button secondary" href={`#${setRoute(set.id, `run/${missedType.id}?missed=1`)}`}>Practise missed (ungraded)</a></div>}</section>
    <div className="button-row">{active && <button type="button" className="button primary" disabled={busy} onClick={() => void run(async () => { await finishDrillSet(set.id); navigate('practice') })}>Finish set</button>}
      <a className="button secondary" href="#practice">{DRILLS_LABEL} home</a></div>
  </div>
}

/** The breakdown of an unfinished set's items under its title. */
function UnfinishedInfo({ set, typesDone, characterStates }: { set: DrillSet; typesDone: number; characterStates: PageProps['workspace']['characterStates'] }) {
  const items = useItems(set)
  const stopped = !!set.handsfree?.started && !set.handsfree.done
  const what = (items && describeItems(items, characterStates)) || itemCount(set.refs.length)
  return <span className="small muted dr-wrap">{stopped && set.shortcut ? `Hands-free · ${what} · stopped at prompt ${set.handsfree!.position + 1}` : `${what} · ${typesDone} of ${TYPE_COUNT} types done${stopped ? ` · Hands-free stopped at prompt ${set.handsfree!.position + 1}` : ''}`}</span>
}

/** One set, unfinished or finished, in the one Recent sets list: title (In progress when unfinished) and meta on the left; Resume or Open, Save to study set and the ⋯ menu on the right. */
function SetRow({ set, characterStates, onAsk }: { set: DrillSet; characterStates: PageProps['workspace']['characterStates']; onAsk: () => void }) {
  const unfinished = set.status === 'active'
  const removable = useLiveQuery(() => runAddedRefs('drill', set.id), [set.id, set.addedRefs])
  const typesDone = typesDoneOf(set)
  return <div className="resume-row">
    <div className="resume-text"><strong>{set.title}{unfinished && <span className="tag in-progress">In progress</span>}</strong>
      {unfinished ? <UnfinishedInfo set={set} typesDone={typesDone} characterStates={characterStates} />
        : <span className="small muted dr-wrap">{set.shortcut ? 'Hands-free' : 'Practice set'} · {itemCount(set.refs.length)} · {typesDone} of {TYPE_COUNT} types done · {shortDate(set.completedAt ?? set.updatedAt)}</span>}</div>
    {unfinished ? <a className="icon-button" href={`#${resumeRoute(set)}`} aria-label={`Resume ${set.title}`} title="Resume"><ArrowRight size={18} /></a>
      : <a className="icon-button" href={`#${setRoute(set.id)}`} aria-label={`Open ${set.title}`} title="Open"><ArrowRight size={18} /></a>}
    <SaveToMenu refs={[...new Set(set.refs)]} name={set.title} />
    {(unfinished || !!removable?.length) && <RowMenu name={set.title}>
      {unfinished ? <button type="button" role="menuitem" className="menu-item" aria-label={`Discard ${set.title}`} aria-haspopup="dialog" onClick={onAsk}><Trash2 size={15} /> Discard</button>
        : <RemoveFromKnowledge kind="drill" id={set.id} name={set.title} menuItem />}
    </RowMenu>}
  </div>
}

function DrillsHome({ workspace, now, run, busy }: PageProps) {
  const { catalog, error } = useCatalog()
  const connection = useAIConnection()
  const sets = useLiveQuery(() => db.drillSets.toArray(), []) ?? []
  const collections = useLiveQuery(() => db.collections.toArray(), []) ?? []
  const collectionItems = useLiveQuery(() => db.collectionItems.toArray(), []) ?? []
  const [from, setFrom] = useState(CURRICULUM)
  const originParam = new URLSearchParams(useRoute().split('?').slice(1).join('?')).get('from') ?? ''
  /** The items of a past lesson, practice set or Hands-free run named in the hash (undefined while loading, null when there is none). */
  const origin = useLiveQuery(async (): Promise<{ label: string; refs: string[] } | null> => {
    const at = originParam.indexOf(':'); const kind = originParam.slice(0, at), id = originParam.slice(at + 1)
    if (at < 0 || !id) return null
    if (kind === 'lesson') { const item = await db.exerciseSessions.get(id); return item ? { label: `Lesson · ${shortDate(item.completedAt ?? item.createdAt)}`, refs: [...new Set([...item.targetRefs, ...item.reviewRefs])] } : null }
    if (kind === 'drill' || kind === 'handsfree') { const item = await db.drillSets.get(id); return item ? { label: `${item.shortcut ? 'Hands-free' : 'Practice set'} · ${shortDate(item.createdAt)}`, refs: [...new Set(item.refs)] } : null }
    return null
  }, [originParam]) ?? null
  const [all, setAll] = useState(true)
  useEffect(() => setAll(true), [originParam])
  const [asking, setAsking] = useState<{ id: string; title: string }>()
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
  const dueRefs = useMemo(() => workspace.studyCards.filter(card => card.domain === DOMAIN && card.due <= now && known.has(card.ref) && (!inFrom || inFrom.has(card.ref)) && (!catalog || catalog.units.has(card.ref) || isSourceRef(card.ref) || isPhraseRef(card.ref)))
    .sort((a, b) => a.due - b.due || a.ref.localeCompare(b.ref)).map(card => card.ref),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [workspace.studyCards, now, known, catalog, from, collectionItems])
  const freshFromSet = fromSet ? collectionItems.filter(item => item.collectionId === fromSet.id && !known.has(item.ref)).sort((a, b) => a.addedAt - b.addedAt).map(item => item.ref) : []
  /** The one selection: View items shows it and Start creates exactly it. */
  const selection = useMemo(() => origin ? (all ? origin.refs : origin.refs.slice(0, count)) : !catalog ? [] : mode === 'review' ? dueRefs.slice(0, count) : fromSet ? freshFromSet.slice(0, count) : fillByItems(catalog, known, count),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [catalog, mode, count, dueRefs, from, known, collectionItems, origin, all])
  const selectionUnits = selection.flatMap(ref => { const unit = catalog?.units.get(ref); return unit ? [unit] : [] })
  const selectionCounts = countItems(selection.map(ref => ({ kind: ref.startsWith('grammar:') ? 'grammar' as const : 'vocabulary' as const })))
  const newCharacters = catalog ? describeItems(selectionUnits.map(unit => ({ kind: unit.kind, zh: unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt })), workspace.characterStates).match(/\d+ new characters?/)?.[0] : undefined
  const lessons = catalog && !origin && !fromSet && mode === 'new' ? lessonCount(catalog, selection) : 0
  const itemsNoun = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`
  const summary = origin ? `${selection.length} of ${itemsNoun(origin.refs.length)} from ${origin.label}` : !catalog ? 'Loading the curriculum...'
    : mode === 'review' ? (dueRefs.length ? `${selection.length} of ${dueRefs.length} due` : 'Nothing is due for review right now')
    : !selection.length ? (fromSet ? `Nothing new left in ${fromSet.name}` : 'Nothing new left here')
    : [itemsNoun(selection.length), `${selectionCounts.words} ${selectionCounts.words === 1 ? 'word' : 'words'}, ${selectionCounts.grammar} grammar`, lessons ? `${lessons} ${lessons === 1 ? 'lesson' : 'lessons'}` : '', newCharacters ?? ''].filter(Boolean).join(' · ')
  const nothing = !selection.length
  const [skill, setSkill] = useState<Skill>('reading')
  const [size, setSize] = useState<number>(10)
  const [strategy, setStrategy] = useState<typeof PICK_STRATEGIES[number]>('least')
  const skillSource = (): DrillSource => ({ kind: 'skill', skill, size, strategy })
  const selectionSource = (): DrillSource => mode === 'review' ? { kind: 'review', refs: selection, ...(fromSet ? { from: fromSet.id } : {}) } : { kind: 'new', count, refs: selection, ...(fromSet ? { from: fromSet.id } : {}) }
  const start = (source: DrillSource) => void run(async () => { navigate(setRoute(await createDrillSet(source), 'intro')) })
  /** The Hands-free shortcut: a practice set from the selection, opened straight on its Hands-free activity. */
  const startHandsfree = (source: DrillSource) => void run(async () => { navigate(setRoute(await createDrillSet(source, Date.now(), { handsfree: newHandsfreeActivity(loadHandsfreeSettings()) }), 'handsfree')) })
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
        <span className="dr-count-label"><span className="small">{mode === 'new' ? 'New items per set' : 'Reviews per set'}</span><span className="small muted">{origin ? 'all of them, or the first few' : mode === 'new' ? 'at least — whole lessons are kept together' : 'at most, the most overdue first'}</span></span>
        <span className="segmented">{origin && <button type="button" aria-pressed={all} onClick={() => { setAll(true) }}>All</button>}{NEW_COUNT_CHOICES.map(choice => <button type="button" key={choice} aria-pressed={!(origin && all) && count === choice} onClick={() => setCount(choice)}>{choice}</button>)}</span>
        <input type="number" inputMode="numeric" min={1} max={NEW_COUNT_MAX} aria-label={mode === 'new' ? 'Number of new items' : 'Number of reviews'} value={origin && all ? '' : typed} placeholder={origin && all ? 'All' : undefined} onChange={event => { setTyped(event.target.value); if (event.target.value !== '') setCount(Number(event.target.value)) }} onBlur={() => setTyped(String(count))} /></div>
      <p className="dr-summary" role="status" data-testid="selection-summary">{summary}</p>
      <div className="button-row"><button type="button" className="button secondary" disabled={nothing} onClick={() => setViewing(true)}><Eye size={16} /> View items</button></div>
    </section>
    {viewing && catalog && <ViewItems refs={selection} catalog={catalog} onClose={() => setViewing(false)} workspace={workspace} now={now} run={run} busy={busy} />}
    <section className="panel dr-panel dr-programs" aria-labelledby="dr-programs"><h2 id="dr-programs">Programs</h2>
      <ul className="dr-rows">
        <li><div><strong>Hands-free</strong><span className="small muted">Listen and answer aloud, with no screen. Uses the items above: words, recall, then grammar.</span></div>
          <span className="button-row"><button type="button" className="button primary" aria-label="Start Hands-free" disabled={busy || nothing} onClick={() => startHandsfree(selectionSource())}>Start <ArrowRight size={16} /></button>
            <button type="button" className="button secondary" aria-label="Hands-free least practised (listening)" disabled={busy || !known.size} onClick={() => startHandsfree({ kind: 'skill', skill: 'listening', size: 10, strategy: 'least' })}>Least practised (listening)</button></span></li>
      </ul>
    </section>
    <div className="dr-columns">
      <section className="panel dr-panel" aria-labelledby="dr-start"><h2 id="dr-start">Start a set</h2>
        <ul className="dr-rows">
          <li><div><strong>Practice set</strong><span className="small muted">{summary}</span></div>
            <button type="button" className="button primary" aria-label="Start practice set" disabled={busy || nothing} onClick={() => start(selectionSource())}>Start <ArrowRight size={16} /></button></li>
          <li className="dr-skill dr-skill-block"><div><strong>Practice by skill</strong><span className="small muted dr-skill-note">Picks its own items by skill, not from the selection above. </span><span className="small muted">{known.size ? `${Math.min(size, known.size)} of your ${known.size} items, ${strategy === 'least' ? 'least practised first' : 'added in the last 3 days'}` : 'Add items to your knowledge set first'}</span>
            <span className="dr-skill-pickers"><select aria-label="Skill" value={skill} onChange={event => setSkill(event.target.value as Skill)}>{SKILLS.map(entry => <option key={entry} value={entry}>{SKILL_LABEL[entry]}</option>)}</select>
              <select aria-label="Set size" value={size} onChange={event => setSize(Number(event.target.value))}>{SKILL_SIZES.map(entry => <option key={entry} value={entry}>{entry}</option>)}</select>
              <select aria-label="Strategy" value={strategy} onChange={event => setStrategy(event.target.value as typeof strategy)}>{PICK_STRATEGIES.map(entry => <option key={entry} value={entry}>{STRATEGY_LABEL[entry]}</option>)}</select></span></div>
            <button type="button" className="button primary" aria-label="Start practice by skill" disabled={busy || !known.size} onClick={() => start(skillSource())}>Start <ArrowRight size={16} /></button></li>
        </ul>
      </section>
      <div className="dr-stack">
      <section className="panel dr-panel" aria-labelledby="dr-recent"><h2 id="dr-recent">Recent sets</h2>
        {recent.length === 0 ? <p className="muted small">No sets yet.</p> : <div className="resume-list">{recent.map(set =>
          <SetRow key={set.id} set={set} characterStates={workspace.characterStates} onAsk={() => setAsking({ id: set.id, title: set.title })} />)}</div>}
        {unfinished.length >= MAX_UNFINISHED_SETS && <p className="small muted">Up to {MAX_UNFINISHED_SETS} unfinished sets are kept; starting another sets the oldest untouched one aside.</p>}
      </section>
      </div>
    </div>
    {asking && <ConfirmDialog title="Discard this set?" confirmLabel="Discard" busy={busy} onCancel={() => setAsking(undefined)}
      detail={<>{asking.title} moves out of Unfinished sets. What you practised so far stays in History.</>}
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
