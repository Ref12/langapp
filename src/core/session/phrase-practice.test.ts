// @vitest-environment jsdom
// Phrases as items of the practice engine (docs/audits/2026-11-11-phrases-in-practice.md, stages 1 and 2): refs and their resolver, the picker, the planner's sentence forms, and what practising one records.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { resetBackupStateForTests } from '../backup/state'
import { initializeProfiles } from '../profiles/store'
import { T0 } from '../profiles/fixtures/learner'
import { createDrillSet, getDrillSet, recordEngineResult } from '../drills/store'
import { whenContent } from '../drills/content'
import { loadItems } from '../drills/items'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { usableFor } from '../phrases/bank'
import { readyLesson } from '../phrases/dictionary'
import { parseSentenceRef, resolveSentences, sentenceRef, shippedSentences, type ShippedPhrase } from '../phrases/sentence-ref'
import { isSentenceRef, unitRefSchema, type KnowledgeEntry, type StudyCard } from '../study/contracts'
import { skillPracticeBackupSchema } from '../study/skill-map'
import { reachedLesson } from './dataset-source'
import { loadPhrasePick, pickPhrases, practiceByRef } from './phrase-pick'
import { planSetSession } from './set-plan'
import { BUILTIN_PRESETS } from './presets'
import { LENGTHS, PHRASE_FORMS, type SessionPlan } from './types'
import type { LanguageId } from '../language/ids'
import type { BankPhrase } from '../phrases/contracts'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const DAY = 86_400_000
const PREFIX = { zh: 'sentence:', ja: 'ja:s:', ko: 'ko:s:' } as const
let catalog: Catalog

/** A learner who finished the first lessons: their words and grammar are known, three of the words have a due card. */
async function learner(language: LanguageId, lessons: number) {
  setBuildLanguageForTests(language)
  resetCatalogCache()
  catalog = await loadCatalog()
  structured.requestStructuredJSON.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete(); await db.open(); await initializeWorkspace()
  const units = catalog.orderedGroups.slice(0, lessons).flatMap(item => item.group.units.map(unit => catalog.units.get(`${unit.kind === 'vocabulary' ? 'vocabulary' : 'grammar'}:${unit.ref}`)).filter(Boolean))
  const knowledge: KnowledgeEntry[] = [], cards: StudyCard[] = []
  for (const [i, unit] of units.entries()) {
    if (!unit) continue
    knowledge.push({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: T0 - (units.length - i) * (DAY / 3), source: 'new' })
    if (i < 3) cards.push({ id: unit.ref + ':reading', ref: unit.ref, domain: 'reading', due: T0 + DAY, stability: 3, difficulty: 5, reps: 2, lapses: 0, state: 'review', lastReview: T0 - DAY, updatedAt: T0 - DAY })
  }
  await db.knowledge.bulkPut(knowledge); await db.studyCards.bulkPut(cards)
}
const knownSet = async () => new Set((await db.knowledge.toArray()).map(entry => entry.ref))

afterEach(() => { vi.useRealTimers(); setBuildLanguageForTests(undefined); resetCatalogCache() })

const fake = (id: number, over: Partial<BankPhrase> & { band?: string } = {}): ShippedPhrase => ({ ref: sentenceRef('1', id, 'ja'), band: '1', phrase: { id, zh: `文${id}`, py: 'x', en: 'x', words: ['vocabulary:a'], source: 'ai', checked: true, readyAt: 1, ...over } })

describe('the picker is pure and keeps to the rules', () => {
  const base = { known: new Set(['vocabulary:a', 'vocabulary:b']), lessonOf: (phrase: BankPhrase) => phrase.readyAt ?? 0, reached: 5, practice: new Map(), order: 'least' as const, count: 10, seed: 1 }
  it('offers only checked phrases whose words and grammar are known and whose lesson is reached', () => {
    const entries = [fake(1), fake(2, { checked: false }), fake(3, { words: ['vocabulary:z'] }), fake(4, { grammar: ['grammar:g'] }), fake(5, { readyAt: 6 }), fake(6, { words: ['vocabulary:a', 'vocabulary:b'], readyAt: 5 })]
    const pick = pickPhrases({ ...base, entries })
    expect(pick.refs.sort()).toEqual([entries[0].ref, entries[5].ref].sort())
    expect(pick.ready).toBe(2)
  })
  it('a phrase with a scope is offered only when it uses something of the scope', () => {
    const entries = [fake(1), fake(2, { words: ['vocabulary:b'] })]
    expect(pickPhrases({ ...base, entries, scope: new Set(['vocabulary:b']) }).refs).toEqual([entries[1].ref])
  })
  it('least practised comes first, ties by the seed; recent puts the latest lessons first', () => {
    const entries = [fake(1, { readyAt: 1 }), fake(2, { readyAt: 4 }), fake(3, { readyAt: 3 }), fake(4, { readyAt: 5 })]
    const practice = practiceByRef([{ ref: entries[0].ref, skill: 'reading', count: 0, lastAt: 0, familiar: false }, { ref: entries[1].ref, skill: 'reading', count: 3, lastAt: 1, familiar: false }, { ref: entries[2].ref, skill: 'reading', count: 1, lastAt: 1, familiar: false }, { ref: entries[3].ref, skill: 'listening', count: 3, lastAt: 1, familiar: false, correct: 2 }])
    expect(pickPhrases({ ...base, entries, practice, order: 'least', count: 3 }).refs).toEqual([entries[0].ref, entries[2].ref, expect.stringMatching(/ja:s:b1-[24]/)])
    expect(pickPhrases({ ...base, entries, practice, order: 'recent', count: 3 }).refs).toEqual([entries[3].ref, entries[1].ref, entries[2].ref])
    expect(pickPhrases({ ...base, entries, practice, order: 'least', count: 3 }).never).toBe(1)
  })
  it('is repeatable for a seed and changes with it', () => {
    const entries = Array.from({ length: 40 }, (_, at) => fake(at + 1))
    const a = pickPhrases({ ...base, entries, count: 10, seed: 7 }).refs
    expect(pickPhrases({ ...base, entries, count: 10, seed: 7 }).refs).toEqual(a)
    expect(pickPhrases({ ...base, entries, count: 10, seed: 8 }).refs).not.toEqual(a)
  })
  it('gives fewer than the count when fewer are ready', () => {
    const pick = pickPhrases({ ...base, entries: [fake(1), fake(2)], count: 10 })
    expect(pick.refs).toHaveLength(2)
    expect(pick.ready).toBe(2)
    expect(pickPhrases({ ...base, entries: [], count: 10 })).toEqual({ refs: [], ready: 0, never: 0 })
  })
  it('sums the skill rows into one count and one number of wins per phrase', () => {
    const rows = [{ ref: 'x', skill: 'reading' as const, count: 2, lastAt: 5, familiar: false, correct: 1 }, { ref: 'x', skill: 'writing' as const, count: 1, lastAt: 9, familiar: false }]
    expect(practiceByRef(rows).get('x')).toEqual({ count: 3, wins: 1, lastAt: 9 })
  })
})

describe('sentence refs', () => {
  it('names a phrase by language, band and id, and nothing else', () => {
    expect(sentenceRef('3', 1207, 'zh')).toBe('sentence:b3-1207')
    expect(sentenceRef('1', 45, 'ja')).toBe('ja:s:b1-45')
    expect(sentenceRef('1', 45, 'ko')).toBe('ko:s:b1-45')
    for (const ref of ['sentence:b3-1207', 'ja:s:b1-45', 'ko:s:b1-45']) { expect(unitRefSchema.safeParse(ref).success, ref).toBe(true); expect(isSentenceRef(ref)).toBe(true); expect(parseSentenceRef(ref)).toBeDefined() }
    expect(parseSentenceRef('ja:s:b1-45')).toEqual({ band: '1', id: 45 })
    for (const ref of ['phrase:b1-45', 'vocabulary:b1-45', 'sentence:3-1207', 'ja:w:b1-45']) expect(parseSentenceRef(ref), ref).toBeUndefined()
  })
})

describe.each(['zh', 'ja', 'ko'] as const)('phrases as items (%s)', language => {
  beforeEach(() => learner(language, language === 'zh' ? 6 : 12))

  it('resolves a ref to the shipped phrase and the picker offers ready ones only', async () => {
    const all = await shippedSentences()
    expect(all.length).toBeGreaterThan(500)
    expect(all.every(entry => entry.ref.startsWith(PREFIX[language]))).toBe(true)
    const pick = await loadPhrasePick(catalog, { order: 'least', count: 8, seed: 3 })
    expect(pick.refs).toHaveLength(8)
    const known = await knownSet()
    const found = await resolveSentences(pick.refs)
    expect([...found.keys()].sort()).toEqual([...pick.refs].sort())
    for (const { phrase } of found.values()) {
      expect(phrase.checked).toBe(true)
      expect(usableFor(phrase, known)).toBe(true)
      expect(readyLesson(catalog, phrase)).toBeLessThanOrEqual(reachedLesson(catalog, known))
    }
    const items = await loadItems(pick.refs, catalog)
    expect(items.map(item => item.ref)).toEqual(pick.refs)
    expect(items.every(item => item.kind === 'phrase' && item.phrase && item.zh === item.phrase.zh)).toBe(true)
  })

  it('is repeatable for a seed and offers fewer when little is known', async () => {
    const options = { order: 'least' as const, count: 6, seed: 11 }
    expect((await loadPhrasePick(catalog, options)).refs).toEqual((await loadPhrasePick(catalog, options)).refs)
    await db.knowledge.clear()
    const few = await db.knowledge.count()
    expect(few).toBe(0)
    expect((await loadPhrasePick(catalog, options)).refs).toEqual([])
  })

  it('plans sentence forms only, no introduce stage and each sentence once, for every preset and length', async () => {
    const id = await createDrillSet({ kind: 'phrases', count: 6, order: 'least' })
    await whenContent(id)
    const set = (await getDrillSet(id))!
    expect(set.source).toBe('phrases')
    expect(set.title).toMatch(/^Phrases · /)
    expect(set.refs).toHaveLength(6)
    expect(set.addOnFinish).toBeUndefined()
    const items = await loadItems(set.refs, catalog)
    const known = await knownSet()
    for (const preset of BUILTIN_PRESETS) for (const length of LENGTHS) {
      const plan: SessionPlan = await planSetSession({ catalog, items, refs: set.refs, known, engine: { preset: preset.id, length, seed: set.engine!.seed } })
      const label = preset.id + ' ' + length
      expect(plan.total, label).toBeGreaterThan(0)
      expect(plan.stages.map(stage => stage.stage), label).not.toContain('introduce')
      const exercises = plan.stages.flatMap(stage => stage.exercises)
      expect(exercises.every(exercise => PHRASE_FORMS.includes(exercise.form)), label + ' ' + [...new Set(exercises.map(exercise => exercise.form))]).toBe(true)
      expect(exercises.every(exercise => exercise.refs.length === 1 && set.refs.includes(exercise.refs[0])), label).toBe(true)
      expect(plan.uncovered, label).toEqual([])
      // one sentence per item: its exercises are all on it, and no two items share one
      const sentences = new Map<string, string>()
      for (const exercise of exercises) {
        const text = 'sentence' in exercise ? exercise.sentence : 'hearText' in exercise && exercise.hearText ? exercise.hearText : 'zh' in exercise ? exercise.zh : undefined
        if (text) { const was = sentences.get(text); expect(was === undefined || was === exercise.refs[0], label).toBe(true); sentences.set(text, exercise.refs[0]) }
      }
      expect(new Set(items.map(item => item.phrase!.zh)).size).toBe(items.length)
    }
  })

  it('builds the gap from a word of the phrase and the tiles from its pieces', async () => {
    const id = await createDrillSet({ kind: 'phrases', count: 6, order: 'least' })
    await whenContent(id)
    const set = (await getDrillSet(id))!
    const items = await loadItems(set.refs, catalog)
    const known = await knownSet()
    const strip = (text: string) => text.replace(/[\p{P}\p{S}\s]/gu, '')
    for (const [preset, form] of [['reading', 'gap'], ['writing', 'tiles']] as const) {
      const plan = await planSetSession({ catalog, items, refs: set.refs, known, engine: { preset, length: 'long', seed: set.engine!.seed } })
      const made = plan.stages.flatMap(stage => stage.exercises).filter(exercise => exercise.form === form)
      expect(made.length, preset).toBeGreaterThan(0)
      for (const exercise of made) {
        const phrase = items.find(item => item.ref === exercise.refs[0])!.phrase!
        if (exercise.form === 'gap') { expect(exercise.gapped).not.toBe(exercise.sentence); expect(exercise.options).toHaveLength(new Set(exercise.options).size); expect(strip(exercise.sentence)).toBe(strip(phrase.zh)) }
        if (exercise.form === 'tiles') { expect(exercise.tiles.length).toBeGreaterThan(1); expect(strip(exercise.accepted[0] ?? exercise.model)).toBe(strip(phrase.zh)); expect(strip([...exercise.tiles].join(''))).toBe(strip(phrase.zh)) }
      }
    }
  })

  it('practising a phrase counts it and its wins, and changes no card, knowledge or journal', async () => {
    const id = await createDrillSet({ kind: 'phrases', count: 3, order: 'least' })
    const set = (await getDrillSet(id))!
    const [first, second] = set.refs
    const before = { cards: await db.studyCards.toArray(), knowledge: await db.knowledge.toArray(), journal: await db.journal.toArray() }
    expect((await recordEngineResult(id, first, ['reading'], 'translate-zh-en', true, false, T0 + 1000)).graded).toBe(true)
    await recordEngineResult(id, first, ['writing'], 'tiles', false, false, T0 + 2000)
    await recordEngineResult(id, second, ['listening'], 'listen-pick', true, true, T0 + 3000)
    // the same pair twice in a set changes nothing
    expect((await recordEngineResult(id, first, ['reading'], 'translate-zh-en', false, false, T0 + 4000)).graded).toBe(false)
    const rows = await db.skillPractice.toArray()
    expect(rows.filter(row => row.ref === first).map(row => [row.skill, row.count, row.correct]).sort()).toEqual([['reading', 1, 1], ['writing', 1, 0]])
    expect(rows.find(row => row.ref === second)).toMatchObject({ skill: 'listening', count: 1, correct: 1, lastAt: T0 + 3000 })
    expect(practiceByRef(rows).get(first)).toEqual({ count: 2, wins: 1, lastAt: T0 + 2000 })
    expect(await db.studyCards.toArray()).toEqual(before.cards)
    expect(await db.knowledge.toArray()).toEqual(before.knowledge)
    expect(await db.journal.toArray()).toEqual(before.journal)
    // a practised phrase is offered after the ones never practised
    const next = await loadPhrasePick(catalog, { order: 'least', count: 3, seed: 1 })
    expect(next.refs).not.toContain(first)
  })

  it('keeps the counts through a backup and loads rows from before the field existed', async () => {
    const id = await createDrillSet({ kind: 'phrases', count: 2, order: 'least' })
    const [first] = (await getDrillSet(id))!.refs
    await recordEngineResult(id, first, ['reading'], 'translate-zh-en', true, false, T0 + 1000)
    await db.skillPractice.put({ ref: 'vocabulary:old', skill: 'reading', count: 4, lastAt: 7, familiar: false })
    const before = await db.skillPractice.toArray()
    const text = await exportWorkspaceBackup()
    await db.skillPractice.clear(); await db.drillSets.clear()
    await restoreBackup(text)
    expect((await db.skillPractice.toArray()).sort((a, b) => a.ref.localeCompare(b.ref))).toEqual(before.sort((a, b) => a.ref.localeCompare(b.ref)))
    expect((await db.skillPractice.get([first, 'reading']))?.correct).toBe(1)
    expect((await db.skillPractice.get(['vocabulary:old', 'reading']))).not.toHaveProperty('correct')
    expect(skillPracticeBackupSchema.safeParse([{ ref: 'vocabulary:old', skill: 'reading', count: 4, lastAt: 7, familiar: false }]).success).toBe(true)
    expect((await db.drillSets.get(id))?.refs).toEqual((await db.drillSets.get(id))!.refs.filter(ref => ref.startsWith(PREFIX[language])))
  })
})
