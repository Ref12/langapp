import { useEffect, useMemo, useRef, useState } from 'react'
import { getPack } from '../../core/language'
import { activeDisplayForm } from '../../core/forms/display'
import { useDisplaySettings } from '../../components/display-settings'
import { drillText } from '../../core/language/practice-wording'
import { ArrowLeft, ArrowRight, Play } from 'lucide-react'
import { PageHeading, type PageProps } from '../../components/shared'
import { HearButton } from '../../components/assistant/SnippetActions'
import { navigate } from '../../core/routing'
import { savePreferences } from '../../core/learning'
import type { Catalog } from '../../core/study/catalog'
import { readingIndex } from '../../core/study/annotate'
import { DRILLS_LABEL, DRILL_TYPES, type DrillSet } from '../../core/drills/contracts'
import { effectiveContent } from '../../core/drills/content'
import { availability } from './tasks'
import { drillTypeOffered } from '../../core/drills/offered'
import type { ItemInfo } from '../../core/drills/items'
import { createDrillSet, finishEngineRun, recordEngineResult, saveEngineAnswer, setEngineChoice, shortDate } from '../../core/drills/store'
import { itemCount } from '../../core/collections/terms'
import { estimateMinutes } from '../../core/session/plan'
import { planSetSession } from '../../core/session/set-plan'
import { BUILTIN_PRESETS, FORMS_BY_STAGE, SPOKEN_PRESETS } from '../../core/session/presets'
import { loadCustomPresets, saveCustomPreset } from '../../core/session/custom-preset'
import { answerCurrent, currentExercise, currentStage, progressOf, replayRunner, skillsOf, summarise, type RunnerState } from '../../core/session/runner'
import { isFormOffered } from '../../core/session/offered'
import { formLabel } from '../../core/session/form-label'
import { LENGTHS, LENGTH_LABEL, STAGES, STAGE_LABEL, type AnswerMode, type Form, type SessionPlan, type Stage } from '../../core/session/types'
import { ExerciseQuestion, type Outcome } from './EngineQuestion'
import { IntroCard } from './IntroCards'
import { PhraseCounts } from './PhraseItems'
import { HandsFreeSection } from './HandsFreeRows'

const setRoute = (id: string, page = '') => `practice/set/${id}${page ? `/${page}` : ''}`
type Props = PageProps & { set: DrillSet; items: ItemInfo[]; catalog: Catalog }

/** Builds the plan for a set: the same plan for the Start screen's estimate and for the run (it is pure for the seed). */
function usePlan(set: DrillSet, items: ItemInfo[], catalog: Catalog, workspace: PageProps['workspace']) {
  const engine = set.engine!
  const [plan, setPlan] = useState<SessionPlan>()
  const [error, setError] = useState<string>()
  // The form the learner chose to see verbs in (a pack that offers none: nothing, and the words stay as stored).
  const shownForm = activeDisplayForm(getPack(), useDisplaySettings().form)
  const knownKey = workspace.knowledge.map(entry => entry.ref).sort().join('|')
  // Keyed by content: a refreshed list with the same refs must not re-plan (that blanked the card between exercises).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const known = useMemo(() => new Set(workspace.knowledge.map(entry => entry.ref)), [knownKey])
  useEffect(() => {
    let live = true
    void (async () => {
      const built = await planSetSession({ catalog, items, refs: set.refs, known, engine: { preset: engine.preset, length: engine.length, seed: engine.seed }, shown: shownForm })
      if (live) setPlan(built)
    })().catch(reason => { if (live) setError(reason instanceof Error ? reason.message : 'The session could not be planned.') })
    return () => { live = false }
  }, [set.refs, engine.preset, engine.length, engine.seed, items, catalog, known, shownForm])
  return { plan, error, known }
}

export function EngineStart({ set, items, catalog, workspace, run, busy }: Props) {
  const engine = set.engine!
  const { plan, error } = usePlan(set, items, catalog, workspace)
  const [custom, setCustom] = useState(() => loadCustomPresets())
  const [building, setBuilding] = useState(false)
  const content = effectiveContent(set)
  const presets = [...BUILTIN_PRESETS.map(entry => ({ id: entry.id, name: entry.name, blurb: getPack().practiceWording.presetBlurbs[entry.id] ?? entry.blurb })), ...custom.map(entry => ({ id: entry.id, name: entry.name, blurb: 'Your own preset.' }))]
  const active = presets.find(entry => entry.id === engine.preset) ?? presets[0]
  const resumable = !!engine.answers?.length && !!engine.planned && engine.done! < engine.planned
  const counts = plan ? plan.stages.filter(entry => entry.stage !== 'introduce').map(entry => ({ stage: entry.stage, count: entry.exercises.length })) : []
  return <div className="dr engine">
    <a className="back-link" href="#practice"><ArrowLeft size={16} /> {DRILLS_LABEL}</a>
    <PageHeading eyebrow="Practice session" title={set.title}>{set.source === 'phrases' ? <PhraseCounts refs={set.refs} /> : itemCount(set.refs.length)}</PageHeading>
    <section className="panel dr-panel engine-start" aria-labelledby="engine-start">
      <h2 id="engine-start">Ready when you are</h2>
      {engine.lastRun && <p className="engine-last-run" role="status">Last run: {engine.lastRun.correct} of {engine.lastRun.total} right, {shortDate(engine.lastRun.at)}</p>}
      {resumable && <p className="engine-resume" role="status"><strong>In progress: {engine.done} of {engine.planned}.</strong> Resume where you left off, or change the preset or length to start a fresh run.</p>}
      <p className="small muted">{set.source === 'phrases' ? 'Phrases are practiced as whole sentences: translating, building, filling a gap, listening. None is added to your knowledge set. Nothing to choose; press Start.' : 'The app picks the exercises and their order: recognise, recall, produce, then use the words in sentences. Nothing to choose; press Start.'}</p>
      <div className="engine-options">
        <div><span className="eyebrow">Preset</span>
          <div className="segmented engine-presets" role="group" aria-label="Preset">
            {presets.map(entry => <button key={entry.id} type="button" disabled={busy} aria-pressed={engine.preset === entry.id} title={entry.blurb} onClick={() => void run(async () => { await setEngineChoice(set.id, { preset: entry.id }) })}>{entry.name}</button>)}</div>
          <p className="small muted">{active.blurb}</p></div>
        <div><span className="eyebrow">Length</span>
          <div className="segmented" role="group" aria-label="Length">
            {LENGTHS.map(value => <button key={value} type="button" disabled={busy} aria-pressed={engine.length === value} onClick={() => void run(async () => { await setEngineChoice(set.id, { length: value }) })}>{LENGTH_LABEL[value]}</button>)}</div></div>
          <div><span className="eyebrow">Sound</span>
            <label className="toggle engine-autoplay"><input type="checkbox" role="switch" checked={workspace.preferences.promptAutoPlay === true} disabled={busy} onChange={event => { const on = event.target.checked; void run(async () => { await savePreferences({ promptAutoPlay: on }) }) }} /> Auto-play sentences</label>
            <p className="small muted">Plays the whole sentence by itself when you answer. Off by default.</p></div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!plan && !error && <p className="small muted" role="status">Planning the session…</p>}
      {plan && <p className="engine-estimate" role="status"><strong>{plan.total} exercises</strong> · about {estimateMinutes(plan.total)} min · {counts.map(entry => `${STAGE_LABEL[entry.stage]} ${entry.count}`).join(' · ')}</p>}
      {plan && plan.uncovered.length > 0 && <p className="small muted">{plan.uncovered.length} {plan.uncovered.length === 1 ? 'item has' : 'items have'} no exercise in the bank yet{content.state === 'running' ? ' (sentences are still being written)' : ''}.</p>}
      <div className="button-row">
        <button type="button" className="button primary" aria-label={resumable ? 'Resume session' : 'Start session'} disabled={busy || !plan || plan.total === 0} onClick={() => navigate(setRoute(set.id, 'engine'))}><Play size={16} /> {resumable ? 'Resume' : set.status === 'completed' ? 'Back to session' : 'Start'}</button>
        {resumable && <button type="button" className="button secondary" disabled={busy} onClick={() => void run(async () => { await setEngineChoice(set.id, {}) })}>Start over</button>}
        <button type="button" className="button secondary" onClick={() => setBuilding(!building)} aria-expanded={building}>Build your own preset</button>
        <a className="button secondary" href={`#${setRoute(set.id, 'intro')}`}>{set.source === 'new' || set.source === 'lesson' ? 'Intro cards' : 'Items'}</a></div>
      {building && <PresetBuilder onSave={preset => { setCustom(saveCustomPreset(preset)); setBuilding(false); void run(async () => { await setEngineChoice(set.id, { preset: preset.id }) }) }} />}
    </section>
    <HandsFreeSection set={set} run={run} busy={busy} />
    {set.source !== 'phrases' && <SkillFocus set={set} items={items} />}
  </div>
}

/** The advanced builder: tick stages and exercise forms, name it, save it. */
function PresetBuilder({ onSave }: { onSave: (preset: { id: string; name: string; forms: Form[]; stages: Stage[] }) => void }) {
  const [name, setName] = useState('My preset')
  const [stages, setStages] = useState<Stage[]>(['introduce', 'recognise', 'recall', 'produce', 'use'])
  const [forms, setForms] = useState<Form[]>(['choice', 'recall', 'tiles', 'gap', 'translate-zh-en'])
  const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter(item => item !== value) : [...list, value]
  const every = [...new Set(STAGES.flatMap(stage => FORMS_BY_STAGE[stage]))].filter(form => form !== 'intro' && isFormOffered(form, getPack()))
  return <fieldset className="engine-builder"><legend>Your own preset</legend>
    <label>Name<input value={name} maxLength={40} onChange={event => setName(event.target.value)} /></label>
    <div role="group" aria-label="Stages">{STAGES.map(stage => <label key={stage} className="toggle"><input type="checkbox" checked={stages.includes(stage)} onChange={() => setStages(toggle(stages, stage))} /> {STAGE_LABEL[stage]}</label>)}</div>
    <div role="group" aria-label="Exercise types">{every.map(form => <label key={form} className="toggle"><input type="checkbox" checked={forms.includes(form)} onChange={() => setForms(toggle(forms, form))} /> {formLabel(form)}</label>)}</div>
    <button type="button" className="button primary" disabled={!name.trim() || !stages.length} onClick={() => onSave({ id: `custom-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'preset'}`, name: name.trim(), forms, stages })}>Save preset</button>
  </fieldset>
}

/** The writing drills (Learn to write, Write it), kept as a focus outside the session. The other single-skill drills are not listed; their routes still open. */
const WRITING_DRILLS: readonly string[] = ['learn', 'write']
function SkillFocus({ set, items }: { set: DrillSet; items: ItemInfo[] }) {
  const content = effectiveContent(set)
  const types = DRILL_TYPES.filter(entry => WRITING_DRILLS.includes(entry.id) && drillTypeOffered(entry, getPack()))
  if (!types.length) return null
  return <section className="panel dr-panel" aria-labelledby="engine-skill"><h2 id="engine-skill">Writing</h2>
    <p className="small muted">Writing practice on its own, outside the session.</p>
    <ul className="dr-rows">{types.map(entry => { const avail = availability(entry.id, items, content); const ready = avail.state === 'ready'
      return <li key={entry.id}><div><strong>{drillText(entry, getPack().practiceWording).name}</strong><span className="small muted">{ready ? drillText(entry, getPack().practiceWording).blurb : avail.message}</span></div>
        <span className="dr-actions">{ready ? <a className="icon-button" href={`#${setRoute(set.id, `run/${entry.id}`)}`} aria-label={`Practice ${entry.name}`} title="Practice"><Play size={18} /></a> : <button type="button" className="icon-button" disabled aria-label={`${entry.name} is not available`}><Play size={18} /></button>}</span></li> })}</ul></section>
}

export function EngineRun({ set, items, catalog, workspace, run, busy, now }: Props) {
  const engine = set.engine!
  const { plan, error, known } = usePlan(set, items, catalog, workspace)
  const [state, setState] = useState<RunnerState>()
  const [intro, setIntro] = useState(0)
  useEffect(() => { if (plan && !state) setState(replayRunner(plan, engine.answers ?? [])) }, [plan, state, engine.answers])
  const readings = useMemo(() => readingIndex([...new Set([...known, ...set.refs])].flatMap(ref => { const unit = catalog.units.get(ref); return unit ? [unit] : [] })), [known, set.refs, catalog])
  const [pinyin, setPinyin] = useState(workspace.preferences.pinyin)
  const forms = useMemo(() => new Set([...[...catalog.units.values()].flatMap(unit => unit.kind === 'vocabulary' && (known.has(unit.ref) || set.refs.includes(unit.ref)) ? [unit.record.ch] : []), ...getPack().functionWords]), [catalog, known, set.refs])
  const characters = useMemo(() => new Set([...forms].flatMap(form => Array.from(form))), [forms])
  const finished = useRef(false)
  const score = state ? summarise(state.log) : undefined
  useEffect(() => { if (state?.done && state.log.length && score && !finished.current) { finished.current = true; void run(async () => { await finishEngineRun(set.id, score) }) } }, [state, score, set.id, run])
  if (error) return <div className="notice error" role="alert">{error}</div>
  if (!plan || !state) return <div className="opening-workspace" role="status">Planning the session…</div>
  const spoken = SPOKEN_PRESETS.includes(engine.preset)
  const mode: AnswerMode = spoken ? 'speak' : workspace.preferences.answerMode ?? 'type'
  const ctx = { readings, pinyin, speak: workspace.preferences.tileAutoSpeak !== false, autoPlay: workspace.preferences.promptAutoPlay === true, busy, forms, characters, mode, writing: workspace.preferences.practiseWriting !== false, chinese: (ref: string) => { const unit = catalog.units.get(ref); return unit?.kind === 'vocabulary' ? unit.record.ch : ref } }
  const exercise = currentExercise(state)
  const stage = currentStage(state)
  const advance = (correct: boolean, refsOverride?: string[], hint?: boolean) => {
    const step = answerCurrent(state, correct)
    setState(step.state)
    const progress = progressOf(step.state)
    if (!step.state.done) void saveEngineAnswer(set.id, correct, progress.done, progress.total).catch(reason => console.error('Saving the run failed.', reason))
    if (step.graded && exercise) {
      // A first attempt records each item it covers once per skill; a match records every pair (right unless that item was missed).
      const missed = new Set(refsOverride ?? [])
      void (async () => { for (const ref of exercise.refs) await recordEngineResult(set.id, ref, skillsOf(exercise.form), exercise.form, exercise.form === 'match' ? !missed.has(ref) : correct, hint) })().catch(reason => console.error('Recording the result failed.', reason))
    }
  }
  if (state.done) return <EngineSummary set={set} state={state} items={items} busy={busy} run={run} />
  const total = plan.stages.reduce((sum, entry) => sum + entry.exercises.length, 0)
  const doneCount = state.log.filter(attempt => attempt.round === 0).length
  return <div className="dr engine engine-run">
    <a className="back-link" href={`#${setRoute(set.id)}`}><ArrowLeft size={16} /> {set.title}</a>
    <div className="engine-progress"><span className="eyebrow">{stage ? STAGE_LABEL[stage] : ''}{exercise && exercise.round > 0 ? ' · another try' : ''}</span>
      <progress aria-label="Session progress" value={Math.min(doneCount, total)} max={Math.max(1, total)} /><span className="small muted">{Math.min(doneCount, total)} of {total}</span>
      <button type="button" className="button secondary small engine-pinyin" aria-pressed={pinyin} onClick={() => setPinyin(!pinyin)}>{pinyin ? getPack().practiceWording.hideReadings : getPack().practiceWording.showReadings}</button></div>
    <section className="panel practice-card" aria-live="polite" data-form={exercise?.form} data-answer-lang={exercise && 'answerLang' in exercise ? exercise.answerLang : undefined}>
      {exercise?.form === 'intro' && (() => { const item = items.find(entry => entry.ref === exercise.refs[0]); return <>
        <p className="engine-instruction small" data-instruction="intro">Learn the new word <span className="muted">· {intro + 1}</span></p>
        {item && <IntroCard item={item} catalog={catalog} workspace={workspace} now={now} run={run} busy={busy} route={setRoute(set.id, 'engine')} />}
        <div className="answer-actions"><span aria-hidden="true" /><button type="button" className="button primary" onClick={() => { setIntro(intro + 1); advance(true) }}>Got it <ArrowRight size={16} /></button></div></> })()}
      {exercise?.form === 'repeat' && <>
        <p className="engine-instruction small" data-instruction="repeat">Say it after the audio</p><p className="small muted">Nothing is graded.</p>
        <p className="practice-prompt native" lang={getPack().learningTag}>{exercise.zh}</p><p className="small">{exercise.py}</p><p lang="en">{exercise.en}</p>
        <p><HearButton text={exercise.zh} locale={getPack().speechLocale} kind="sentence" label="Hear it" /></p>
        <div className="answer-actions"><span aria-hidden="true" /><button type="button" className="button primary" onClick={() => advance(true)}>Next <ArrowRight size={16} /></button></div></>}
      {exercise && exercise.form !== 'intro' && exercise.form !== 'repeat' && <ExerciseQuestion key={exercise.id} exercise={exercise} ctx={ctx} onDone={(outcome: Outcome) => advance(outcome.correct, outcome.missed, outcome.hint)} />}
    </section>
  </div>
}

function EngineSummary({ set, state, items, busy, run }: { set: DrillSet; state: RunnerState; items: ItemInfo[]; busy: boolean; run: PageProps['run'] }) {
  const summary = summarise(state.log)
  const name = (ref: string) => items.find(item => item.ref === ref)
  const missed = summary.missedRefs.length
  return <div className="dr engine engine-summary">
    <a className="back-link" href="#practice"><ArrowLeft size={16} /> {DRILLS_LABEL}</a>
    <PageHeading eyebrow="Session complete" title={set.title}>{summary.correct} of {summary.total} right the first time{set.source === 'phrases' ? <> · <PhraseCounts refs={set.refs} /></> : null}</PageHeading>
    <section className="panel dr-panel" aria-labelledby="engine-stages"><h2 id="engine-stages">By stage</h2>
      <ul className="dr-rows">{summary.stages.map(entry => <li key={entry.stage}><div><strong>{STAGE_LABEL[entry.stage]}</strong><span className="small muted">{entry.correct} of {entry.total} right</span></div>
        <progress aria-label={`${STAGE_LABEL[entry.stage]} score`} value={entry.correct} max={Math.max(1, entry.total)} /></li>)}</ul>
      {summary.retried > 0 && <p className="small muted">{summary.retried} {summary.retried === 1 ? 'exercise was' : 'exercises were'} tried again. Second tries are not scored.</p>}</section>
    <section className="panel dr-panel" aria-labelledby="engine-missed"><h2 id="engine-missed">{missed ? 'To look at again' : 'No misses'}</h2>
      {missed > 0 ? <ul className="dr-rows">{summary.missedRefs.map(ref => { const item = name(ref); return <li key={ref}><div><strong lang={getPack().learningTag}>{item?.zh ?? ref}</strong><span className="small muted">{[item?.py, item?.en].filter(Boolean).join(' · ')}</span></div></li> })}</ul> : <p className="small muted">Every item was right on its first try.</p>}</section>
    <section className="panel dr-panel engine-next" aria-labelledby="engine-next"><h2 id="engine-next">What next?</h2>
      <div className="button-row engine-next-actions">
        <button type="button" className="button primary" disabled={busy} onClick={() => void run(async () => { await setEngineChoice(set.id, {}); navigate(setRoute(set.id)) })}>Back to session</button>
        {missed > 0 && <button type="button" className="button secondary" disabled={busy} onClick={() => void run(async () => { navigate(setRoute(await createDrillSet({ kind: 'refs', refs: summary.missedRefs, origin: { kind: 'drill', id: set.id } }), '')) })}>{set.source === 'phrases' ? `Practice the missed phrases (${missed})` : `Practice the missed items (${missed})`}</button>}
        <a className="button secondary" href="#practice">New practice set</a>
        <a className="button secondary" href="#practice">Back to Practice</a></div>
      <p className="small muted">Back to session opens the Start screen, where you can change the preset and length.</p></section>
  </div>
}
