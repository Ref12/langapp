import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { formsEngine } from '../forms'
import { loadParallel, resetParallel, type ParallelData } from './data'
import { type ParallelLanguage } from '../language/ids'
import { taughtFormIds } from '../forms/conjugate'
import { buildFormPick, inflectedTokens, taughtGrammar } from './conjugate'
import { addParallelKnowledge, parallelDue, parallelKnown, recordParallelResult } from './practice'
import { conjugateFor, itemsUpTo, lessonItems, planParallel, usablePhrases } from './session'
import { createRng } from '../study/local-exercises'
import { parseParallelRef } from '../language/refs'
import type { ConjugateItem, FormPickItem, SessionExercise } from '../session/types'

beforeEach(async () => { resetParallel(); await db.delete(); await db.open(); await initializeWorkspace() })

const exercisesOf = (plan: ReturnType<typeof planParallel>): SessionExercise[] => plan.stages.flatMap(stage => stage.exercises)
const planAt = (language: ParallelLanguage, data: ParallelData, lessonNumber: number, seed = 5) => {
  const refs = [...itemsUpTo(data, language, lessonNumber).values()].map(item => item.ref)
  return planParallel({ language, data, intent: 'review', lessonNumber, refs, known: new Set(refs), length: 'long', seed })
}

describe.each<ParallelLanguage>(['ja', 'ko'])('%s word forms in sessions', language => {
  it('only asks forms whose grammar point the lessons so far have taught', async () => {
    const data = await loadParallel(language)
    const engine = formsEngine(language)
    for (const lessonNumber of [8, 30, 87]) {
      const taught = taughtGrammar(data, lessonNumber)
      const exercises = exercisesOf(planAt(language, data, lessonNumber))
      const conjugates = exercises.filter((exercise): exercise is ConjugateItem => exercise.form === 'conjugate')
      for (const exercise of conjugates) {
        const irregularItem = exercise.refs[0].includes(':f:')
        if (irregularItem) continue
        expect(taughtFormIds(language, exercise.cls, taught)).toContain(exercise.formId)
        expect(taught.has(engine.grammarOf(exercise.formId, exercise.cls)!)).toBe(true)
        expect(exercise.tiles.join('')).toBe(exercise.answer)
      }
      for (const exercise of exercises.filter((item): item is FormPickItem => item.form === 'form-pick')) {
        const right = exercise.options[exercise.answer]
        expect(exercise.options).toHaveLength(4)
        expect(new Set(exercise.options.map(option => option.lemma + option.label)).size).toBe(4)
        expect(right.label).toBeTruthy()
      }
    }
  })

  it('places form to meaning in recognise and conjugate in use, with their instruction lines', async () => {
    const data = await loadParallel(language)
    const plan = planAt(language, data, 87)
    const stageOf = (form: string) => plan.stages.find(stage => stage.exercises.some(exercise => exercise.form === form))?.stage
    expect(stageOf('form-pick')).toBe('recognise')
    expect(stageOf('conjugate')).toBe('use')
  })

  it('conjugates only a form of the class the lessons so far have taught', async () => {
    const data = await loadParallel(language)
    const exercises = exercisesOf(planAt(language, data, 1))
    const taught = taughtGrammar(data, 1)
    for (const exercise of exercises) if (exercise.form === 'conjugate') expect(taughtFormIds(language, exercise.cls, taught)).toContain(exercise.formId)
  })

  it('form to meaning: the shown form is confirmed by the analyser for the right option', async () => {
    const data = await loadParallel(language)
    const engine = formsEngine(language)
    const tokens = inflectedTokens(language, data, usablePhrases(data, 87))
    expect(tokens.length).toBeGreaterThan(300)
    const pool = Object.keys(data.entries).filter(id => data.entries[id].class)
    const rng = createRng(11)
    let built = 0
    for (const token of tokens.slice(0, 80)) {
      const pick = buildFormPick(language, data, token, pool, rng)
      if (!pick) continue
      built++
      const entry = data.entries[token.entryId]
      const right = pick.options[pick.answer]
      expect(right.lemma).toBe(entry.target)
      expect(engine.analyse(pick.surface, entry.target, entry.class!, entry.reading ? { reading: entry.reading } : {})).toContain(right.formId)
    }
    expect(built).toBeGreaterThan(40)
  })

  it('reviews irregular form items: they are lesson items, practised and due on their own', async () => {
    const data = await loadParallel(language)
    const formRefs = Object.keys(data.formItems ?? {})
    expect(formRefs.length).toBeGreaterThan(5)
    for (const ref of formRefs) expect(parseParallelRef(ref)?.kind).toBe('f')
    const lesson = data.lessons.find(item => item.forms?.length)!
    const own = lessonItems(data, language, lesson).filter(item => item.kind === 'form')
    expect(own.length).toBeGreaterThan(0)
    const ref = own[0].ref
    const plan = planParallel({ language, data, intent: 'lesson', lessonNumber: lesson.number, refs: [ref], known: new Set(), length: 'standard', seed: 2 })
    const mine = exercisesOf(plan).filter(exercise => exercise.refs.includes(ref))
    expect(mine.map(exercise => exercise.form)).toContain('intro')
    const conjugate = mine.find((exercise): exercise is ConjugateItem => exercise.form === 'conjugate')
    expect(conjugate?.irregular).toBe(true)
    expect(conjugate?.itemRef).toBe(ref)
    await recordParallelResult(ref, true, false, 1000)
    expect((await parallelKnown(language)).has(ref)).toBe(true)
    expect((await parallelDue(language, 1000 + 365 * 86400000)).map(card => card.ref)).toContain(ref)
    await addParallelKnowledge([ref])
    const review = planParallel({ language, data, intent: 'review', lessonNumber: 87, refs: [ref], known: new Set([ref]), length: 'standard', seed: 3 })
    expect(exercisesOf(review).some(exercise => exercise.refs.includes(ref) && (exercise.form === 'conjugate' || exercise.form === 'form-pick'))).toBe(true)
  })
})

describe('the Japanese irregular conjugate exercise', () => {
  it('builds the kuru item with the irregular rule', async () => {
    const data = await loadParallel('ja')
    const item = [...itemsUpTo(data, 'ja', 87).values()].find(entry => entry.ref === 'ja:f:\u304F\u308B:masu')!
    const made = conjugateFor('ja', data, item, taughtGrammar(data, 87), createRng(1))!
    expect(made.answer).toBe('\u304D\u307E\u3059')
    expect(made.irregular).toBe(true)
    expect(made.itemRef).toBe('ja:f:\u304F\u308B:masu')
    expect(made.rule).toContain('\u2192')
  })
})
