import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { addLines, createCollection, deleteCollection, studyLines } from './store'
import { fallbackName, renameMediaNamedSets, suggestName } from './naming'
import { drillSetSchema } from '../drills/contracts'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const connection = {
  id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const,
}
const TITLE = '大婚撞破未婚夫和繼妹，我轉身嫁給他昏迷的四叔'
const at = (day: number) => new Date(2026, 9, day, 12).getTime()

beforeEach(async () => {
  await db.delete(); await db.open(); await initializeWorkspace()
  structured.requestStructuredJSON.mockReset()
})

describe('study set names from media', () => {
  it('suggests the AI gist plus the date, cut to four words', async () => {
    await db.aiConnections.add(connection)
    structured.requestStructuredJSON.mockResolvedValue({ names: ['Heavy Knight Marries The Sick Uncle'] })
    expect(await suggestName(TITLE, at(31))).toBe('Heavy Knight Marries The · 31 Oct')
    expect(JSON.parse(structured.requestStructuredJSON.mock.calls[0][1].user)).toEqual([TITLE])
  })

  it('falls back without an AI or when it fails', async () => {
    expect(await suggestName(TITLE, at(31))).toBe('Show · 31 Oct')
    expect(fallbackName('The Long Road Home To Nowhere', at(5))).toBe('The Long Road Home · 5 Oct')
    await db.aiConnections.add(connection)
    structured.requestStructuredJSON.mockRejectedValue(new Error('down'))
    expect(await suggestName(TITLE, at(31))).toBe('Show · 31 Oct')
  })
})

describe('renaming sets named after a media title', () => {
  it('renames only sets whose name still equals the title, in one request, keeping the old name as subtitle', async () => {
    await db.aiConnections.add(connection)
    await db.collections.bulkAdd([
      { id: 'show', name: TITLE, kind: 'show', mediaId: 'm1', createdAt: at(30), updatedAt: at(30) },
      { id: 'mine', name: 'My favourites', kind: 'show', mediaId: 'm1', createdAt: at(30), updatedAt: at(30) },
      { id: 'user', name: 'Kitchen', kind: 'user', createdAt: at(30), updatedAt: at(30) },
    ])
    await db.collectionItems.add({ id: 'user|phrase:p1', collectionId: 'user', ref: 'phrase:p1', text: '你好', source: { mediaId: 'm2', title: 'Other show', line: 0, start: 0, text: '你好' }, addedAt: 1 })
    await db.collectionItems.add({ id: 'show|phrase:p2', collectionId: 'show', ref: 'phrase:p2', text: '你好', source: { mediaId: 'm1', title: TITLE, line: 0, start: 0, text: '你好' }, addedAt: 1 })
    structured.requestStructuredJSON.mockResolvedValue({ names: ['Heavy Knight'] })
    expect(await renameMediaNamedSets()).toBe(1)
    expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(1)
    expect(await db.collections.get('show')).toMatchObject({ name: 'Heavy Knight · 30 Oct', subtitle: TITLE })
    expect((await db.collections.get('mine'))!.name).toBe('My favourites')
    expect((await db.collections.get('user'))!.name).toBe('Kitchen')
    expect(await renameMediaNamedSets()).toBe(0)
    expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(1)
  })

  it('leaves everything alone without an AI', async () => {
    await db.collections.add({ id: 'show', name: TITLE, kind: 'show', mediaId: 'm1', createdAt: 1, updatedAt: 1 })
    await db.collectionItems.add({ id: 'show|phrase:p1', collectionId: 'show', ref: 'phrase:p1', text: '你好', source: { mediaId: 'm1', title: TITLE, line: 0, start: 0, text: '你好' }, addedAt: 1 })
    expect(await renameMediaNamedSets()).toBe(0)
    expect((await db.collections.get('show'))!.name).toBe(TITLE)
  })
})

describe('study sets are never created behind the back', () => {
  it('"Study now" starts a lesson on the lines and creates no study set', async () => {
    await db.aiConnections.add(connection)
    structured.requestStructuredJSON.mockRejectedValue(new Error('offline'))
    const id = await studyLines([{ text: '我是学生。', source: { mediaId: 'm1', title: TITLE, line: 1, start: 1, text: '我是学生。' } }])
    const session = (await db.exerciseSessions.get(id))!
    expect(session.collectionId).toBeUndefined()
    expect(session.lines!.some(line => line.text === '我是学生。')).toBe(true)
    expect(await db.collections.count()).toBe(0)
    expect(await db.collectionItems.count()).toBe(0)
  })
})

describe('deleting a study set', () => {
  it('removes its items and leaves an unfinished drill set from it working, title unchanged', async () => {
    const set = await createCollection('Kitchen')
    await addLines(set.id, [{ text: '我是学生。' }])
    expect(await db.collectionItems.where('collectionId').equals(set.id).count()).toBeGreaterThan(0)
    await db.drillSets.add(drillSetSchema.parse({
      id: 'd1', source: 'study-set', collectionId: set.id, title: 'Kitchen', refs: ['phrase:p1'], status: 'active', format: 'single', progress: {},
      content: { state: 'pending', sentences: {}, conversations: [] }, createdAt: 1, updatedAt: 1,
    }))
    await deleteCollection(set.id)
    expect(await db.collections.get(set.id)).toBeUndefined()
    expect(await db.collectionItems.where('collectionId').equals(set.id).count()).toBe(0)
    expect(await db.drillSets.get('d1')).toMatchObject({ title: 'Kitchen', status: 'active', refs: ['phrase:p1'] })
  })
})
