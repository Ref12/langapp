import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../database'
import { loadCatalog, renderExample } from '../study/catalog'
import { addLines } from './store'
import { showCollection, studyLines as studyLinesRaw } from './store'
import { findCatalogUnits } from './extract'
import { phraseRef } from './contracts'
import { whenGenerated } from '../study/generation'
const studyLines = async (...args: Parameters<typeof studyLinesRaw>) => { const id = await studyLinesRaw(...args); await whenGenerated(id); return id }

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)

const connection = {
  id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const,
}

const LINE = { text: '' }
/** One choice exercise per target, proposed in a deliberately scrambled order (line first, words last). */
function scrambled(request: { user: string }) {
  const targets: { ref: string }[] = JSON.parse(request.user).targets
  const refs = targets.map(target => target.ref)
  const make = (ref: string, index: number) => ({ id: 'e' + index, type: 'choice', targets: [ref], direction: 'zh-to-en', question: LINE.text, options: ['I am a student ' + index, 'I study ' + index], answer: 0, explanation: 'x' })
  return { exercises: [...refs.filter(r => r.startsWith('phrase:')), ...refs.filter(r => r.startsWith('grammar:')), ...refs.filter(r => r.startsWith('vocabulary:'))]
    .flatMap((ref, index) => [0, 1, 2, 3].map(k => make(ref, index * 4 + k))) }
}

beforeEach(async () => {
  await db.delete(); await db.open()
  structured.requestStructuredJSON.mockReset()
  structured.requestStructuredJSON.mockImplementation(async (_c: unknown, request: { user: string }) => scrambled(request))
})
afterEach(() => vi.restoreAllMocks())

async function grammarLine() {
  const catalog = await loadCatalog()
  for (const unit of catalog.units.values()) {
    if (unit.kind !== 'grammar' || !('segments' in unit.record.ex)) continue
    const text = renderExample(catalog, unit.record.ex).text
    const found = findCatalogUnits([text], catalog)
    if (found.some(item => item.kind === 'grammar') && found.filter(item => item.kind === 'vocabulary').length >= 2) return text
  }
  throw new Error('no fixture line')
}

describe('a collection lesson', () => {
  it('runs words, then grammar, then the line itself, whatever order the model proposes', async () => {
    await db.aiConnections.add(connection)
    const text = await grammarLine(); LINE.text = text
    const sessionId = await studyLines([{ text, translation: 'x', source: { mediaId: 'm1', title: 'Drama', line: 1, start: 1, text } }])
    const session = (await db.exerciseSessions.get(sessionId))!
    const kinds = session.exercises.filter(exercise => !exercise.id.startsWith('local-')).map(exercise => exercise.targets[0].split(':')[0])
    expect(kinds).toEqual([...kinds].sort((a, b) => ['vocabulary', 'grammar', 'phrase'].indexOf(a) - ['vocabulary', 'grammar', 'phrase'].indexOf(b)))
    expect(session.phases!.map(phase => phase.kind)).toEqual(['words', 'grammar', 'line'])
    expect(session.phases![0].start).toBe(0)
    expect(session.targetRefs.at(-1)).toBe(phraseRef(text))
    expect(session.targetRefs.findIndex(ref => ref.startsWith('grammar:'))).toBeGreaterThan(session.targetRefs.map(ref => ref.startsWith('vocabulary:')).lastIndexOf(true))
  })

  it('lists words in order of first appearance in the line', async () => {
    await db.aiConnections.add(connection)
    const catalog = await loadCatalog()
    const text = await grammarLine(); LINE.text = text
    const sessionId = await studyLines([{ text, source: { mediaId: 'm1', title: 'Drama', line: 1, start: 1, text } }])
    const words = (await db.exerciseSessions.get(sessionId))!.targetRefs.filter(ref => ref.startsWith('vocabulary:'))
    const at = words.map(ref => { const unit = catalog.units.get(ref)!; return unit.kind === 'vocabulary' ? text.indexOf(unit.record.ch) : -1 })
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })

  it('goes straight to the line when it has no catalog vocabulary', async () => {
    await db.aiConnections.add(connection)
    const text = '喵喵喵喵喵喵'; LINE.text = text
    expect(findCatalogUnits([text], await loadCatalog()).filter(unit => unit.kind === 'vocabulary')).toEqual([])
    const { id } = await showCollection('m1', 'Drama')
    await addLines(id, [{ text }])
    const sessionId = await studyLines([{ text, source: { mediaId: 'm1', title: 'Drama', line: 2, start: 2, text } }])
    const session = (await db.exerciseSessions.get(sessionId))!
    expect(session.phases).toEqual([{ kind: 'line', start: 0 }])
  })
})
