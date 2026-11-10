import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { PageHeading, type PageProps } from '../components/shared'
import { ParallelHear } from '../components/ParallelHear'
import { loadParallel, glossOf, type ParallelData } from '../core/parallel/data'
import { parallelLessonId } from '../core/language/refs'
import type { ParallelLanguage } from '../core/language/ids'
import { addParallelKnowledge, parallelDue, parallelKnown, recordParallelResult } from '../core/parallel/practice'
import { itemsUpTo, lessonItems, planParallel, type ParallelItem } from '../core/parallel/session'
import { languageName } from '../core/characters/language'
import { answerCurrent, currentExercise, currentStage, progressOf, startRunner, summarise, type RunnerState } from '../core/session/runner'
import { STAGE_LABEL, type SessionPlan } from '../core/session/types'
import { ChoiceQuestion, ConjugateQuestion, FormPickQuestion, ListenQuestion, MatchQuestion, PARALLEL_INSTRUCTION, TilesQuestion, Written, type ParallelContext } from './ParallelQuestions'

const EARLIER = 4

/** The items of a Japanese or Korean session: a lesson's own items then earlier ones to review, or the language's due items. */
async function sessionRefs(data: ParallelData, language: ParallelLanguage, lesson: number | undefined, now: number): Promise<{ refs: string[]; lessonNumber: number }> {
  const all = itemsUpTo(data, language, 87)
  const due = await parallelDue(language, now)
  if (lesson === undefined) {
    const refs = due.map(card => card.ref).filter(ref => all.has(ref)).slice(0, 12)
    return { refs, lessonNumber: Math.max(1, ...refs.map(ref => all.get(ref)!.lesson)) }
  }
  const own = lessonItems(data, language, data.lessons.find(item => item.number === lesson)!).map(item => item.ref)
  const known = await parallelKnown(language)
  const earlier = [...new Set([...due.map(card => card.ref), ...[...known].reverse()])].filter(ref => all.has(ref) && all.get(ref)!.lesson < lesson && !own.includes(ref)).slice(0, EARLIER)
  return { refs: [...own, ...earlier], lessonNumber: lesson }
}

/** Practise a Japanese or Korean lesson (or the language's reviews): the same staged session as Chinese, meet, recognise, use. */
export function ParallelPractice({ busy, now, language, lesson }: PageProps & { language: ParallelLanguage; lesson?: number }) {
  const [data, setData] = useState<ParallelData>()
  const [plan, setPlan] = useState<SessionPlan>()
  const [state, setState] = useState<RunnerState>()
  const [error, setError] = useState('')
  const [intro, setIntro] = useState(0)
  const recorded = useRef(new Set<string>())
  useEffect(() => {
    let live = true
    void (async () => {
      const loaded = await loadParallel(language)
      const { refs, lessonNumber } = await sessionRefs(loaded, language, lesson, now)
      const known = await parallelKnown(language)
      const built = planParallel({ language, data: loaded, intent: lesson === undefined ? 'review' : 'lesson', lessonNumber, refs, known, length: 'standard', seed: Math.floor(Math.random() * 2 ** 31) })
      if (live) { setData(loaded); setPlan(built); setState(startRunner(built)) }
    })().catch(reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, lesson])
  const readings = useMemo(() => new Map([...Object.values(data?.entries ?? {}).flatMap(entry => entry.reading ? [[entry.target, entry.reading] as const] : []), ...Object.values(data?.formItems ?? {}).flatMap(item => item.reading ? [[item.surface, item.reading] as const] : [])]), [data])
  const name = languageName[language]
  const back = lesson === undefined ? '#lessons' : `#lessons/${language}/${lesson}`
  if (error) return <div className="notice error" role="alert"><p>The {name} practice could not start. {error}</p></div>
  if (!data || !plan || !state) return <div className="opening-workspace" role="status">Planning the session…</div>
  const ctx: ParallelContext = { language, readings, busy }
  const exercise = currentExercise(state)
  const stage = currentStage(state)
  const title = lesson === undefined ? `${name} review` : `${name}, lesson ${lesson}`
  const instruction = PARALLEL_INSTRUCTION(language)
  const advance = (correct: boolean, missed: string[] = []) => {
    if (!exercise) return
    const step = answerCurrent(state, correct)
    setState(step.state)
    if (step.graded) for (const ref of exercise.refs) {
      const right = exercise.form === 'match' ? !missed.includes(ref) : correct
      if (recorded.current.has(ref)) continue
      recorded.current.add(ref)
      void recordParallelResult(ref, right).catch(reason => console.error('Recording the result failed.', reason))
    }
  }
  if (!plan.total) return <div className="dr engine"><a className="back-link" href={back}><ArrowLeft size={16} /> {title}</a><PageHeading eyebrow="Practice" title={title}>Nothing to practise yet.</PageHeading></div>
  if (state.done) {
    const score = summarise(state.log)
    return <div className="dr engine engine-summary">
      <a className="back-link" href={back}><ArrowLeft size={16} /> {title}</a>
      <PageHeading eyebrow="Session complete" title={title}>{score.correct} of {score.total} right the first time</PageHeading>
      <section className="panel dr-panel" aria-labelledby="parallel-stages"><h2 id="parallel-stages">By stage</h2>
        <ul className="dr-rows">{score.stages.map(entry => <li key={entry.stage}><div><strong>{STAGE_LABEL[entry.stage]}</strong><span className="small muted">{entry.correct} of {entry.total} right</span></div></li>)}</ul></section>
      <div className="button-row"><a className="button primary" href={back}>Back</a></div>
    </div>
  }
  const progress = progressOf(state)
  const items = itemsUpTo(data, language, 87)
  const item = exercise?.form === 'intro' ? items.get(exercise.refs[0]) as ParallelItem | undefined : undefined
  return <div className="dr engine engine-run parallel-practice">
    <a className="back-link" href={back}><ArrowLeft size={16} /> {title}</a>
    <div className="engine-progress"><span className="eyebrow">{stage ? STAGE_LABEL[stage] : ''}{exercise && exercise.round > 0 ? ' · another try' : ''}</span>
      <progress aria-label="Session progress" value={Math.min(progress.done, progress.total)} max={Math.max(1, progress.total)} /><span className="small muted">{Math.min(progress.done, progress.total)} of {progress.total}</span></div>
    <section className="panel practice-card" aria-live="polite" data-form={exercise?.form}>
      {exercise && <p className="engine-instruction small" data-instruction={exercise.form}>{instruction[exercise.form as keyof typeof instruction]}{exercise.form === 'intro' && <span className="muted"> · {intro + 1}</span>}</p>}
      {exercise?.form === 'intro' && item && <>
        <article className="word-card study-unit-card parallel-word"><div className="phrase-row"><div className="phrase-row-text">
          <h3 className="parallel-form" lang={language}>{item.kind !== 'grammar' ? <Written text={item.target} ctx={ctx} /> : item.target}</h3>
          <p className="word-meaning">{item.kind === 'word' ? glossOf(item) : item.english}</p></div>
          {item.kind !== 'grammar' && <ParallelHear text={item.target} language={language} label={`Hear ${item.target}`} actions={{ meaning: glossOf(item), title: `${name} word`, route: lesson === undefined ? `lessons/${language}/review` : `lessons/${language}/${lesson}` }} />}</div></article>
        <div className="answer-actions"><span aria-hidden="true" /><button type="button" className="button primary" onClick={() => { setIntro(intro + 1); void addParallelKnowledge(exercise.refs); advance(true) }}>Got it <ArrowRight size={16} /></button></div></>}
      {exercise?.form === 'choice' && <ChoiceQuestion key={exercise.id + exercise.round} exercise={exercise} ctx={ctx} onDone={done => advance(done.correct)} />}
      {exercise?.form === 'match' && <MatchQuestion key={exercise.id + exercise.round} exercise={exercise} ctx={ctx} onDone={done => advance(done.correct, done.missed)} />}
      {exercise?.form === 'listen-pick' && <ListenQuestion key={exercise.id + exercise.round} exercise={exercise} ctx={ctx} onDone={done => advance(done.correct)} />}
      {exercise?.form === 'conjugate' && <ConjugateQuestion key={exercise.id + exercise.round} exercise={exercise} ctx={ctx} onDone={done => advance(done.correct)} />}
      {exercise?.form === 'form-pick' && <FormPickQuestion key={exercise.id + exercise.round} exercise={exercise} ctx={ctx} onDone={done => advance(done.correct)} />}
      {exercise?.form === 'tiles' && <TilesQuestion key={exercise.id + exercise.round} exercise={exercise} ctx={ctx} onDone={done => advance(done.correct)} />}
    </section>
  </div>
}

export const practiseRoute = (language: ParallelLanguage, lesson: number): string => `#lessons/${language}/${lesson}/practise`
export { parallelLessonId }
