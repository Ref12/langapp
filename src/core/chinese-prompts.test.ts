// @vitest-environment jsdom
// The words the app sends to a model about Mandarin (docs/audits/2026-11-09-chinese-specific-inventory.md section 2.9, P1 to P15).
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
import { loadCatalog } from './study/catalog'
import { initializeWorkspace, loadWorkspace } from './database'
import { photoReadingPrompt } from './assistant/photo-answer'
import { generateSudokuPhrase } from './games/sudoku-phrases'
import { translateBook } from './library/translation'
import { linkEntries } from './media/entries'
import { translateMedia } from './media/translation'
import type { MediaItem } from './media/contracts'

const recorder = vi.hoisted(() => ({
  calls: [] as { name: string; system: string; user: string; schema: unknown }[],
  respond: (() => ({})) as (request: { name: string }) => unknown,
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

  it('P11 Sudoku phrase', async () => {
    await initializeWorkspace()
    await db.knowledge.bulkAdd(learnerFixture().snapshot.knowledge.study.knowledge.filter(entry => entry.kind === 'vocabulary').slice(0, 40))
    recorder.respond = () => ({ text: '', translation: '' })
    await generateSudokuPhrase(await loadCatalog(), await loadWorkspace(), 4, new AbortController().signal).catch(() => undefined)
    await expect(renderAll(recorder.calls)).toMatchFileSnapshot(FILE('P11-sudoku-phrase'))
  })

  it('P12 book translation', async () => {
    const book = learnerFixture().snapshot.library[0]
    await db.libraryBooks.add(book)
    recorder.respond = () => ({})
    await translateBook(book.id, [1], new AbortController().signal).catch(() => undefined)
    await expect(renderAll(recorder.calls)).toMatchFileSnapshot(FILE('P12-book-translation'))
  })

  const lines = [['你好，欢迎回来。', 0], ['今天我们做茶。', 3.5], ['先烧水。', 7]] as const
  const media = (translated: boolean): MediaItem => ({
    id: '00000000-0000-4000-8000-000000000301', savedAt: 1, url: 'https://media.invalid/v', title: 'Making tea', extractor: 'synthetic', source: 'captions', language: 'zh-Hans',
    lines: lines.map(([text, start], n) => ({ start, end: start + 3, text, ...(n < 0 ? {} : {}) })),
    ...(translated ? { aligned: {
      sentences: [{ lines: [0, 2] as [number, number], translation: 'Hello, welcome back. Today we make tea. First boil water.', fragments: [] }],
      tokens: [
        { line: 0, items: [{ text: '你好', pinyin: 'nǐ hǎo', meaning: 'hello', trailing: '，' }, { text: '欢迎', pinyin: 'huān yíng', meaning: 'welcome', trailing: '' }, { text: '回来', pinyin: 'huí lái', meaning: 'come back', trailing: '。' }] },
        { line: 1, items: [{ text: '今天', pinyin: 'jīn tiān', meaning: 'today', trailing: '' }, { text: '我们', pinyin: 'wǒ men', meaning: 'we', trailing: '' }, { text: '做', pinyin: 'zuò', meaning: 'make', trailing: '' }, { text: '茶', pinyin: 'chá', meaning: 'tea', trailing: '。' }] },
        { line: 2, items: [{ text: '先', pinyin: 'xiān', meaning: 'first', trailing: '' }, { text: '烧水', pinyin: 'shāo shuǐ', meaning: 'boil water', trailing: '。' }] },
      ],
      upTo: 3, updatedAt: 1,
    } } : {}),
  } as MediaItem)

  it('P13 media dictionary entries', async () => {
    await db.mediaItems.add(media(true))
    recorder.respond = () => ({ results: [] })
    await linkEntries(media(true).id, new AbortController().signal).catch(() => undefined)
    // the entry request is retried with the same words: pin each kind of request once
    await expect(renderAll([...new Map([...recorder.calls].reverse().map(call => [call.name, call])).values()].reverse())).toMatchFileSnapshot(FILE('P13-media-entries'))
  })

  it('P14 media subtitle translation, line follow-up and fragment follow-up', async () => {
    await db.mediaItems.add(media(false))
    recorder.respond = request => request.name === 'media_translation' ? { s: [{ l: [0, 1], t: 'Hello, welcome back. Today we make tea.', f: [] }], k: [] } : { r: [] }
    await translateMedia(media(false).id, new AbortController().signal, undefined, { concurrency: 1, chunkSize: 20, known: new Set() }).catch(() => undefined)
    const seen = new Map(recorder.calls.map(call => [call.name, call]))
    await expect(renderAll([...seen.values()])).toMatchFileSnapshot(FILE('P14-media-translation'))
  })

  it('P15 handwriting photo reading, for the three languages', async () => {
    const text = ['Chinese', 'Japanese', 'Korean'].map(name => { const prompt = photoReadingPrompt(name); return `### ${name}\n\n--- system ---\n${prompt.system}\n\n--- user (with the photo as an image part) ---\n${prompt.user}` }).join('\n\n') + '\n'
    await expect(text).toMatchFileSnapshot(FILE('P15-photo-answer'))
  })
})
