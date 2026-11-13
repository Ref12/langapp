import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { loadCatalog, type Catalog } from '../study/catalog'
import { loadItems } from '../drills/items'
import { createPracticeData, type Conversation } from '../practice-data'
import { createDatasetSource } from './dataset-source'
import { conversationKey, conversationLog, recordConversationsHeard, rotate } from './conversation-rotation'
import { buildQuestions, DEFAULT_OPTIONS, drillConversationId } from '../../pages/drills/tasks'
import type { Conversation as DrillConversation } from '../drills/contracts'
import type { ConversationItem } from './types'
import type { PlanItem } from './plan'

const V = (ref: string) => 'vocabulary:' + ref
const refs = [V('wo3--me'), V('ni3--you'), V('shi4--identity'), V('xue2-sheng5--student')]
const speak = (name: string, speaker: 'female' | 'male', zh: string) => ({ zh, py: 'x', en: 'x', name, speaker })
const conversation = (id: string): Conversation => ({
  id, speakers: [{ name: 'A', speaker: 'male' }, { name: 'B', speaker: 'female' }],
  lines: [speak('A', 'male', id), speak('B', 'female', id), speak('A', 'male', id), speak('B', 'female', id)],
  questions: [{ q: 'q1', options: ['a', 'b'], answer: 0 }, { q: 'q2', options: ['a', 'b'], answer: 1 }], words: refs.map(ref => ref.replace('vocabulary:', '')), grammar: [], readyAt: 1,
})
const ids = ['c1', 'c2', 'c3', 'c4']

let catalog: Catalog
let items: PlanItem[]
beforeAll(async () => {
  catalog = await loadCatalog()
  items = await loadItems(refs, catalog)
}, 60000)
beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })

/** One practice session's conversation, as the planner picks it now. */
async function session(list: string[], seed: number): Promise<string | undefined> {
  const data = createPracticeData({ conversations: list.map(conversation) })
  const source = createDatasetSource({ data, catalog, seed, bank: [], readyAt: 100, heard: await conversationLog() })
  const picked = source.exercises({ stage: 'use', forms: ['conversation'], items, allowed: new Set(refs), taken: () => false, take: () => true })
  return (picked[0] as ConversationItem | undefined)?.id.replace('use-ds-', '')
}

describe('rotate', () => {
  const log = (entries: Record<string, number>) => new Map(Object.entries(entries).map(([id, at]) => [conversationKey(id), { heard: 1, lastHeardAt: at }]))
  it('offers the ones not heard first, then the one heard longest ago, and the previous one last', () => {
    const order = rotate(['a', 'b', 'c', 'd'], id => id, log({ a: 50, b: 10, c: 30 }), () => 0.5)
    expect(order).toEqual(['d', 'b', 'c', 'a'])
  })
  it('keeps a lone conversation even when it is the previous one', () => {
    expect(rotate(['a'], id => id, log({ a: 5 }), () => 0.5)).toEqual(['a'])
  })
  it('puts the previous session\'s conversation last even when it is not in the candidates log order', () => {
    expect(rotate(['a', 'b'], id => id, log({ z: 99, a: 1, b: 2 }), () => 0.5)).toEqual(['a', 'b'])
  })
})

describe('the heard log', () => {
  it('records what was heard and when, in the profile\'s own table, and carries it through a backup', async () => {
    await recordConversationsHeard(['c1', 'c2'], 1000)
    await recordConversationsHeard(['c1'], 5000)
    const log = await conversationLog()
    expect(log.get(conversationKey('c1'))).toEqual({ zh: conversationKey('c1'), heard: 2, lastHeardAt: 5000 })
    expect(log.get(conversationKey('c2'))?.lastHeardAt).toBe(1001)
    const text = await exportWorkspaceBackup()
    await db.phraseHeard.clear()
    await restoreBackup(text)
    expect((await conversationLog()).get(conversationKey('c1'))?.heard).toBe(2)
  })
})

describe('Practice sessions rotate their conversation', () => {
  it('never repeats the previous session\'s conversation while another fits, and hears all before any repeats', async () => {
    const heard: string[] = []
    for (let n = 0; n < 12; n++) {
      const id = await session(ids, 1000 + n)
      expect(id).toBeDefined()
      if (n) expect(id).not.toBe(heard[n - 1])
      heard.push(id!)
      await recordConversationsHeard([id!], 10_000 + n * 1000)
    }
    expect(new Set(heard.slice(0, 4)).size).toBe(4)
    expect(new Set(heard.slice(4, 8)).size).toBe(4)
  })
  it('prefers a conversation not heard yet, then the one heard longest ago', async () => {
    await recordConversationsHeard(['c1'], 1000)
    await recordConversationsHeard(['c2'], 2000)
    await recordConversationsHeard(['c3'], 3000)
    expect(await session(ids, 7)).toBe('c4')
    await recordConversationsHeard(['c4'], 4000)
    expect(await session(ids, 8)).toBe('c1')
  })
  it('still gives the only one that fits', async () => {
    await recordConversationsHeard(['c1'], 1000)
    expect(await session(['c1'], 3)).toBe('c1')
  })
})

describe('the Listen and answer drill orders its conversations the same way', () => {
  const drill = (key: string): DrillConversation => ({ title: key, lines: [{ who: 'A', zh: key + '\u597d?', py: 'x', en: 'x' }, { who: 'B', zh: key + '\u597d!', py: 'x', en: 'x' }], questions: [{ question: 'q', options: ['a', 'b'], answer: 0, after: 1 }] } as DrillConversation)
  const input = (heardLog: ReadonlyMap<string, { heard: number; lastHeardAt: number }>) => ({
    setId: 's', items, catalog, known: new Set<string>(), options: DEFAULT_OPTIONS, heardLog,
    content: { state: 'ready' as const, sentences: {}, conversations: ['x', 'y', 'z'].map(drill) },
  })
  it('puts new ones first, then the longest ago, and the previous one last', () => {
    const [x, y, z] = ['x', 'y', 'z'].map(drill)
    const log = new Map([[conversationKey(drillConversationId(x)), { heard: 1, lastHeardAt: 9 }], [conversationKey(drillConversationId(y)), { heard: 1, lastHeardAt: 3 }]])
    const queue = buildQuestions('listen', { ...input(log), items: items.map(item => ({ ...item, zh: '\u597d', ref: item.ref })) })
    const order = queue.map(question => (question.data as { conversation: DrillConversation }).conversation.title)
    expect(order).toEqual([z.title, y.title, x.title])
  })
})
