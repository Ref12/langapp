import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getPack } from '../../core/language'
import { drillText } from '../../core/language/practice-wording'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import type { Workspace } from '../../core/model'
import type { PageProps } from '../../components/shared'
import { readingIndex } from '../../core/study/annotate'
import type { Catalog } from '../../core/study/catalog'
import { MARK_LABEL, countMarks, drillType, scoreOf, type DrillSet, type DrillTypeId, type Mark } from '../../core/drills/contracts'
import type { ItemInfo } from '../../core/drills/items'
import { writtenCharacters } from '../../core/drills/write-queue'
import { recordDrillResult, recordRedo } from '../../core/drills/store'
import { loadWriteChoice, saveWriteChoice } from './write-choice'
import { QuestionView, type QState, type ViewContext } from './QuestionViews'
import { AnswerButton } from '../../components/AnswerButton'
import { DEFAULT_OPTIONS, markable, applicable, catalogCharacters, isAuto, needsConfirm, suggestedMark, toneOnly, buildQuestions, grade, selfGrade, type Options, type Outcome, type Q } from './tasks'

interface RunProps extends Pick<PageProps, 'now' | 'run' | 'busy'> {
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
  choice: 'Choose the answer', match: 'Match the pairs', free: 'Type the answer', pinyin: 'Type the pinyin', learn: 'Learn to write', write: 'Write it', translate: 'Translate into Chinese', repeat: 'Repeat after me', convo: 'Answer the questions',
}

const titleOf = (key: string) => getPack().practiceWording.drillTitles[key] ?? TITLES[key]

/** One drill type over the items of a set: one at a time, or as a single page answered in bulk. The first pass of a type is graded; a redo is not. */
export function DrillRun({ set, type, items, catalog, workspace, only, backHref, now, run, busy }: RunProps) {
  const progress = set.progress[type]
  // Fixed when the pass starts: finishing it marks the type done, which must not turn its own summary into a redo.
  const [graded] = useState(() => !only && !progress?.done)
  const scope = useMemo(() => applicable(type, items, set.content).map(item => item.ref), [type, items, set.content])
  const known = useMemo(() => new Set(workspace.knowledge.map(entry => entry.ref)), [workspace.knowledge])
  const [options, setOptions] = useState<Options>(() => ({ ...DEFAULT_OPTIONS, ...(type === 'write' ? loadWriteChoice() : {}) }))
  const build = useCallback((next: Options) => {
    const left = only ?? (graded ? scope.filter(ref => !progress?.results[ref]) : undefined)
    return buildQuestions(type, { setId: set.id, items, catalog, known, content: set.content, options: next, refs: left, ...(set.unwritten ? { written: writtenCharacters(workspace.characterStates) } : {}) })
  // The queue is fixed when a pass starts or an option changes; results arriving later must not reshuffle it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, set.id, items, catalog])
  const [queue, setQueue] = useState<Q[]>(() => build(options))
  const [states, setStates] = useState<Record<string, QState>>({})
  const [index, setIndex] = useState(0)
  const [arrived, setArrived] = useState<string>()
  const [local, setLocal] = useState<Record<string, Mark>>({})
  // A pad result of Needed a hint or Missed is held until Next or Mark correct, so the one recorded result is the final one.
  const held = useRef<Outcome>()
  useEffect(() => () => { const outcome = held.current; if (outcome) for (const [ref, mark] of Object.entries(outcome.marks)) void recordDrillResult(set.id, type, ref, mark, scope) }, [set.id, type, scope])
  const quiz = set.format === 'quiz'
  const counted = useRef(false)
  useEffect(() => {
    if (counted.current || graded || only) return
    counted.current = true
    void recordRedo(set.id, type)
  }, [graded, only, set.id, type])
  const ctx: ViewContext = useMemo(() => ({
    readings: readingIndex([...new Set([...known, ...set.refs])].flatMap(ref => catalog.units.get(ref) ?? [])), pinyinOn: workspace.preferences.pinyin, catalogChars: catalogCharacters(), workspace, catalog, now, run, busy,
  }), [workspace, known, set.refs, catalog, now, run, busy])
  const change = (next: Options) => { if (type === 'write') saveWriteChoice(next); setOptions(next); setQueue(build(next)); setStates({}); setIndex(0) }

  const record = (outcome: Outcome) => {
    setLocal(current => ({ ...current, ...outcome.marks }))
    for (const [ref, mark] of Object.entries(outcome.marks)) {
      void recordDrillResult(set.id, type, ref, mark, scope)
    }
  }
  const patch = (key: string, state: Partial<QState>) => setStates(current => ({ ...current, [key]: { ...(current[key] ?? { status: 'open' as const }), ...state } }))
  const check = (q: Q, answer: unknown) => {
    const result = grade(q, answer)
    if (needsConfirm(q) && !toneOnly(q, answer)) { const suggested = suggestedMark(result); patch(q.key, { answer, status: 'marking', suggested, chosen: suggested }); return }
    if (result === 'self') { patch(q.key, { answer, status: 'marking' }); return }
    patch(q.key, { answer, status: 'done', outcome: result })
    if (!quiz && markable(q, answer, result)) { held.current = result; return }
    record(result)
  }
  const release = () => { const outcome = held.current; held.current = undefined; if (outcome) record(outcome) }
  const markCorrect = (q: Q) => {
    const outcome: Outcome = { marks: Object.fromEntries(q.refs.map(ref => [ref, 'got' as Mark])), correct: true }
    held.current = undefined
    patch(q.key, { status: 'done', outcome })
    record(outcome)
  }
  const mark = (q: Q, chosen: Mark) => {
    const outcome = selfGrade(q, states[q.key]?.answer, chosen)
    patch(q.key, { status: 'done', outcome })
    record(outcome)
  }
  // Typed answers: tapping a mark only selects it; Next (or Confirm marks in a quiz) records the selected one.
  const pick = (q: Q, chosen: Mark) => { if (needsConfirm(q)) patch(q.key, { chosen }); else mark(q, chosen) }
  const confirm = (q: Q) => { const chosen = states[q.key]?.chosen; if (chosen) mark(q, chosen) }
  const answer = (q: Q, value: unknown) => {
    if (quiz || !isAuto(q)) { patch(q.key, { answer: value }); return }
    if (value !== undefined && !states[q.key]?.outcome && states[q.key]?.status !== 'marking') check(q, value)
  }
  const name = drillText(drillType(type), getPack().practiceWording).name

  const toolbar = <div className="dr-toolbar dr-modes-bar" data-assistant-exclude>
    {type === 'meanings' && <>
      <div className="segmented dr-modes" role="group" aria-label="Style">{(['choice', 'free'] as const).map(style =>
        <button key={style} type="button" aria-pressed={options.style === style} onClick={() => change({ ...options, style })}>{style === 'choice' ? 'Choose' : 'Type'}</button>)}</div>
      <div className="segmented dr-modes" role="group" aria-label="Direction">{(['zh-to-en', 'en-to-zh'] as const).map(direction =>
        <button key={direction} type="button" aria-pressed={options.direction === direction} onClick={() => change({ ...options, direction })}>{direction === 'zh-to-en' ? '中 → English' : 'English → 中'}</button>)}</div></>}
    {type === 'write' && <>
      <div className="segmented dr-modes" role="group" aria-label="Writing">{(['pad', 'paper'] as const).map(writeMode =>
        <button key={writeMode} type="button" aria-pressed={options.writeMode === writeMode} onClick={() => change({ ...options, writeMode })}>{writeMode === 'pad' ? 'Handwriting pad' : 'Write elsewhere'}</button>)}</div></>}
  </div>

  const header = <div style={{ display: 'contents' }} data-assistant-exclude>
    <a className="back-link" href={backHref}><ArrowLeft size={16} /> {set.title}</a>
    <div className="card-topline"><span className="eyebrow">{name.toUpperCase()}{graded ? '' : ' · REDO, NOT GRADED'}</span>
      <span className="small muted">{quiz ? 'Quiz' : queue.length ? `Question ${Math.min(index + 1, queue.length)} of ${queue.length}` : ''}</span></div>
  </div>

  if (!queue.length) return <div className="dr" data-assistant-exclude><section className="panel dr-run">{header}<p role="status">{graded && progress && scope.length ? 'Every item in this type already has a result.' : 'There is nothing to practice here.'}</p>
    <div className="dr-actions"><a className="button primary" href={backHref}>Back to the set</a></div></section></div>

  const counts = { got: 0, hint: 0, missed: 0 } as Record<Mark, number>
  for (const value of Object.values(local)) counts[value]++
  const finishedAll = quiz ? queue.every(q => states[q.key]?.status === 'done') : index >= queue.length
  const summary = <section className="panel completion dr-end-panel" aria-label="Pass finished"><CheckCircle2 size={36} className="accent" aria-hidden="true" />
    <h2>{graded ? `${name} done` : 'Redo finished'}</h2>
    <p className="dr-stats"><span><strong>{counts.got}</strong>{MARK_LABEL.got}</span><span><strong>{counts.hint}</strong>{MARK_LABEL.hint}</span><span><strong>{counts.missed}</strong>{MARK_LABEL.missed}</span></p>
    {graded ? <p className="small muted">Recorded in your knowledge and review schedule. {set.progress[type] ? (() => { const s = scoreOf(countMarks({ progress: { [type]: set.progress[type]! } }, [type])); return `Score: ${s.correct} of ${s.total}.` })() : ''}</p>
      : <p className="small muted">Ungraded practice: your score and schedule are unchanged.</p>}
    <div className="button-row"><a className="button primary" href={backHref}>Back to the set</a></div></section>
  if (finishedAll) return <div className="dr" data-assistant-exclude>{header}{summary}</div>

  if (quiz) {
    const answered = queue.filter(q => states[q.key]?.answer !== undefined || states[q.key]?.status === 'marking' || states[q.key]?.status === 'done').length
    const toConfirm = queue.filter(q => needsConfirm(q) && states[q.key]?.status === 'marking')
    const checked = queue.some(q => (states[q.key]?.status ?? 'open') !== 'open')
    const checkAll = () => { for (const q of queue) { const state = states[q.key]; if (state?.answer !== undefined && (state.status ?? 'open') === 'open') check(q, state.answer) } }
    return <div className="dr">{header}{toolbar}
      <ol className="dr-quiz">{queue.map((q, number) => <li key={q.key} className="panel"><div className="dr-qhead"><span className="eyebrow">{number + 1}</span><h2 className="small">{titleOf(q.data.t)}</h2></div>
        <QuestionView q={q} quiz state={states[q.key] ?? { status: 'open' }} ctx={ctx} onAnswer={value => answer(q, value)} onMark={chosen => pick(q, chosen)} /></li>)}</ol>
      <div className="dr-sticky" role="region" aria-label="Quiz progress"><span><strong>{answered} of {queue.length}</strong> answered</span>
        {toConfirm.length > 0 ? <button type="button" className="button primary" disabled={toConfirm.some(q => !states[q.key]?.chosen)} onClick={() => toConfirm.forEach(confirm)}>Confirm marks</button>
          : <button type="button" className="button primary" disabled={answered === 0 || (checked && queue.every(q => (states[q.key]?.status ?? 'open') !== 'open'))} onClick={checkAll}>Check all</button>}</div></div>
  }

  // Handwriting screens stay excluded: selecting there is a drawing gesture, never a request for phrase help.
  const q = queue[index]
  const state = states[q.key] ?? { status: 'open' as const }
  const canCheck = !isAuto(q) && state.status === 'open' && state.answer !== undefined
  return <div className="dr"><section className="panel dr-run">{header}
    <progress aria-label="Progress" value={index} max={queue.length} />
    {toolbar}
    <div className="dr-question" {...(q.data.t === 'write' || q.data.t === 'learn' ? { 'data-assistant-exclude': '' } : {})}>
    <h2 className="small dr-qtitle">{titleOf(q.data.t)}</h2>
    <QuestionView key={q.key} q={q} quiz={false} state={state} ctx={ctx} arrive={arrived === q.key ? 'last' : undefined} onPrevious={type === 'learn' && index > 0 ? () => { setArrived(queue[index - 1].key); setIndex(index - 1) } : undefined} onAnswer={value => answer(q, value)} onMark={chosen => pick(q, chosen)} />
    </div>
    <DrillAnswer q={q} state={state} last={index + 1 >= queue.length} busy={busy} canCheck={canCheck} onCheck={() => check(q, state.answer)} onNext={() => { if (state.status === 'marking') confirm(q); release(); setIndex(index + 1) }} onMarkCorrect={!quiz && markable(q, state.answer, state.outcome) ? () => markCorrect(q) : undefined} />
  </section></div>
}

/** The run's one answer button, the lesson's: Check answer turns into Next (Finish on the last question) in place. Types that check themselves show it once answered; a typed answer waits for its mark. */
function DrillAnswer({ q, state, last, busy, canCheck, onCheck, onNext, onMarkCorrect }: { q: Q; state: QState; last: boolean; busy: boolean; canCheck: boolean; onCheck: () => void; onNext: () => void; /** Pad results of Needed a hint or Missed: the pad's check can be wrong, so the learner may overrule it. */ onMarkCorrect?: () => void }) {
  const confirming = state.status === 'marking' && needsConfirm(q)
  if (isAuto(q) && state.status !== 'done') return null
  const checked = state.status === 'done' || confirming
  const mark = state.status === 'done' ? undefined : state.chosen ?? state.suggested
  const marks = state.status === 'done' ? Object.values(state.outcome?.marks ?? {}) : mark ? [mark] : []
  const hint = marks.includes('hint') && !marks.includes('missed')
  const correct = marks.length > 0 && marks.every(value => value === 'got') || hint
  return <AnswerButton result={checked ? correct : undefined} hint={checked && hint} busy={busy} ready={checked ? !confirming || !!state.chosen : canCheck} onCheck={onCheck} onNext={onNext} nextLabel={last ? 'Finish' : 'Next'} secondary={onMarkCorrect ? <button type="button" className="button secondary" onClick={onMarkCorrect}>Mark correct</button> : undefined} />
}
