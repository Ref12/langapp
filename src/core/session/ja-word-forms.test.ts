// @vitest-environment jsdom
// Word forms in a Japanese build (step 3.6): Conjugate and Which form is this? from real lesson data, the taught-form filter, the marking, the planner and every shipped word.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { loadItems } from '../drills/items'
import { createRng } from '../study/local-exercises'
import { jaPack, zhPack } from '../language'
import { formsEngine } from '../forms'
import { headwordFor } from '../forms/display'
import { taughtFormIds } from '../forms/conjugate'
import { planSession, type PlanInput } from './plan'
import { loadSessionBank } from './sources'
import { BUILTIN_PRESETS, DEFAULT_PRESET } from './presets'
import { formWords, inflectedWords, taughtGrammarIds } from './word-form-plan'
import type { ConjugateItem, FormPickItem, SessionExercise } from './types'

let catalog: Catalog
beforeAll(async () => { setBuildLanguageForTests('ja'); resetCatalogCache(); catalog = await loadCatalog() }, 60000)
afterAll(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

const refOf = (unit: { kind: string; ref: string }) => unit.kind + ':' + unit.ref
/** The refs of lessons 1..n. */
const upTo = (n: number) => catalog.orderedGroups.slice(0, n).flatMap(entry => entry.group.units.map(refOf))
const lessonRefs = (n: number) => catalog.orderedGroups[n - 1].group.units.map(refOf)
const wf = jaPack.wordForms

async function planFor(lesson: number, preset = DEFAULT_PRESET, seed = 11) {
  const refs = lessonRefs(lesson)
  const known = new Set(upTo(lesson - 1))
  const items = await loadItems(refs, catalog)
  const allowed = new Set([...known, ...refs])
  const bank = await loadSessionBank(catalog, items, allowed)
  const input: PlanInput = { intent: 'practice-set', items, seed, catalog, known, bank: bank.byItem, allBank: bank.all, length: 'standard', preset }
  return { plan: planSession(input), input, known, refs, allowed }
}
const flat = (plan: { stages: { exercises: SessionExercise[] }[] }) => plan.stages.flatMap(stage => stage.exercises)
const request = (stage: 'recognise' | 'produce', refs: Iterable<string>, reached: number, count = 6, seed = 3) => {
  const allowed = new Set(upTo(reached))
  return { stage, count, words: formWords(catalog, refs), pool: formWords(catalog, allowed), taught: taughtGrammarIds(catalog, allowed), inflected: [] as never[], rng: createRng(seed) }
}

describe('the taught-form filter', () => {
  it('lesson 1 teaches the polite form (ます) only: a verb is asked in no other form', () => {
    const taught = taughtGrammarIds(catalog, new Set(upTo(1)))
    expect(taughtFormIds('ja', 'suru-compound', taught)).toEqual(['masu'])
    const made = wf.exercises(request('produce', ['vocabulary:benkyousuru--study'], 1, 4)) as ConjugateItem[]
    expect(made.length).toBeGreaterThan(0)
    for (const entry of made) expect(entry.formId).toBe('masu')
  })
  it('a form no lesson so far teaches is never asked, in any lesson', () => {
    for (const reached of [1, 3, 5, 12, 40, 87]) {
      const taught = taughtGrammarIds(catalog, new Set(upTo(reached)))
      const made = wf.exercises(request('produce', upTo(reached), reached, 200)) as ConjugateItem[]
      for (const entry of made) expect(taughtFormIds('ja', entry.cls, taught), reached + ' ' + entry.lemma + ' ' + entry.formId).toContain(entry.formId)
    }
  })
  it('nothing is asked when no word of the set inflects or no form is taught', () => {
    expect(wf.exercises(request('produce', ['vocabulary:watashi--i'], 1))).toEqual([])
    expect(wf.exercises({ ...request('produce', ['vocabulary:benkyousuru--study'], 1), taught: new Set() })).toEqual([])
    expect(wf.exercises(request('recall' as never, upTo(5), 5))).toEqual([])
  })
})

describe('Conjugate, built from real words', () => {
  it('a verb: the pieces make the answer, the answer is the forms engine\'s, the rule line is there', () => {
    const made = wf.exercises(request('produce', ['vocabulary:hataraku--work'], 5, 3)) as ConjugateItem[]
    expect(made.length).toBeGreaterThan(0)
    for (const entry of made) {
      expect(entry.refs).toEqual(['vocabulary:hataraku--work'])
      expect(entry.tiles.join('')).toBe(entry.answer)
      expect(entry.answer).toBe(formsEngine('ja').forms('働く', 'godan-ku', entry.formId, { reading: 'はたらく' })!.surface)
      expect(entry.rule).toContain('godan')
    }
  })
  it('an adjective, in a lesson that teaches one of its forms', () => {
    const lesson = catalog.orderedGroups.findIndex(entry => entry.group.units.some(unit => unit.kind === 'vocabulary' && catalog.units.get(refOf(unit)) && (catalog.units.get(refOf(unit)) as { record: { cl?: string } }).record.cl === 'i-adj')) + 1
    let found: ConjugateItem | undefined
    for (let reached = lesson; reached <= 87 && !found; reached++) {
      const adjectives = upTo(reached).filter(ref => (catalog.units.get(ref) as { record?: { cl?: string } }).record?.cl === 'i-adj')
      found = (wf.exercises(request('produce', adjectives, reached, 20)) as ConjugateItem[]).find(entry => entry.cls === 'i-adj')
    }
    expect(found, 'an i-adjective conjugate question').toBeTruthy()
    expect(found!.tiles.join('')).toBe(found!.answer)
  })
  it('the word is shown in the display form, unless that is the form asked for: then in the dictionary form', () => {
    const polite = formWords(catalog, ['vocabulary:benkyousuru--study'], () => ({ text: '勉強します', reading: 'べんきょうします' }))
    const made = wf.exercises({ ...request('produce', [], 5, 40), words: polite }) as ConjugateItem[]
    expect(made.length).toBeGreaterThan(1)
    for (const entry of made) {
      expect(entry.formId).not.toBe('dict')
      if (entry.formId === 'masu') { expect(entry.lemma).toBe('勉強する'); expect(entry.lemmaReading).toBe('べんきょうする'); expect(entry.explanation).toBe('勉強する in the polite present ます form is 勉強します.') }
      else { expect(entry.lemma).toBe('勉強します'); expect(entry.lemmaReading).toBe('べんきょうします') }
      expect(entry.lemma).not.toBe(entry.answer)
    }
  })
  it('lesson 1: the only taught form is the polite one, and the polite display setting still shows 勉強する', () => {
    const offer = jaPack.displayForms!
    const polite = formWords(catalog, ['vocabulary:benkyousuru--study'], record => headwordFor(offer, 'masu', record))
    const [entry] = wf.exercises({ ...request('produce', [], 1, 4), words: polite }) as ConjugateItem[]
    expect(entry.formId).toBe('masu')
    expect(entry.lemma).toBe('勉強する')
    expect(entry.answer).toBe('勉強します')
  })
})

describe('marking a Conjugate answer', () => {
  const answer = { surface: '勉強しません', reading: 'べんきょうしません' }
  it('right: as written, in kana, in katakana, in romaji', () => {
    for (const given of ['勉強しません', 'べんきょうしません', 'ベンキョウシマセン', 'benkyoushimasen', 'benkyou shimasen']) expect(wf.grade(given, answer), given).toBe('right')
  })
  it('almost: the romaji with a long vowel written short', () => expect(wf.grade('benkyshimasen', answer)).toBe('wrong'))
  it('almost for a long vowel written short in romaji', () => expect(wf.grade('benkyoshimasen', answer)).toBe('almost'))
  it('wrong: another form, another word', () => {
    expect(wf.grade('勉強します', answer)).toBe('wrong')
    expect(wf.grade('べんきょうします', answer)).toBe('wrong')
    expect(wf.grade('', answer)).toBe('wrong')
  })
  it('an irregular verb: 来ます is きます', () => {
    const made = formsEngine('ja').forms('来る', 'kuru', 'masu', { reading: 'くる' })!
    expect(wf.grade('きます', made)).toBe('right')
    expect(wf.grade('kimasu', made)).toBe('right')
    expect(wf.grade('くます', made)).toBe('wrong')
    const item = (wf.exercises(request('produce', ['vocabulary:kuru--come'], 87, 40)) as ConjugateItem[]).find(entry => entry.irregular)
    expect(item, 'an irregular conjugate question').toBeTruthy()
    expect(item!.distractors.length).toBeGreaterThan(0)
  })
})

describe('Which form is this?, from a real inflected token', () => {
  it('is built from the sentences of the bank with the word and form in the options', async () => {
    const { allowed } = await planFor(12)
    const items = await loadItems([...allowed], catalog)
    const bank = await loadSessionBank(catalog, items, allowed)
    const inflected = inflectedWords(bank.all, allowed)
    expect(inflected.length).toBeGreaterThan(0)
    const req = { ...request('recognise', allowed, 12, 8), inflected }
    const made = wf.exercises(req) as FormPickItem[]
    expect(made.length).toBeGreaterThan(0)
    for (const entry of made) {
      expect(entry.options.length).toBeGreaterThanOrEqual(3)
      expect(new Set(entry.options.map(option => option.name)).size).toBe(entry.options.length)
      expect(entry.options[entry.answer].label).toBeTruthy()
      expect(entry.phrase?.text).toContain(entry.surface)
      expect(entry.refs).toHaveLength(1)
    }
  })
})

describe('Which form is this?: the choices are form names only', () => {
  it('for 働きましょう the choices name forms, hold the right one and no ending, English or other word; the feedback names the ending', async () => {
    const { allowed } = await planFor(12)
    const items = await loadItems([...allowed], catalog)
    const bank = await loadSessionBank(catalog, items, allowed)
    const made = wf.exercises({ ...request('recognise', allowed, 12, 40), inflected: inflectedWords(bank.all, allowed) }) as FormPickItem[]
    expect(made.length).toBeGreaterThan(0)
    for (const entry of made) {
      const names = entry.options.map(option => option.name)
      expect(new Set(names).size).toBe(names.length)
      for (const name of names) { expect(name).not.toMatch(/[\u3040-\u30FF\u4E00-\u9FFF\uFF5E~]/); expect(name).not.toMatch(/\u52C9\u5F37|\u50CD/) }
      expect(names).toContain(entry.options[entry.answer].name)
      expect(entry.explanation).toContain(entry.options[entry.answer].label)
    }
    const mashou = made.find(entry => entry.options[entry.answer].formId === 'mashou')
    if (mashou) { expect(mashou.options[mashou.answer].name).toBe("let's (volitional)"); expect(mashou.explanation).toMatch(/ましょう form of/) }
  })
})

describe('Which form is this? for 働きましょう', () => {
  it('has form names only, the right one among them, and the feedback names the ending', async () => {
    const { buildFormPickFor } = await import('../forms/conjugate')
    const word = { id: 'w', lemma: '働く', reading: 'はたらく', cls: 'godan-ku', gloss: 'to work' }
    const built = buildFormPickFor('ja', word, 'mashou', [{ id: 'x', lemma: '勉強する', cls: 'suru', gloss: 'to study' }], () => 0.3)!
    expect(built.surface).toBe('働きましょう')
    const names = built.options.map(option => option.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain("let's (volitional)")
    for (const name of names) expect(name).not.toMatch(/[\u3040-\u30FF\u4E00-\u9FFF\uFF5E~]|勉強/)
    expect(built.options[built.answer].label).toBe("let's ～ましょう")
  })
})

describe('the planner', () => {
  it('a Japanese new-items set of a lesson that teaches a verb form has word-form questions in the right stages', async () => {
    // lesson 1 teaches ます: its verb 勉強する is in the set.
    const { plan } = await planFor(1)
    const byStage = (stage: string) => (plan.stages.find(entry => entry.stage === stage)?.exercises ?? []) as SessionExercise[]
    expect(byStage('produce').filter(entry => entry.form === 'conjugate').length).toBeGreaterThan(0)
    expect(byStage('recognise').filter(entry => entry.form === 'conjugate')).toEqual([])
    for (const stage of ['recall', 'use']) expect(byStage(stage).filter(entry => entry.form === 'conjugate' || entry.form === 'form-pick')).toEqual([])
    const wfs = flat(plan).filter(entry => entry.form === 'conjugate' || entry.form === 'form-pick')
    expect(wfs.length).toBeLessThanOrEqual(Math.ceil(flat(plan).length / 3))
    expect(wfs.length).toBeLessThan(flat(plan).length / 2)
  })
  it('Which form is this? is in Recognise once the lessons hold a sentence with a form', async () => {
    let seen = false
    for (const lesson of [3, 5, 12, 13]) { const { plan } = await planFor(lesson); if (plan.stages.find(entry => entry.stage === 'recognise')?.exercises.some(entry => entry.form === 'form-pick')) seen = true }
    expect(seen).toBe(true)
  })
  it('the same seed is the same plan; a word-form question records its word', async () => {
    const one = await planFor(5), two = await planFor(5)
    expect(JSON.stringify(one.plan)).toBe(JSON.stringify(two.plan))
    for (const entry of flat(one.plan).filter(entry => entry.form === 'conjugate' || entry.form === 'form-pick')) { expect(entry.refs).toHaveLength(1); expect(catalog.units.get(entry.refs[0])?.kind).toBe('vocabulary') }
  })
  it('Reading takes only Which form is this?, Writing only Conjugate, Listening and Speaking neither', async () => {
    const forms = async (id: string) => new Set(flat((await planFor(13, BUILTIN_PRESETS.find(preset => preset.id === id)!)).plan).map(entry => entry.form))
    expect((await forms('reading')).has('conjugate')).toBe(false)
    expect((await forms('writing')).has('form-pick')).toBe(false)
    for (const id of ['listening', 'speaking']) { const used = await forms(id); expect(used.has('conjugate') || used.has('form-pick')).toBe(false) }
  })
  it('only words of the set or words the learner knows are asked; a set with none of either plans none', async () => {
    const { plan, known, refs } = await planFor(2)
    for (const entry of flat(plan).filter(item => item.form === 'conjugate' || item.form === 'form-pick')) expect(known.has(entry.refs[0]) || refs.includes(entry.refs[0])).toBe(true)
    const items = await loadItems(lessonRefs(2), catalog)
    const none = new Set<string>()
    const bank = await loadSessionBank(catalog, items, new Set(lessonRefs(2)))
    const bare = planSession({ intent: 'practice-set', items, seed: 1, catalog, known: none, bank: bank.byItem, allBank: bank.all, length: 'standard', preset: DEFAULT_PRESET })
    const hasVerb = lessonRefs(2).some(ref => (catalog.units.get(ref) as { record?: { cl?: string } }).record?.cl)
    if (!hasVerb) expect(flat(bare).filter(entry => entry.form === 'conjugate' || entry.form === 'form-pick')).toEqual([])
  })
})

describe('every shipped Japanese word with a class', () => {
  it('builds a Conjugate question in every form its lessons have taught, and its own answer is marked right', () => {
    const engine = formsEngine('ja')
    const failures: string[] = []
    let checked = 0
    const lessonOf = new Map<string, number>()
    catalog.orderedGroups.forEach((entry, index) => { for (const unit of entry.group.units) if (unit.kind === 'vocabulary' && !lessonOf.has(refOf(unit))) lessonOf.set(refOf(unit), index + 1) })
    for (const [ref, lesson] of lessonOf) {
      const [one] = formWords(catalog, [ref])
      if (!one) continue
      // the forms taught by the lessons reached by the end of the word's lesson, and by the last lesson
      for (const reached of [lesson, 87]) {
        const taught = taughtGrammarIds(catalog, new Set(upTo(reached)))
        const forms = taughtFormIds('ja', one.cls, taught).filter(id => engine.forms(one.lemma, one.cls, id, { reading: one.reading }))
        for (const formId of forms) {
          const built = engine.forms(one.lemma, one.cls, formId, { reading: one.reading })!
          // ask for exactly this form: only it is taught
          const only = new Set([...taught].filter(point => engine.grammarOf(formId, one.cls) === point))
          const made = wf.exercises({ stage: 'produce', count: 20, words: [one], pool: [one], taught: only, inflected: [], rng: createRng(5) }) as ConjugateItem[]
          const entry = made.find(item => item.formId === formId)
          checked++
          if (!entry) { failures.push(ref + ' ' + formId + ': not built'); continue }
          const right = [entry.answer, built.reading!, entry.tiles.join('')].every(given => wf.grade(given, { surface: entry.answer, reading: entry.answerReading }) === 'right')
          if (!right || entry.answer !== built.surface) failures.push(ref + ' ' + formId + ': own answer not right')
          // The shown base is never the answer, in either display setting.
          for (const setting of ['masu', 'dict']) {
            const [shown] = formWords(catalog, [ref], record => headwordFor(jaPack.displayForms, setting, record))
            const asked = (wf.exercises({ stage: 'produce', count: 20, words: [shown], pool: [shown], taught: only, inflected: [], rng: createRng(5) }) as ConjugateItem[]).find(item => item.formId === formId)
            if (!asked) { failures.push(ref + ' ' + formId + ' ' + setting + ': not built'); continue }
            if (asked.lemma === asked.answer || asked.lemmaReading === asked.answerReading) failures.push(ref + ' ' + formId + ' ' + setting + ': the base gives the answer away')
            if (!asked.explanation.startsWith(asked.lemma + ' ')) failures.push(ref + ' ' + formId + ' ' + setting + ': explanation names another base')
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
    expect(failures.slice(0, 8)).toEqual([])
  })
})

describe('Chinese has none', () => {
  it('the entry says none and plans nothing; no Chinese set contains a word-form question', () => {
    expect(zhPack.wordForms.offered).toBe(false)
    expect(zhPack.wordForms.exercises({ stage: 'produce', count: 5, words: [], pool: [], taught: new Set(), inflected: [], rng: createRng(1) })).toEqual([])
  })
})
