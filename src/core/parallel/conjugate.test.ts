import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { formsEngine } from '../forms'
import { loadParallel, resetParallel, type ParallelData, type ParallelLanguage } from './data'
import { buildConjugate, buildFormPick, gradeConjugate, inflectedTokens, ruleLine, taughtFormIds, taughtGrammar, wordFormsTable } from './conjugate'
import { addParallelKnowledge, parallelDue, parallelKnown, recordParallelResult } from './practice'
import { conjugateFor, itemsUpTo, lessonItems, planParallel, usablePhrases } from './session'
import { createRng } from '../study/local-exercises'
import { loadDictionary } from '../dictionary/other'
import { parseParallelRef } from './refs'
import type { ConjugateItem, FormPickItem, SessionExercise } from '../session/types'

beforeEach(async () => { resetParallel(); await db.delete(); await db.open(); await initializeWorkspace() })

const exercisesOf = (plan: ReturnType<typeof planParallel>): SessionExercise[] => plan.stages.flatMap(stage => stage.exercises)
const planAt = (language: ParallelLanguage, data: ParallelData, lessonNumber: number, seed = 5) => {
  const refs = [...itemsUpTo(data, language, lessonNumber).values()].map(item => item.ref)
  return planParallel({ language, data, intent: 'review', lessonNumber, refs, known: new Set(refs), length: 'long', seed })
}

describe('conjugate grading', () => {
  const surface = { surface: '\u52C9\u5F37\u3057\u307E\u305B\u3093', reading: '\u3079\u3093\u304D\u3087\u3046\u3057\u307E\u305B\u3093' }
  it('is right for the exact form and wrong for anything else (Japanese)', () => {
    expect(gradeConjugate('ja', '\u52C9\u5F37\u3057\u307E\u305B\u3093', surface)).toBe('right')
    expect(gradeConjugate('ja', '\u52C9\u5F37\u3057\u307E\u3059', surface)).toBe('wrong')
    expect(gradeConjugate('ja', '\u52C9\u5F37\u3057\u307E\u305B\u3093 ', surface)).toBe('wrong')
  })
  it('is almost only for a spacing difference in Korean', () => {
    const future = { surface: '\uC77C\uD560 \uAC70\uC608\uC694' }
    expect(gradeConjugate('ko', '\uC77C\uD560 \uAC70\uC608\uC694', future)).toBe('right')
    expect(gradeConjugate('ko', '\uC77C\uD560\uAC70\uC608\uC694', future)).toBe('almost')
    expect(gradeConjugate('ko', '\uC77C\uD560 \uAC70\uC608\uC694\uC694', future)).toBe('wrong')
    expect(gradeConjugate('ko', '\uC77C\uD574\uC694', { surface: '\uC77C\uD574\uC694' })).toBe('right')
  })
  it('builds the pieces of the exact answer, with the rule and distractor endings of other taught forms', () => {
    const built = buildConjugate('ja', '\u66F8\u304F', 'godan-ku', 'masu', { reading: '\u304B\u304F', taught: ['masu', 'masen', 'mashita'] })!
    expect(built.pieces.join('')).toBe('\u66F8\u304D\u307E\u3059')
    expect(built.answer).toEqual({ surface: '\u66F8\u304D\u307E\u3059', reading: '\u304B\u304D\u307E\u3059' })
    expect(built.rule).toBe('godan \u304F: \u304F \u2192 \u304D + \u307E\u3059')
    expect(built.distractors.length).toBeGreaterThan(0)
    expect(built.distractors).not.toContain('\u307E\u3059')
    expect(built.irregular).toBe(false)
    expect(ruleLine('ko', '\uAC00\uB2E4', 'regular-vowel', 'haeyo')).toMatch(/stem \+ \uC544\/\uC5B4 \+ \uC694/)
  })
})

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

describe('the dictionary word forms table', () => {
  const lookup = async (language: ParallelLanguage, form: string, reading?: string) => {
    const dictionary = await loadDictionary(language)
    return dictionary.words.find(word => word.form === form && (!reading || word.reading === reading))!
  }
  const table = async (language: ParallelLanguage, form: string, reading?: string, grammar: string[] = []) => {
    const word = await lookup(language, form, reading)
    expect(word.class).toBeTruthy()
    return { word, rows: wordFormsTable(language, word.form, word.class!, word.reading || undefined, new Set(grammar)) }
  }
  it.each<[ParallelLanguage, string, string | undefined, string, string]>([
    ['ja', '\u52C9\u5F37\u3059\u308B', undefined, 'masen', '\u52C9\u5F37\u3057\u307E\u305B\u3093'],
    ['ja', '\u6765\u308B', '\u304F\u308B', 'masu', '\u6765\u307E\u3059'],
    ['ja', '\u884C\u304F', '\u3044\u304F', 'te', '\u884C\u3063\u3066'],
    ['ko', '춥다', undefined, 'haeyo', '\uCD94\uC6CC\uC694'],
    ['ko', '\uB4E3\uB2E4', undefined, 'haeyo', '\uB4E4\uC5B4\uC694'],
    ['ko', '\uD558\uB2E4', undefined, 'haeyo', '\uD574\uC694'],
  ])('lists every form of %s %s', async (language, form, reading, formId, surface) => {
    const { word, rows } = await table(language, form, reading)
    const ids = formsEngine(language).formIds(word.class!)
    expect(rows.map(row => row.formId).sort()).toEqual(ids.filter(id => formsEngine(language).forms(word.form, word.class!, id, word.reading ? { reading: word.reading } : {})).sort())
    expect(rows.find(row => row.formId === formId)?.surface).toBe(surface)
    expect(rows.every(row => row.label && row.surface)).toBe(true)
  })
  it('puts taught forms first and marks irregular cells with their reading', async () => {
    const kuru = await table('ja', '\u6765\u308B', '\u304F\u308B', ['ja-n5-g027'])
    expect(kuru.rows[0].formId).toBe('teimasu')
    expect(kuru.rows[0].taught).toBe(true)
    const firstUntaught = kuru.rows.findIndex(row => !row.taught)
    expect(kuru.rows.slice(0, firstUntaught).every(row => row.taught)).toBe(true)
    expect(kuru.rows.slice(firstUntaught).every(row => !row.taught)).toBe(true)
    const masu = kuru.rows.find(row => row.formId === 'masu')!
    expect(masu.irregular).toBe(true)
    expect(masu.reading).toBe('\u304D\u307E\u3059')
    const iku = await table('ja', '\u884C\u304F', '\u3044\u304F')
    expect(iku.rows.find(row => row.formId === 'te')?.irregular).toBe(true)
    expect(iku.rows.find(row => row.formId === 'masu')?.irregular).toBe(false)
    const kiku = await table('ko', '\uB4E3\uB2E4')
    expect(kiku.rows.find(row => row.formId === 'haeyo')?.irregular).toBe(true)
    expect(kiku.rows.find(row => row.formId === 'dict')?.irregular).toBe(false)
    const hada = await table('ko', '\uD558\uB2E4')
    expect(hada.rows.every(row => !row.irregular)).toBe(true)
  })
})
