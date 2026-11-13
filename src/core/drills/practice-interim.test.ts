import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../database'
import { loadCatalog } from '../study/catalog'
import { loadItems } from './items'
import { pickSentences } from '../phrases/sentences'
import { startContent, whenContent, withoutRepeats } from './content'
import { createDrillSet, getDrillSet } from './store'
import { applicable } from '../../pages/drills/tasks'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const YAO = 'vocabulary:yao4--want'
const ref = (lb: string) => `vocabulary:${lb}`
// 我 and 要 are known; 回 and 家 are not
const learner = () => new Set([...['wo3--me', 'yao4--want', 'shui3--water', 'yi1-dian3-r5--little'].map(ref), 'grammar:yi1-dian3-r5-mass--a-little', 'grammar:v-obj--object'])

beforeEach(async () => { await db.delete(); await db.open(); structured.requestStructuredJSON.mockReset() })

describe('practice-set sentences come from the words the learner knows', () => {
  it('gives 要 a fully known bank phrase when no lesson example is fully known, and never 我要回家', async () => {
    const catalog = await loadCatalog()
    const items = await loadItems([YAO], catalog)
    const allowed = learner()
    const picked = (await pickSentences(catalog, items, allowed))[YAO]
    expect(picked, 'a sentence').toBeDefined()
    expect(picked.unknown, 'not a fallback').toBeUndefined()
    expect(picked.zh).toContain('要')
    expect(picked.zh).not.toMatch(/回|家/)
  })
  it('takes the shortest usable bank phrase and prefers one not yet used in the set', async () => {
    const catalog = await loadCatalog()
    const items = await loadItems([YAO], catalog)
    const first = (await pickSentences(catalog, items, learner()))[YAO]
    expect(first).toMatchObject({ zh: '我要一点儿水。' })
    expect(first.unknown).toBeUndefined()
    const second = (await pickSentences(catalog, items, learner(), [first.zh]))[YAO]
    expect(second?.zh).not.toBe(first.zh)
  })
  it('uses a learner\'s own phrase as a bank phrase', async () => {
    const catalog = await loadCatalog()
    await db.userPhrases.put({ zh: '我要水。', py: 'wǒ yào shuǐ', en: 'I want water.', words: ['wo3--me', 'yao4--want', 'shui3--water'].map(ref), grammar: [], addedAt: 1 } as never)
    const [item] = await loadItems([YAO], catalog)
    const picked = (await pickSentences(catalog, [item], new Set(['wo3--me', 'yao4--want', 'shui3--water'].map(ref))))[YAO]
    expect(picked.zh).toBe('我要水。')
  })
  it('never gives two items the same sentence', async () => {
    const catalog = await loadCatalog()
    const refs = [YAO, ref('xiang3--want')]
    const items = await loadItems(refs, catalog)
    const allowed = new Set([...learner(), ...refs])
    const picked = await pickSentences(catalog, items, allowed)
    const texts = Object.values(picked).map(sentence => sentence.zh)
    expect(new Set(texts).size).toBe(texts.length)
    expect(withoutRepeats({ a: { zh: '我要水。', py: '', en: '', source: 'ai' } }, { b: { zh: '我要水', py: '', en: '', source: 'ai' }, c: { zh: '你好。', py: '', en: '', source: 'ai' } })).toEqual({
      a: { zh: '我要水。', py: '', en: '', source: 'ai' }, c: { zh: '你好。', py: '', en: '', source: 'ai' } })
  })
})

describe('a fallback is only a gap for the AI', () => {
  it('goes to the AI as a gap, and the AI sentence replaces the fallback', async () => {
    await db.aiConnections.add({ id: 'assistant', revision: 'r1', updatedAt: 1, apiType: 'chat-completions', baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', nativeTools: false, structuredOutput: true, storageAcknowledged: true })
    const id = await createDrillSet({ kind: 'new' })
    await whenContent(id)
    const catalog = await loadCatalog()
    const [item] = await loadItems([YAO], catalog)
    // the set starts with a stored fallback for 要 (我要回家 with 回 and 家 unknown)
    const set = (await getDrillSet(id))!
    await db.drillSets.put({ ...set, refs: [YAO], content: { ...set.content, state: 'pending', sentences: { [YAO]: { zh: '我要回家。', py: 'wǒ yào huí jiā', en: 'I want to go home.', source: 'catalog', unknown: ['回', '家'] } } } })
    await db.knowledge.clear()
    structured.requestStructuredJSON.mockImplementation(async (_c: unknown, request: { name: string; user: string }) =>
      request.name === 'drill_sentences' ? { sentences: [{ ref: YAO, zh: '我要要。', py: 'wǒ yào yào', en: 'I want it.' }] } : { conversations: [] })
    await startContent(id)
    const asked = structured.requestStructuredJSON.mock.calls.filter(call => (call[1] as { name: string }).name === 'drill_sentences')
    expect(asked.length).toBeGreaterThan(0)
    expect(item.zh).toBe('要')
    const after = (await getDrillSet(id))!.content.sentences[YAO]
    expect(after.zh).not.toBe('我要回家。')
  })
  it('keeps Translate and Write it away from an item whose only sentence is a fallback; Repeat after me keeps it', async () => {
    const catalog = await loadCatalog()
    const items = await loadItems([YAO], catalog)
    const fallback = { zh: '我要回家。', py: 'wǒ yào huí jiā', en: 'I want to go home.', source: 'catalog' as const, unknown: ['回', '家'] }
    const content = { state: 'ready' as const, sentences: { [YAO]: fallback }, conversations: [] }
    expect(applicable('translate', items, content)).toHaveLength(0)
    expect(applicable('write', items, content)).toHaveLength(1) // Write it shows the word alone
    expect(applicable('repeat', items, content)).toHaveLength(1)
    const known = { ...content, sentences: { [YAO]: { ...fallback, unknown: undefined } } }
    expect(applicable('translate', items, known)).toHaveLength(1)
    expect(applicable('write', items, known)).toHaveLength(1)
  })
})
