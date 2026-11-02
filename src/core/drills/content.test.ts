import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../database'
import { loadCatalog } from '../study/catalog'
import { addToKnowledge } from '../study/knowledge'
import { allowedVocabulary, FUNCTION_CHARACTERS, startContent, validConversations, validSentences } from './content'
import { whenContent, } from './content'
import { catalogSentence, loadItems } from './items'
import { createDrillSet, getDrillSet } from './store'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const student = 'vocabulary:xue2-sheng5--student'
const known = ['vocabulary:wo3--me', 'vocabulary:ni3--you']

beforeEach(async () => {
  await db.delete()
  await db.open()
  structured.requestStructuredJSON.mockReset()
})

const conversation = (zh: string) => ({ conversations: [{ title: 't', lines: [{ who: 'A', zh, py: 'x', en: 'x' }, { who: 'B', zh: '你是我', py: 'nǐ shì wǒ', en: 'hi' }], questions: [{ after: 0, question: 'q?', options: ['a', 'b'], answer: 0 }] }] })

describe('words allowed in practice-set AI material', () => {
  it('are the set items, the known words and the function characters', async () => {
    const catalog = await loadCatalog()
    const items = await loadItems([student], catalog)
    const allowed = allowedVocabulary(catalog, items, known.map(ref => ({ ref })))
    expect(allowed.segmenter.covers('我是学生')).toBe(true)
    expect(allowed.segmenter.covers('你的')).toBe(true)
    for (const char of FUNCTION_CHARACTERS) expect(allowed.segmenter.covers(char)).toBe(true)
    expect(allowed.segmenter.covers('我吃苹果')).toBe(false)
    expect(allowed.prompt.some(line => line.startsWith('你 '))).toBe(true)
    expect(allowed.prompt.some(line => line.startsWith('学生'))).toBe(false)
  })
  it('drop a sentence that has an unknown character and keep the valid one', async () => {
    const catalog = await loadCatalog()
    const items = await loadItems([student], catalog)
    const { segmenter } = allowedVocabulary(catalog, items, known.map(ref => ({ ref })))
    const rows = (zh: string) => ({ sentences: [{ ref: student, zh, py: 'x', en: 'x' }] })
    expect(validSentences(rows('我是学生。'), items, segmenter)[student]?.zh).toBe('我是学生。')
    expect(validSentences(rows('我是学生,他吃苹果。'), items, segmenter)).toEqual({})
  })
  it('drop a conversation with an unknown character', async () => {
    const catalog = await loadCatalog()
    const { segmenter } = allowedVocabulary(catalog, await loadItems([student], catalog), known.map(ref => ({ ref })))
    expect(validConversations(conversation('我是学生'), segmenter)).toHaveLength(1)
    expect(validConversations(conversation('我吃苹果'), segmenter)).toHaveLength(0)
  })
  it('leave the catalog examples as they are', async () => {
    const catalog = await loadCatalog()
    const item = (await loadItems([student], catalog))[0]
    const example = catalogSentence(catalog, item)
    expect(example?.source).toBe('catalog')
  })
})

describe('writing a set\'s conversations', () => {
  it('sends the known words in the prompt and stores only conversations made of allowed words', async () => {
    await db.aiConnections.add({ id: 'assistant', revision: 'r1', updatedAt: 1, apiType: 'chat-completions', baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', nativeTools: false, structuredOutput: true, storageAcknowledged: true })
    structured.requestStructuredJSON.mockImplementation(async (_connection: unknown, request: { name: string }) =>
      request.name === 'drill_conversations' ? conversation('我吃苹果') : { sentences: [] })
    const setId = await createDrillSet({ kind: 'new' })
    await whenContent(setId)
    const set = (await getDrillSet(setId))!
    const catalog = await loadCatalog()
    const other = [...catalog.units.values()].find(unit => unit.kind === 'vocabulary' && !set.refs.includes(unit.ref))!
    await addToKnowledge([other.ref])
    structured.requestStructuredJSON.mockClear()
    await startContent(setId)
    const prompts = structured.requestStructuredJSON.mock.calls.map(call => (call[1] as { user: string }).user)
    expect(prompts.length).toBeGreaterThan(0)
    expect(prompts.some(user => user.includes('otherKnownVocabulary') && user.includes((other as { record: { ch: string } }).record.ch))).toBe(true)
    expect((await getDrillSet(setId))!.content.conversations).toEqual([])
  })
})
