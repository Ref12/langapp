import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react'
import type { Workspace } from '../../core/model'
import { readingIndex } from '../../core/study/annotate'
import type { Catalog } from '../../core/study/catalog'
import { MARK_LABEL, countMarks, drillType, scoreOf, type DrillSet, type DrillTypeId, type Mark } from '../../core/drills/contracts'
import type { ItemInfo } from '../../core/drills/items'
import { markCharactersWritten, recordDrillResult, recordRedo, recordWriteChar } from '../../core/drills/store'
import { guidedChars } from '../../core/drills/write-queue'
import { loadWriteChoice, saveWriteChoice } from './write-choice'
import { QuestionView, type QState, type ViewContext } from './QuestionViews'
import { DEFAULT_OPTIONS, applicable, catalogCharacters, isAuto, buildQuestions, grade, selfGrade, type Options, type Outcome, type Q } from './tasks'

interface RunProps {
  set: DrillSet
  type: DrillTypeId
  items: ItemInfo[]
  catalog: Catalog
  workspace: Workspace
  /** Limit the run to these items (Practise missed); such a run is never graded. */
  only?: string[]
  backHref: string
}

const TITLES: Record<string, string> = {
  choice: 'Choose the answer', match: 'Match the pairs', free: 'Type the answer', pinyin: 'Type the pinyin', write: 'Write it', translate: 'Translate into Chinese', repeat: 'Repeat after me', convo: 'Answer the questions',
}

/** One drill type over the items of a set: one at a time, or as a single page answered in bulk. The first pass of a type is graded; a redo is not. */
export function DrillRun({ set, type, items, catalog, workspace, only, backHref }: RunProps) {
  const progress = set.progress[type]
  // Fixed when the pass starts: finishing it marks the type done, which must not turn its own summary into a redo.
  const [graded] = useState(() => !only && !progress?.done)
  const scope = useMemo(() => applicable(type, items, set.content).map(item => item.ref), [type, items, set.content])
  const known = useMemo(() => new Set(workspace.knowledge.map(entry => entry.ref)), [workspace.knowledge])
  // Write elsewhere is the default for reviews (or the last mode used for them); new items start on the pad, so new characters can be taught.
  const [options, setOptions] = useState<Options>(() => ({ ...DEFAULT_OPTIONS, ...(type === 'write' ? loadWriteChoice(set.source) : {}) }))
  const writeWords = useMemo(() => applicable('write', items, set.content).map(item => ({ ref: item.ref, chars: guidedChars(item.zh) })), [items, set.content])
  const build = useCallback((next: Options) => {
    const left = only ?? (graded ? scope.filter(ref => !progress?.results[ref]) : undefined)
    return buildQuestions(type, { setId: set.id, items, catalog, known, content: set.content, options: next, refs: left, charStates: workspace.characterStates, pass: graded ? 0 : (progress?.redos ?? 0) + 1,
      charsDone: graded && progress?.chars ? new Set(Object.keys(progress.chars)) : undefined })
  // The queue is fixed when a pass starts or an option changes; results arriving later must not reshuffle it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, set.id, items, catalog])
  const [queue, setQueue] = useState<Q[]>(() => build(options))
  const [states, setStates] = useState<Record<string, QState>>({})
  const [index, setIndex] = useState(0)
  const [local, setLocal] = useState<Record<string, Mark>>({})
  const quiz = set.format === 'quiz'
  const counted = useRef(false)
  useEffect(() => {
    if (counted.current || graded || only) return
    counted.current = true
    void recordRedo(set.id, type)
  }, [graded, only, set.id, type])
  const ctx: ViewContext = useMemo(() => ({
    readings: readingIndex([...new Set([...known, ...set.refs])].flatMap(ref => catalog.units.get(ref) ?? [])), pinyinOn: workspace.preferences.pinyin, catalogChars: catalogCharacters(), workspace,
  }), [workspace, known, set.refs, catalog])
  const change = (next: Options) => { if (type === 'write') saveWriteChoice(set.source, next); setOptions(next); setQueue(build(next)); setStates({}); setIndex(0) }

  const record = (outcome: Outcome, q: Q) => {
    setLocal(current => ({ ...current, ...outcome.marks }))
    const data = q.data
    if (data.t === 'write' && data.char !== undefined) {
      const mark = outcome.marks[data.char]
      if (graded) { void recordWriteChar(set.id, data.char, mark, data.item.ref, writeWords, scope); if (mark !== 'missed') void markCharactersWritten([data.char]) }
      return
    }
    for (const [ref, mark] of Object.entries(outcome.marks)) {
      if (graded && data.t === 'write' && mark !== 'missed') void markCharactersWritten(guidedChars(data.item.zh))
      void recordDrillResult(set.id, type, ref, mark, scope)
    }
  }
  const patch = (key: string, state: Partial<QState>) => setStates(current => ({ ...current, [key]: { ...(current[key] ?? { status: 'open' as const }), ...state } }))
  const check = (q: Q, answer: unknown) => {
    const result = grade(q, answer)
    if (result === 'self') { patch(q.key, { answer, status: 'marking' }); return }
    patch(q.key, { answer, status: 'done', outcome: result })
    record(result, q)
  }
  const mark = (q: Q, chosen: Mark) => {
    const outcome = selfGrade(q, states[q.key]?.answer, chosen)
    patch(q.key, { status: 'done', outcome })
    record(outcome, q)
  }
  const answer = (q: Q, value: unknown) => {
    if (quiz || !isAuto(q)) { patch(q.key, { answer: value }); return }
    if (value !== undefined && !states[q.key]?.outcome && states[q.key]?.status !== 'marking') check(q, value)
  }
  const name = drillType(type).name

  const toolbar = <div className="dr-toolbar dr-modes-bar">
    {type === 'meanings' && <>
      <div className="segmented dr-modes" role="group" aria-label="Style">{(['choice', 'match', 'free'] as const).map(style =>
        <button key={style} type="button" aria-pressed={options.style === style} onClick={() => change({ ...options, style })}>{style === 'choice' ? 'Choose' : style === 'match' ? 'Match' : 'Type'}</button>)}</div>
      {options.style !== 'match' && <div className="segmented dr-modes" role="group" aria-label="Direction">{(['zh-to-en', 'en-to-zh'] as const).map(direction =>
        <button key={direction} type="button" aria-pressed={options.direction === direction} onClick={() => change({ ...options, direction })}>{direction === 'zh-to-en' ? '中 → English' : 'English → 中'}</button>)}</div>}</>}
    {type === 'write' && <>
      <div className="segmented dr-modes" role="group" aria-label="What to write">{(['chars', 'words'] as const).map(writeUnit =>
        <button key={writeUnit} type="button" aria-pressed={options.writeUnit === writeUnit} onClick={() => change({ ...options, writeUnit })}>{writeUnit === 'chars' ? 'Characters' : 'Whole words'}</button>)}</div>
      <div className="segmented dr-modes" role="group" aria-label="Writing">{(['pad', 'paper'] as const).map(writeMode =>
        <button key={writeMode} type="button" aria-pressed={options.writeMode === writeMode} onClick={() => change({ ...options, writeMode })}>{writeMode === 'pad' ? 'Handwriting pad' : 'Write elsewhere'}</button>)}</div></>}
  </div>

  const header = <>
    <a className="back-link" href={backHref}><ArrowLeft size={16} /> {set.title}</a>
    <div className="card-topline"><span className="eyebrow">{name.toUpperCase()}{graded ? '' : ' · REDO, NOT GRADED'}</span>
      <span className="small muted">{quiz ? 'Quiz' : queue.length ? `Question ${Math.min(index + 1, queue.length)} of ${queue.length}` : ''}</span></div>
  </>

  if (!queue.length) return <div className="dr" data-assistant-exclude><section className="panel dr-run">{header}<p role="status">{graded && progress && scope.length ? 'Every item in this type already has a result.' : 'There is nothing to practise here.'}</p>
    <div className="dr-actions"><a className="button primary" href={backHref}>Back to the set</a></div></section></div>

  const counts = { got: 0, hint: 0, missed: 0 } as Record<Mark, number>
  for (const value of Object.values(local)) counts[value]++
  const missedChars = queue.flatMap(q => q.data.t === 'write' && q.data.char !== undefined && local[q.data.char] === 'missed' ? [[q.data.char, q.data.item.ref] as const] : [])
  const finishedAll = quiz ? queue.every(q => states[q.key]?.status === 'done') : index >= queue.length
  const summary = <section className="panel completion dr-end-panel" aria-label="Pass finished"><CheckCircle2 size={36} className="accent" aria-hidden="true" />
    <h2>{graded ? `${name} done` : 'Redo finished'}</h2>
    <p className="dr-stats"><span><strong>{counts.got}</strong>{MARK_LABEL.got}</span><span><strong>{counts.hint}</strong>{MARK_LABEL.hint}</span><span><strong>{counts.missed}</strong>{MARK_LABEL.missed}</span></p>
    {missedChars.length > 0 && <div className="dr-missed-chars"><h3 className="small">Missed characters</h3><ul className="dr-rows">{missedChars.map(([char, cue]) => <li key={char}><strong lang="zh-Hans" className="dr-zh">{char}</strong><span className="small muted" lang="zh-Hans">in {items.find(item => item.ref === cue)?.zh ?? cue}</span></li>)}</ul></div>}
    {graded ? <p className="small muted">Recorded in your knowledge and review schedule. {set.progress[type] ? (() => { const s = scoreOf(countMarks({ progress: { [type]: set.progress[type]! } }, [type])); return `Score: ${s.correct} of ${s.total}.` })() : ''}</p>
      : <p className="small muted">Ungraded practice: your score and schedule are unchanged.</p>}
    <div className="button-row"><a className="button primary" href={backHref}>Back to the set</a></div></section>
  if (finishedAll) return <div className="dr" data-assistant-exclude>{header}{summary}</div>

  if (quiz) {
    const answered = queue.filter(q => states[q.key]?.answer !== undefined || states[q.key]?.status === 'marking' || states[q.key]?.status === 'done').length
    const checked = queue.some(q => (states[q.key]?.status ?? 'open') !== 'open')
    const checkAll = () => { for (const q of queue) { const state = states[q.key]; if (state?.answer !== undefined && (state.status ?? 'open') === 'open') check(q, state.answer) } }
    return <div className="dr" data-assistant-exclude>{header}{toolbar}
      <ol className="dr-quiz">{queue.map((q, number) => <li key={q.key} className="panel"><div className="dr-qhead"><span className="eyebrow">{number + 1}</span><h2 className="small">{TITLES[q.data.t]}</h2></div>
        <QuestionView q={q} quiz state={states[q.key] ?? { status: 'open' }} ctx={ctx} onAnswer={value => answer(q, value)} onMark={chosen => mark(q, chosen)} /></li>)}</ol>
      <div className="dr-sticky" role="region" aria-label="Quiz progress"><span><strong>{answered} of {queue.length}</strong> answered</span>
        <button type="button" className="button primary" disabled={answered === 0 || (checked && queue.every(q => (states[q.key]?.status ?? 'open') !== 'open'))} onClick={checkAll}>Check all</button></div></div>
  }

  const q = queue[index]
  const state = states[q.key] ?? { status: 'open' as const }
  const canCheck = !isAuto(q) && state.status === 'open' && state.answer !== undefined
  return <div className="dr" data-assistant-exclude><section className="panel dr-run">{header}
    <progress aria-label="Progress" value={index} max={queue.length} />
    {toolbar}
    <h2 className="small dr-qtitle">{TITLES[q.data.t]}</h2>
    <QuestionView key={q.key} q={q} quiz={false} state={state} ctx={ctx} onAnswer={value => answer(q, value)} onMark={chosen => mark(q, chosen)} />
    <div className="dr-actions">
      {state.status === 'done' ? <button type="button" className="button primary" onClick={() => setIndex(index + 1)}>{index + 1 >= queue.length ? 'Finish' : 'Next'} <ArrowRight size={16} /></button>
        : !isAuto(q) ? <button type="button" className="button primary" disabled={!canCheck} onClick={() => check(q, state.answer)}>Check answer</button> : null}
    </div></section></div>
}
