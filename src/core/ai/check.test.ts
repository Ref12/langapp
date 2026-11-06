import { describe, expect, it, vi } from 'vitest'
import { reviewMaterial, type JudgeItem, type Verdict } from './check'
import { checkSentences, allowedVocabulary } from '../drills/content'
import { checkExercises } from '../study/exercises'
import { loadCatalog } from '../study/catalog'
import { loadItems } from '../drills/items'
import type { ChoiceExercise } from '../study/contracts'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('./structured', () => structured)

type Item = { id: string; zh: string }
const describeItem = (item: Item): JudgeItem => ({ id: item.id, kind: 'sentence', zh: item.zh, en: 'x' })
const verdicts = (rows: Record<string, boolean>) => new Map<string, Verdict>(Object.entries(rows).map(([id, ok]) => [id, { ok, reason: ok ? '' : 'bad' }]))

describe('review of AI-written material', () => {
  it('keeps what passes, rewrites what fails once in one batch, and checks the rewrite', async () => {
    const check = vi.fn()
      .mockResolvedValueOnce(verdicts({ a: true, b: false }))
      .mockResolvedValueOnce(verdicts({ b2: true }))
    const rewrite = vi.fn(async (failed: readonly { item: Item; reason: string }[]) => failed.map(entry => ({ id: entry.item.id + '2', zh: 'fixed' })))
    const result = await reviewMaterial<Item>([{ id: 'a', zh: '好' }, { id: 'b', zh: '坏' }], { describe: describeItem, check, rewrite })
    expect(result.accepted.map(item => item.id)).toEqual(['a', 'b2'])
    expect(rewrite).toHaveBeenCalledTimes(1)
    expect(rewrite.mock.calls[0][0]).toEqual([{ item: { id: 'b', zh: '坏' }, reason: 'bad' }])
    expect(check).toHaveBeenCalledTimes(2)
  })
  it('drops material that fails again after the rewrite, or that has no rewrite', async () => {
    const twice = await reviewMaterial<Item>([{ id: 'b', zh: '坏' }], { describe: describeItem, check: vi.fn().mockResolvedValueOnce(verdicts({ b: false })).mockResolvedValueOnce(verdicts({ b2: false })), rewrite: async () => [{ id: 'b2', zh: 'still bad' }] })
    expect(twice.accepted).toEqual([]); expect(twice.dropped).toHaveLength(1)
    const none = await reviewMaterial<Item>([{ id: 'b', zh: '坏' }], { describe: describeItem, check: async () => verdicts({ b: false }) })
    expect(none.dropped.map(entry => entry.item.id)).toEqual(['b'])
  })
  it('does not block practice when the check call itself fails: the material stays, unchecked, and the failure is logged', async () => {
    const log = vi.fn()
    const result = await reviewMaterial<Item>([{ id: 'a', zh: '好' }, { id: 'b', zh: '坏' }], { describe: describeItem, check: async () => { throw new Error('offline') } }, log)
    expect(result.unchecked.map(item => item.id)).toEqual(['a', 'b'])
    expect(result.accepted).toEqual([]); expect(result.dropped).toEqual([])
    expect(log).toHaveBeenCalledWith(expect.stringContaining('offline'))
    // a rewrite that fails drops only the failed one
    const rewriteFails = await reviewMaterial<Item>([{ id: 'a', zh: '好' }, { id: 'b', zh: '坏' }], { describe: describeItem, check: async () => verdicts({ a: true, b: false }), rewrite: async () => { throw new Error('nope') } }, log)
    expect(rewriteFails.accepted.map(item => item.id)).toEqual(['a']); expect(rewriteFails.dropped.map(entry => entry.item.id)).toEqual(['b'])
  })
})

describe('the check pass on what the app generates', () => {
  const connection = { baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm', apiType: 'chat', nativeTools: false, structuredOutput: true, storageAcknowledged: true } as never
  const row = (id: string, ok: boolean) => ({ id, natural: ok, matches: true, oneRight: true, wrongClear: true, reason: ok ? '' : 'unnatural' })

  it('marks passing drill sentences checked, rewrites a failing one once in a batch, and does the whole set in two judge calls plus one rewrite', async () => {
    const catalog = await loadCatalog()
    const student = 'vocabulary:xue2-sheng5--student'
    const items = await loadItems([student, 'vocabulary:wo3--me'], catalog)
    const allowed = allowedVocabulary(catalog, items, [{ ref: 'vocabulary:ni3--you' }])
    structured.requestStructuredJSON.mockReset()
    structured.requestStructuredJSON
      .mockResolvedValueOnce({ results: [row(student, false), row('vocabulary:wo3--me', true)] })
      .mockResolvedValueOnce({ sentences: [{ ref: student, zh: '你是学生', py: 'nǐ shì xué sheng', en: 'You are a student' }] })
      .mockResolvedValueOnce({ results: [row(student, true)] })
    const found = await checkSentences(connection, {
      [student]: { zh: '我学生', py: 'wǒ xué sheng', en: 'I student', source: 'ai' },
      'vocabulary:wo3--me': { zh: '我是学生', py: 'wǒ shì xué sheng', en: 'I am a student', source: 'ai' },
    }, items, allowed)
    expect(found[student]).toMatchObject({ zh: '你是学生', checked: true })
    expect(found['vocabulary:wo3--me']).toMatchObject({ checked: true })
    expect(structured.requestStructuredJSON).toHaveBeenCalledTimes(3)
    // a failed check call keeps the sentences, unchecked
    structured.requestStructuredJSON.mockReset().mockRejectedValue(new Error('down'))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const unchecked = await checkSentences(connection, { [student]: { zh: '我是学生', py: 'wǒ shì xué sheng', en: 'I am a student', source: 'ai' } }, items, allowed)
    expect(unchecked[student]).toMatchObject({ zh: '我是学生', checked: false })
  })

  it('drops a lesson choice whose wrong option is a second right answer (the 有一点儿冷 case) and keeps the rest', async () => {
    const choice = (id: string, options: string[]): ChoiceExercise => ({ id, type: 'choice', targets: ['vocabulary:wo3--me'], direction: 'en-to-zh', question: 'I feel a bit cold.', options, answer: 0, explanation: 'x' })
    const result = { exercises: [choice('c1', ['我觉得有一点儿冷', '有一点儿冷']), choice('c2', ['我觉得有一点儿冷', '我是学生'])], rejected: [] as string[] }
    structured.requestStructuredJSON.mockReset().mockResolvedValue({ results: [{ ...row('c1', true), wrongClear: false, reason: 'both options are right' }, row('c2', true)] })
    const checked = await checkExercises(connection, result)
    expect(checked.exercises.map(exercise => exercise.id)).toEqual(['c2'])
    expect(checked.rejected[0]).toContain('c1: failed the check')
    const sent = JSON.parse(structured.requestStructuredJSON.mock.calls[0][1].user.split('\n').slice(1).join('\n'))
    expect(sent.items[0]).toMatchObject({ kind: 'choice', options: ['我觉得有一点儿冷', '有一点儿冷'], answerIndex: 0 })
    // a failed check call leaves the exercises as they were
    structured.requestStructuredJSON.mockReset().mockRejectedValue(new Error('down'))
    expect((await checkExercises(connection, result)).exercises).toHaveLength(2)
  })
})
