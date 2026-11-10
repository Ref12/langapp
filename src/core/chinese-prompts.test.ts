// @vitest-environment jsdom
// The words the app sends to a model about Mandarin (docs/audits/2026-11-09-chinese-specific-inventory.md section 2.9, P1 to P14).
// Each prompt is built by the app's own code for a fixed input and compared with a readable text file in __prompts__/. A failure shows the
// changed words as a diff of that file. Where a prompt is not exported, the call is driven through its public entry point with the model
// call replaced by a recorder (no production code is touched); the recorder keeps what would have been sent: name, system, user and schema.
//
// To accept a deliberate wording change, review the diff and update the files with:
//   npx vitest run src/core/chinese-prompts.test.ts -u
// Nothing is ever rewritten without -u. The "user" part is shown re-indented for reading (its content and key order are exact).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from './database'
import { resetProfileStorage } from '../test/profile-storage'
import { REPLY_INSTRUCTIONS, nativeToolDefinitions } from './ai/provider'
import { buildTutorMessages } from './assistant/tools'
import type { AssistantMessage, AssistantThread } from './assistant/contracts'
import { buildGenerationPrompt, type GenerationInput } from './study/exercises'
import { buildCatalog, requireUnit, type BandData } from './study/catalog'
import { judgeItems } from './ai/check'
import { englishGists } from './collections/naming'
import { checkSentences, startContent } from './drills/content'
import { learnerFixture } from './profiles/fixtures/learner'

const recorder = vi.hoisted(() => ({
  calls: [] as { name: string; system: string; user: string; schema: unknown }[],
  respond: (_request: { name: string }): unknown => ({}),
}))
vi.mock('./ai/structured', async importOriginal => ({
  ...(await importOriginal<typeof import('./ai/structured')>()),
  requestStructuredJSON: vi.fn(async (_connection: unknown, request: { name: string; system: string; user: string; schema: unknown }) => {
    recorder.calls.push({ name: request.name, system: request.system, user: request.user, schema: request.schema })
    return recorder.respond(request)
  }),
}))

const here = dirname(fileURLToPath(import.meta.url))
const FILE = (name: string) => './__prompts__/' + name + '.txt'
const pretty = (text: string) => { try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text } }
const render = (call: { name: string; system: string; user: string; schema: unknown }) =>
  '=== request: ' + call.name + ' ===\n\n--- system ---\n' + call.system + '\n\n--- user ---\n' + pretty(call.user) + '\n\n--- schema ---\n' + JSON.stringify(call.schema, null, 2) + '\n'
const renderAll = (calls: typeof recorder.calls) => calls.map(render).join('\n')
const connection = { id: 'assistant', revision: 'r1', updatedAt: 1, apiType: 'chat-completions', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic-key', model: 'synthetic-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true } as const
const first = (name: string) => { const call = recorder.calls.find(entry => entry.name === name); if (!call) throw new Error('no request named ' + name + ' (saw ' + recorder.calls.map(entry => entry.name).join(', ') + ')'); return call }

beforeEach(async () => {
  recorder.calls.length = 0
  recorder.respond = () => ({})
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await resetProfileStorage()
  await db.aiConnections.put(connection as never)
})
afterEach(() => { vi.restoreAllMocks() })

describe('prompt files and the tutor envelope (P1 to P4, P6, P7)', () => {
  const thread: AssistantThread = {
    id: 't', title: 'test', draft: '', mode: 'conversation', shadowIntent: 'new-phrase', romanization: true, speechRate: 0.75, returnRoute: 'overview', createdAt: 0, updatedAt: 0,
  }
  const current: AssistantMessage = {
    id: 'current', threadId: 't', sequence: 1, text: 'How do I say thank you?', role: 'user', blocks: [], mode: 'conversation', intent: 'message', status: 'completed', createdAt: 0,
  }
  const system = (mode: 'conversation' | 'shadow', intent: AssistantMessage['intent'], extra: Partial<AssistantThread> = {}, title = false) => {
    const content = buildTutorMessages({ ...thread, mode, ...extra }, { ...current, mode, intent }, [], '{"counts":{}}', title)[0].content as string
    expect(content.startsWith(REPLY_INSTRUCTIONS + '\n\n')).toBe(true)
    return content.slice(REPLY_INSTRUCTIONS.length + 2)
  }

  it('P6 reply format', async () => { await expect(REPLY_INSTRUCTIONS + '\n').toMatchFileSnapshot(FILE('P06-reply-format')) })
  it('P1 conversation mode, as sent after the reply format', async () => { await expect(system('conversation', 'message') + '\n').toMatchFileSnapshot(FILE('P01-conversation-mode')) })
  it('P2 shadow mode, as sent after the reply format', async () => { await expect(system('shadow', 'shadow') + '\n').toMatchFileSnapshot(FILE('P02-shadow-mode')) })
  it('P3 explain intent, as sent after the reply format', async () => { await expect(system('conversation', 'explain') + '\n').toMatchFileSnapshot(FILE('P03-explain-intent')) })
  it('P7 Assistant envelope: first-message title, voice input, tool descriptions', async () => {
    const text = [
      '### first message in a new conversation, voice on', system('conversation', 'message', { voiceEnabled: true }, true),
      '### tools sent to the model', JSON.stringify(nativeToolDefinitions, null, 2),
    ].join('\n\n') + '\n'
    await expect(text).toMatchFileSnapshot(FILE('P07-assistant-envelope'))
  })
  it('P4 repeat.md (reserved: the app does not load it, so the file itself is pinned)', async () => {
    await expect(readFileSync(join(here, '../../settings/system-prompts/repeat.md'), 'utf8')).toMatchFileSnapshot(FILE('P04-repeat-reserved'))
  })
})

describe('exercise writer (P5)', () => {
  const band: BandData = {
    schemaVersion: 1, band: '1', alignment: 'hsk-1',
    vocabulary: [
      { id: 'v1', ch: '我', pr: 'wǒ', ds: 'I, me', lb: 'wo3--me' }, { id: 'v2', ch: '是', pr: 'shì', ds: 'am; is; are', lb: 'shi4--identity' },
      { id: 'v3', ch: '学生', pr: 'xué sheng', ds: 'student', lb: 'xue2-sheng5--student' }, { id: 'v4', ch: '学习', pr: 'xué xí', ds: 'study', lb: 'xue2-xi2--study' },
      { id: 'v5', ch: '老师', pr: 'lǎo shī', ds: 'teacher', lb: 'lao3-shi1--teacher' },
    ],
    grammar: [{
      id: 'g1', pt: '<subject> + 是 + <noun>', pr: '<subject> + shì + <noun>', ds: 'Identify with a noun.', lb: 's-shi4-n--identity',
      ex: { segments: [{ word: 'wo3--me' }, { word: 'shi4--identity' }, { word: 'xue2-sheng5--student' }, { punctuation: '。' }], translation: 'I am a student.', grammar: ['s-shi4-n--identity'] },
    }],
    groups: [{
      id: 'zh-hsk-1-lesson-0001',
      units: [{ kind: 'vocabulary', ref: 'wo3--me' }, { kind: 'vocabulary', ref: 'shi4--identity' }, { kind: 'vocabulary', ref: 'xue2-sheng5--student' }, { kind: 'grammar', ref: 's-shi4-n--identity' }],
      examples: [{ id: 'grammar-g1', segments: [{ word: 'wo3--me' }, { word: 'shi4--identity' }, { word: 'xue2-sheng5--student' }, { punctuation: '。' }], translation: 'I am a student.', grammar: ['s-shi4-n--identity'] }],
    }],
  }
  it('P5 builds the system and user message for a fixed lesson', async () => {
    const catalog = buildCatalog([band])
    const input: GenerationInput = {
      mode: 'new', targets: ['vocabulary:wo3--me', 'vocabulary:shi4--identity', 'vocabulary:xue2-sheng5--student', 'grammar:s-shi4-n--identity'].map(ref => requireUnit(catalog, ref)),
      review: [requireUnit(catalog, 'vocabulary:xue2-xi2--study')], allowed: [...catalog.units.values()], catalog,
    }
    const prompt = buildGenerationPrompt(input)
    await expect('--- system ---\n' + prompt.system + '\n\n--- user ---\n' + pretty(prompt.user) + '\n').toMatchFileSnapshot(FILE('P05-exercise-writer'))
  })
})

describe('prompts built inside a request (P8 to P14), recorded at the model call', () => {
  it('P8 material check', async () => {
    recorder.respond = () => ({ results: [] })
    await judgeItems(connection as never, [
      { id: 's1', kind: 'sentence', zh: '我爱妈妈。', en: 'I love Mom.' },
      { id: 'c1', kind: 'choice', direction: 'zh-to-en', prompt: '茶', options: ['tea', 'rain'], answerIndex: 0 },
    ])
    await expect(renderAll(recorder.calls)).toMatchFileSnapshot(FILE('P08-material-check'))
  })

  it('P9 study-set names', async () => {
    recorder.respond = () => ({ names: ['Making Tea'] })
    await englishGists(['做茶'])
    await expect(renderAll(recorder.calls)).toMatchFileSnapshot(FILE('P09-study-set-names'))
  })

  it('P10 drill sentences, conversations, and the rewrite after a failed check', async () => {
    const { extras, snapshot } = learnerFixture()
    const set = { ...extras.drillSets[0], status: 'active' as const, content: { state: 'pending' as const, sentences: {}, conversations: [] } }
    await db.knowledge.bulkAdd(snapshot.knowledge.study.knowledge.slice(0, 6))
    await db.drillSets.put(set)
    await startContent(set.id)
    const calls = [...recorder.calls]
    recorder.calls.length = 0
    recorder.respond = request => request.name === 'material_check' ? { results: [{ id: set.refs[0], natural: false, matches: true, oneRight: true, wrongClear: true, reason: 'unnatural' }] } : { sentences: [] }
    const asked = [{ ref: set.refs[0], kind: 'vocabulary', zh: '爱', py: 'ài', en: 'to love' }]
    await checkSentences(connection as never, { [set.refs[0]]: { zh: '我爱爱爱。', py: 'wǒ ài ài ài', en: 'I love love love.', source: 'ai' } }, asked as never, { segmenter: { covers: () => true } as never, prompt: ['爱 (ài): to love'] })
    await expect(renderAll([...calls, ...recorder.calls])).toMatchFileSnapshot(FILE('P10-drill-content'))
  })
})
