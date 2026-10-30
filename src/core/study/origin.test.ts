import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../database'
import { loadCatalog } from './catalog'
import type { ExerciseSession } from './contracts'
import { describeSession, itemsLine, originKey, resumeRows } from './origin'
import { discardSession, startRedoSession } from './knowledge'
import { isGenerating, runGeneration } from './generation'
import { startCollectionSession } from '../collections/store'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const connection = {
  id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const,
}
const oct28 = new Date(2026, 9, 28, 12).getTime()
const session = (over: Partial<ExerciseSession>): ExerciseSession => ({
  id: 's', mode: 'new', domain: 'reading', targetRefs: ['vocabulary:wo3--me'], reviewRefs: [], exercises: [], cursor: 0, status: 'active', model: 'm', rejected: [], createdAt: oct28, ...over,
})
const collection = (id: string, name: string, mediaId?: string) => ({ id, name, kind: mediaId ? 'show' as const : 'user' as const, ...(mediaId ? { mediaId } : {}), createdAt: 1, updatedAt: 1 })

beforeEach(async () => {
  await db.delete(); await db.open()
  structured.requestStructuredJSON.mockReset()
  structured.requestStructuredJSON.mockImplementation(() => new Promise(() => undefined))
  await db.aiConnections.put(connection)
})
afterEach(() => vi.restoreAllMocks())

describe('unfinished session origins', () => {
  it('titles curriculum, redo (with and without the original), collection and span sessions', async () => {
    const catalog = await loadCatalog()
    const original = session({ id: 'orig', status: 'completed' })
    const later = new Date(2026, 10, 2, 12).getTime()
    expect(describeSession(session({}), [], [], catalog).title).toBe('New items')
    expect(describeSession(session({ mode: 'review' }), [], [], catalog).title).toBe('Review')
    const redo = session({ id: 'r', redoOf: 'orig', createdAt: later })
    expect(describeSession(redo, [original, redo], [], catalog).title).toBe('Redo: lesson of ' + new Date(oct28).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
    expect(describeSession(redo, [redo], [], catalog).title).toBe('Redo: lesson of ' + new Date(later).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
    const cols = [collection('c1', 'My phrases'), collection('c2', 'Some Show', 'media1')]
    expect(describeSession(session({ collectionId: 'c1', mode: 'review' }), [], cols).title).toBe('My phrases · Review')
    expect(describeSession(session({ collectionId: 'c2', mode: 'new' }), [], cols).title).toBe('Some Show · New')
  })

  it('lists the first six item forms then +N', async () => {
    const catalog = await loadCatalog()
    const refs = [...catalog.units.values()].filter(unit => unit.kind === 'vocabulary').slice(0, 9).map(unit => unit.ref)
    const line = itemsLine(catalog, refs)
    expect(line.split(' ')).toHaveLength(7)
    expect(line.endsWith('+3')).toBe(true)
    expect(itemsLine(catalog, refs.slice(0, 2)).includes('+')).toBe(false)
  })

  it('orders curriculum, collections, then the redo, and keeps every active session', () => {
    const rows = resumeRows([
      session({ id: 'redo', redoOf: 'x', createdAt: 5 }), session({ id: 'col', collectionId: 'c1', mode: 'review', createdAt: 4 }),
      session({ id: 'rev', mode: 'review', createdAt: 3 }), session({ id: 'new', createdAt: 1 }), session({ id: 'new2', createdAt: 2 }),
      session({ id: 'done', status: 'completed' }), session({ id: 'gone', status: 'abandoned' }),
    ], [collection('c1', 'C')])
    expect(rows.map(row => row.session.id)).toEqual(['new2', 'new', 'rev', 'col', 'redo'])
    expect(originKey(session({ collectionId: 'c1', mode: 'new' }))).toBe('collection:c1:new')
  })

  it('resumes the one unfinished session of a collection instead of piling up', async () => {
    await db.collections.add(collection('c1', 'My phrases'))
    await db.collectionItems.add({ id: 'c1|phrase:1', collectionId: 'c1', ref: 'phrase:1', text: '我学习。', addedAt: 1 } as never)
    const first = await startCollectionSession('c1')
    expect(await startCollectionSession('c1')).toBe(first)
    expect((await db.exerciseSessions.toArray()).filter(item => item.collectionId === 'c1').length).toBe(1)
    await discardSession(first)
    expect(await startCollectionSession('c1')).not.toBe(first)
  })

  it('starting a different redo discards the previous unfinished one', async () => {
    await db.exerciseSessions.bulkAdd([session({ id: 'a', status: 'completed' }), session({ id: 'b', status: 'completed' })])
    const one = await startRedoSession('a')
    const two = await startRedoSession('b')
    expect((await db.exerciseSessions.get(one))!.status).toBe('abandoned')
    expect((await db.exerciseSessions.get(two))!.status).toBe('active')
  })

  it('discard abandons the session, stops its generation and keeps answers', async () => {
    await db.exerciseSessions.add(session({ id: 'g', generation: 'running' }))
    await db.exerciseAttempts.add({ id: 'g:0', sessionId: 'g', index: 0, refs: [], response: '0', correct: true, createdAt: 1 } as never)
    let seen: AbortSignal | undefined
    void runGeneration('g', signal => { seen = signal; return new Promise(() => undefined) })
    expect(isGenerating('g')).toBe(true)
    await discardSession('g')
    expect(seen!.aborted).toBe(true)
    expect((await db.exerciseSessions.get('g'))!.status).toBe('abandoned')
    expect(await db.exerciseAttempts.count()).toBe(1)
  })
})
