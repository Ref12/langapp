import { db } from '../database'
import { requestStructuredJSON } from '../ai/structured'
import { loadCatalog } from '../study/catalog'
import { catalogSentence, loadItems, type ItemInfo } from './items'
import { conversationSchema, type Conversation, type DrillContent, type DrillSet, type Sentence } from './contracts'

// Sentences and conversations for the sentence drill types. The catalog's own examples come first; the AI writes only what the catalog lacks,
// in a few batched requests per set (never one per item), started in the background when the set is created.

export const SENTENCES_PER_REQUEST = 15
const MAX_CONVERSATION_ITEMS = 12
const han = /\p{Script=Han}/u
const inflight = new Map<string, Promise<void>>()
const controllers = new Map<string, AbortController>()

export const isContentRunning = (setId: string) => inflight.has(setId)
export const whenContent = (setId: string) => inflight.get(setId) ?? Promise.resolve()
export function cancelContent(setId: string): void { controllers.get(setId)?.abort() }

/** A running flag with no request behind it (the page was reloaded) is shown as interrupted. */
export function effectiveContent(set: Pick<DrillSet, 'id' | 'content'>): DrillContent {
  const content = set.content
  return content.state === 'running' && !isContentRunning(set.id)
    ? { ...content, state: 'failed', error: 'Generating the sentences was interrupted.' } : content
}

async function patch(setId: string, change: (content: DrillContent) => DrillContent): Promise<void> {
  await db.transaction('rw', db.drillSets, async () => {
    const set = await db.drillSets.get(setId)
    if (set) await db.drillSets.put({ ...set, content: change(set.content), updatedAt: Date.now() })
  })
}

const sentenceSchemaJSON = {
  type: 'object', additionalProperties: false, required: ['sentences'],
  properties: { sentences: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['ref', 'zh', 'py', 'en'],
    properties: { ref: { type: 'string' }, zh: { type: 'string' }, py: { type: 'string' }, en: { type: 'string' } } } } },
}
const conversationJSON = {
  type: 'object', additionalProperties: false, required: ['conversations'],
  properties: { conversations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'lines', 'questions'], properties: {
    title: { type: 'string' },
    lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['who', 'zh', 'py', 'en'], properties: { who: { type: 'string' }, zh: { type: 'string' }, py: { type: 'string' }, en: { type: 'string' } } } },
    questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['after', 'question', 'options', 'answer'], properties: {
      after: { type: 'integer' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' } } } },
  } } } },
}

const SYSTEM = 'You write short Mandarin practice material for an English-speaking learner. Use simple, natural, everyday Chinese. Pinyin has tone marks and spaces between syllables. English has no Chinese characters. Reply with JSON only.'

/** Validates the model's sentences against what was asked: a known ref, Chinese text that contains the item, pinyin and plain English. */
export function validSentences(value: unknown, asked: readonly ItemInfo[]): Record<string, Sentence> {
  const result: Record<string, Sentence> = {}
  const rows = (value as { sentences?: unknown })?.sentences
  if (!Array.isArray(rows)) return result
  for (const row of rows as Record<string, unknown>[]) {
    const item = asked.find(entry => entry.ref === row?.ref)
    if (!item || result[item.ref]) continue
    const { zh, py, en } = row as Record<string, unknown>
    if (typeof zh !== 'string' || typeof py !== 'string' || typeof en !== 'string') continue
    if (!han.test(zh) || zh.length > 60 || !py.trim() || !en.trim() || han.test(en) || han.test(py)) continue
    if (item.kind !== 'grammar' && !zh.includes(item.zh)) continue
    result[item.ref] = { zh: zh.trim(), py: py.trim(), en: en.trim(), source: 'ai' }
  }
  return result
}

export function validConversations(value: unknown): Conversation[] {
  const rows = (value as { conversations?: unknown })?.conversations
  if (!Array.isArray(rows)) return []
  return rows.flatMap(row => {
    const parsed = conversationSchema.safeParse(row)
    if (!parsed.success) return []
    const conversation = parsed.data
    const questions = conversation.questions.filter(question => question.after < conversation.lines.length && question.answer < question.options.length && new Set(question.options).size === question.options.length)
    return questions.length ? [{ ...conversation, questions }] : []
  })
}

/** Fills the set's sentences from the catalog at once and the rest, plus the conversations, from the AI in the background. */
export function startContent(setId: string): Promise<void> {
  const existing = inflight.get(setId)
  if (existing) return existing
  const controller = new AbortController()
  controllers.set(setId, controller)
  const work = generate(setId, controller.signal).catch(async reason => {
    await patch(setId, content => ({ ...content, state: 'failed', error: (reason instanceof Error ? reason.message : 'The sentences could not be generated.').slice(0, 600) })).catch(() => undefined)
  }).finally(() => { inflight.delete(setId); controllers.delete(setId) })
  inflight.set(setId, work)
  return work
}

async function generate(setId: string, signal: AbortSignal): Promise<void> {
  const set = await db.drillSets.get(setId)
  if (!set || set.status !== 'active') return
  const catalog = await loadCatalog()
  const items = await loadItems(set.refs, catalog)
  const sentences: Record<string, Sentence> = { ...set.content.sentences }
  for (const item of items) if (!sentences[item.ref]) { const found = catalogSentence(catalog, item); if (found) sentences[item.ref] = found }
  const gaps = items.filter(item => !sentences[item.ref] && item.kind !== 'phrase')
  const wantConversations = set.content.conversations.length === 0
  const connection = await db.aiConnections.get('assistant')
  if (!connection) {
    await patch(setId, content => ({ ...content, sentences, state: gaps.length || wantConversations ? 'no-ai' : 'ready', error: undefined }))
    return
  }
  const chunks: ItemInfo[][] = []
  for (let start = 0; start < gaps.length; start += SENTENCES_PER_REQUEST) chunks.push(gaps.slice(start, start + SENTENCES_PER_REQUEST))
  const total = chunks.length + (wantConversations ? 1 : 0)
  await patch(setId, content => ({ ...content, sentences, state: total ? 'running' : 'ready', error: undefined, done: 0, total }))
  if (!total) return
  let failure: Error | undefined
  const finished = () => patch(setId, content => ({ ...content, done: (content.done ?? 0) + 1 }))
  const note = (reason: unknown) => { failure ??= reason instanceof Error ? reason : new Error('The AI request failed.') }
  await Promise.all([
    ...chunks.map(async chunk => {
      try {
        const value = await requestStructuredJSON(connection, { name: 'drill_sentences', schema: sentenceSchemaJSON, system: SYSTEM, signal, maxOutputTokens: 3000,
          user: `Write exactly one short sentence (at most 14 characters) for each item below. The Chinese sentence must contain the item's form. Return {"sentences":[{"ref","zh","py","en"}]} with the ref copied from the item.\n${JSON.stringify(chunk.map(item => ({ ref: item.ref, form: item.zh, pinyin: item.py, meaning: item.en })))}` })
        const found = validSentences(value, chunk)
        await patch(setId, content => ({ ...content, sentences: { ...content.sentences, ...found } }))
      } catch (reason) { note(reason) }
      await finished()
    }),
    ...(wantConversations ? [(async () => {
      try {
        const subject = items.slice(0, MAX_CONVERSATION_ITEMS)
        const value = await requestStructuredJSON(connection, { name: 'drill_conversations', schema: conversationJSON, system: SYSTEM, signal, maxOutputTokens: 4000,
          user: `Write 2 short conversations (4 to 6 lines each, speakers A and B) that use these study items between them. After some lines add a comprehension question in English with 2 to 4 options; "after" is the 0-based index of the line it follows and "answer" the 0-based index of the right option. Each conversation has 2 questions.\n${JSON.stringify(subject.map(item => ({ form: item.zh, pinyin: item.py, meaning: item.en })))}` })
        const found = validConversations(value)
        if (!found.length) throw new Error('The AI produced no usable conversation.')
        await patch(setId, content => ({ ...content, conversations: found }))
      } catch (reason) { note(reason) }
      await finished()
    })()] : []),
  ])
  if (signal.aborted) return
  await patch(setId, content => failure ? { ...content, state: 'failed', error: failure.message.slice(0, 600) } : { ...content, state: 'ready', error: undefined })
}
