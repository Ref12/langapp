import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from './database'
import { initializeProfiles } from './profiles/store'
import { startReviewSession, dueCards } from './study/knowledge'
import { whenGenerated } from './study/generation'
import { getLearningContext, executeAssistantTool } from './assistant/tools'
import { createDrillSet } from './drills/store'
import { loadBacklogWords } from './drills/unwritten'
import { pickItems } from './study/skill-pick'
import { buildRunScript } from './handsfree/store'
import { dueItems } from './collections/store'
import { fixtureJson, isOtherLanguage } from './main-made-profile.helpers'

// Every direct read of the learning tables, walked on the database main left behind: no other-language item is listed, counted or sent to the model, and nothing throws.
vi.mock('./study/local-exercises', async importOriginal => ({ ...await importOriginal<typeof import('./study/local-exercises')>(), localVocabularyExercises: () => [], fillLocalExercises: () => [] }))
const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('./ai/structured', () => structured)

const OTHER = /\b(ja|ko):[a-z]|[\u3040-\u30ff\uac00-\ud7af]/
const connection = { id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const, baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const }

async function seed() {
  const tables = fixtureJson<Record<string, Record<string, unknown>[]>>('idb-rows.json')
  for (const [name, rows] of Object.entries(tables)) {
    if (name === 'aiConnections' || name === 'backupConfig') continue
    await (db as unknown as Record<string, { bulkPut(rows: unknown[]): Promise<unknown> }>)[name].bulkPut(rows)
  }
  await db.aiConnections.put(connection)
  await db.exerciseSessions.put({ id: 'ja-active', mode: 'review', domain: 'reading', targetRefs: ['ja:w:ja-n5-00679'], reviewRefs: [], exercises: [], cursor: 0, status: 'active', model: '', rejected: [], createdAt: 10, redoOf: 'x' } as never)
  await db.exerciseAttempts.put({ id: 'ja-active:0', sessionId: 'ja-active', index: 0, refs: ['ja:w:ja-n5-00679'], response: 'x', correct: true, createdAt: 10 } as never)
  await db.collections.put({ id: 'col', name: 'Mixed', kind: 'mine', createdAt: 1, updatedAt: 1 } as never)
  await db.collectionItems.bulkPut([{ id: 'col|vocabulary:cha2--tea', collectionId: 'col', ref: 'vocabulary:cha2--tea', addedAt: 1 }, { id: 'col|ja:w:ja-n5-00679', collectionId: 'col', ref: 'ja:w:ja-n5-00679', addedAt: 2 }] as never)
}

beforeEach(async () => {
  localStorage.clear()
  await initializeProfiles()
  await db.delete(); await db.open(); await initializeWorkspace()
  structured.requestStructuredJSON.mockReset()
  structured.requestStructuredJSON.mockRejectedValue(new Error('no model in this test'))
  await seed()
})

describe('every read path on a database main left', () => {
  it('has other-language rows to meet', async () => {
    expect((await db.knowledge.toArray()).some(row => isOtherLanguage(row.ref))).toBe(true)
    expect((await db.studyCards.toArray()).some(row => isOtherLanguage(row.ref))).toBe(true)
  })

  it('Review anyway picks only Chinese items', async () => {
    const id = await startReviewSession(Date.now() + 1000, true)
    await whenGenerated(id).catch(() => undefined)
    const session = (await db.exerciseSessions.get(id))!
    expect([...session.targetRefs, ...session.reviewRefs].length).toBeGreaterThan(0)
    expect([...session.targetRefs, ...session.reviewRefs].some(isOtherLanguage)).toBe(false)
  })

  it('drill sets (review, skill, unwritten) hold no other-language item', async () => {
    const review = (await db.drillSets.get(await createDrillSet({ kind: 'review' }, Date.now() + 1000)))!
    expect(review.refs.length).toBeGreaterThan(0)
    expect(review.refs.some(isOtherLanguage)).toBe(false)
    for (const strategy of ['least', 'recent'] as const) expect((await pickItems('read' as never, 20, strategy)).some(isOtherLanguage)).toBe(false)
    expect((await loadBacklogWords()).some(word => isOtherLanguage(word.ref))).toBe(false)
  })

  it("Write practice's known-character set and Hands-free's pick ignore them", async () => {
    const known = new Set((await db.knowledge.toArray()).map(entry => entry.ref))
    const { script, items } = await buildRunScript({ refs: ['vocabulary:cha2--tea'], settings: undefined as never, seed: 1 }, 'introduction', known).catch(() => ({ script: [], items: [] as { ref: string }[] }))
    expect(JSON.stringify({ script, items })).not.toMatch(OTHER)
  })

  it("the assistant's knowledge summary counts and names only Chinese state", async () => {
    const context = JSON.parse(await getLearningContext('茶'))
    expect(JSON.stringify(context)).not.toMatch(OTHER)
    const chinese = (await db.knowledge.toArray()).filter(entry => !isOtherLanguage(entry.ref))
    expect(context.counts.knowledgeSet.vocabulary).toBe(chinese.filter(entry => entry.kind === 'vocabulary').length)
    expect(context.counts.cards).toBe((await db.studyCards.toArray()).filter(card => !isOtherLanguage(card.ref)).length)
    expect(context.counts.exerciseSessions.completed + context.counts.exerciseSessions.abandoned).toBe((await db.exerciseSessions.toArray()).filter(s => !s.targetRefs.some(isOtherLanguage) && ['completed', 'abandoned'].includes(s.status)).length)
    expect(JSON.stringify(JSON.parse(await executeAssistantTool('lookup_words', { query: 'tea' })))).not.toMatch(OTHER)
  })

  it('a collection counts and lists only its Chinese items', async () => {
    expect((await dueItems('col', Date.now() + 1000)).map(item => item.ref)).toEqual(['vocabulary:cha2--tea'])
    expect((await dueCards(Date.now() + 1000)).some(card => isOtherLanguage(card.ref))).toBe(false)
  })
})
