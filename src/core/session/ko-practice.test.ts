// @vitest-environment jsdom
// A Korean build with a learner who has done lessons 1 to 12: what a practice session plans. No dataset form (the pack has no dataset), no form that needs a model, nothing requested
// from a dataset or a model, and every one of the four skills gives a session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { resetBackupStateForTests } from '../backup/state'
import { initializeProfiles } from '../profiles/store'
import { T0 } from '../profiles/fixtures/learner'
import { createDrillSet, getDrillSet } from '../drills/store'
import { whenContent } from '../drills/content'
import { loadItems } from '../drills/items'
import { getPack } from '../language'
import { loadPracticeData, loadPracticeIndex } from '../practice-data'
import { planSetSession } from './set-plan'
import { BUILTIN_PRESETS, SKILL_PRESETS } from './presets'
import { DATASET_FORMS, LENGTHS, type SessionPlan } from './types'
import { SKILLS } from '../study/skill-map'
import type { KnowledgeEntry, StudyCard } from '../study/contracts'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const DAY = 86_400_000
let catalog: Catalog

beforeEach(async () => {
  setBuildLanguageForTests('ko')
  resetCatalogCache()
  catalog = await loadCatalog()
  structured.requestStructuredJSON.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete(); await db.open(); await initializeWorkspace()
  // lessons 1 to 12 are known, as a learner who finished them has them (knowledge and cards), some due
  const units = catalog.orderedGroups.slice(0, 12).flatMap(item => item.group.units.map(unit => catalog.units.get(`${unit.kind === 'vocabulary' ? 'vocabulary' : 'grammar'}:${unit.ref}`)).filter(Boolean))
  const knowledge: KnowledgeEntry[] = [], cards: StudyCard[] = []
  for (const [i, unit] of units.entries()) {
    if (!unit) continue
    knowledge.push({ ref: unit.ref, kind: unit.kind, lb: unit.record.lb, band: unit.band, addedAt: T0 - (units.length - i) * (DAY / 3), source: 'new' })
    cards.push({ id: unit.ref + ':reading', ref: unit.ref, domain: 'reading', due: T0 + (i % 5 - 2) * DAY, stability: 2 + (i % 4), difficulty: 5, reps: 2, lapses: 0, state: 'review', lastReview: T0 - DAY, updatedAt: T0 - DAY })
  }
  await db.knowledge.bulkPut(knowledge); await db.studyCards.bulkPut(cards)
})
afterEach(() => { vi.useRealTimers(); setBuildLanguageForTests(undefined); resetCatalogCache() })

const planOf = async (setId: string, preset: string, length: 'short' | 'standard' | 'long'): Promise<SessionPlan> => {
  const set = (await getDrillSet(setId))!
  const items = await loadItems(set.refs, catalog)
  const known = new Set((await db.knowledge.toArray()).map(entry => entry.ref))
  return planSetSession({ catalog, items, refs: set.refs, known, engine: { preset, length, seed: set.engine!.seed } })
}
const formsOf = (plan: SessionPlan) => plan.stages.flatMap(stage => stage.exercises.map(exercise => exercise.form))

describe('a Korean session', () => {
  it('has no practice dataset and requests none', async () => {
    expect(getPack().practice).toBeUndefined()
    const { data, problems } = await loadPracticeData()
    expect(problems).toEqual([])
    expect(data.counts).toEqual({ accepted: 0, exchanges: 0, grammarPoints: 0, nearMisses: 0, conversations: 0 })
    expect((await loadPracticeIndex()).totals.exchanges).toBe(0)
  })

  it('plans no dataset form, for every preset and length, new items and reviews alike', async () => {
    for (const source of [{ kind: 'new' as const }, { kind: 'review' as const }]) {
      const id = await createDrillSet(source)
      await whenContent(id)
      for (const preset of BUILTIN_PRESETS) for (const length of LENGTHS) {
        const plan = await planOf(id, preset.id, length)
        expect(plan.total, source.kind + ' ' + preset.id + ' ' + length).toBeGreaterThan(0)
        expect(formsOf(plan).filter(form => DATASET_FORMS.includes(form)), preset.id).toEqual([])
      }
    }
  })

  it('writes no practice prompt to a model, connected or not', async () => {
    await db.aiConnections.put({ id: 'assistant', apiType: 'chat', baseUrl: 'https://ai.example/v1', apiKey: 'k', model: 'm', nativeTools: false, structuredOutput: false, headers: [], storageAcknowledged: true, updatedAt: 1 } as never)
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    const set = (await getDrillSet(id))!
    expect(set.content.state).toBe('ready')
    expect(set.content.conversations).toEqual([])
    expect(structured.requestStructuredJSON).not.toHaveBeenCalled()
  })

  it('gives each of the four skills a session, as a skill preset and as a Practice by skill set', async () => {
    expect(SKILL_PRESETS.map(preset => preset.id)).toEqual(['reading', 'writing', 'listening', 'speaking'])
    for (const skill of SKILLS) {
      const id = await createDrillSet({ kind: 'skill', skill, size: 10, strategy: 'least' })
      await whenContent(id)
      const set = (await getDrillSet(id))!
      expect(set.refs.length, skill).toBeGreaterThan(0)
      const plan = await planOf(id, skill, 'standard')
      expect(plan.total, skill).toBeGreaterThan(0)
      expect(formsOf(plan).filter(form => DATASET_FORMS.includes(form)), skill).toEqual([])
    }
  })
})
