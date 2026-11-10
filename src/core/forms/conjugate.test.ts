import { describe, expect, it } from 'vitest'
import { formsEngine } from '.'
import { loadDictionary } from '../dictionary/other'
import type { ParallelLanguage } from '../language/ids'
import { buildConjugate, gradeConjugate, ruleLine, wordFormsTable } from './conjugate'

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
