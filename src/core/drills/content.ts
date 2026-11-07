import { db } from '../database'
import { requestStructuredJSON } from '../ai/structured'
import { judgeWith, reviewMaterial } from '../ai/check'
import { loadCatalog, type Catalog } from '../study/catalog'
import { createSegmenter, type Segmenter } from '../study/exercises'
import { loadItems, FUNCTION_CHARACTERS, type ItemInfo } from './items'
import { pickSentences } from '../phrases/sentences'
import { conversationSchema, type Conversation, type DrillContent, type DrillSet, type Sentence } from './contracts'

// Sentences and conversations for the sentence drill types. The catalog's own examples come first; the AI writes only what the catalog lacks,
// in a few batched requests per set (never one per item), started in the background when the set is created.

export const SENTENCES_PER_REQUEST = 15
const MAX_CONVERSATION_ITEMS = 12
const han = /\p{Script=Han}/u
export { FUNCTION_CHARACTERS }
/** Words in the prompt are capped, most relevant first: the set's own band, then the most recently added. Validation always uses the whole knowledge set. */
export const MAX_KNOWN_IN_PROMPT = 300
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

export interface Allowed { segmenter: Segmenter; prompt: string[] }

/** The vocabulary AI practice material may use: the set's items, the learner's known curriculum words and the function characters. */
export function allowedVocabulary(catalog: Catalog, items: readonly ItemInfo[], knownRefs: readonly { ref: string; band?: string; addedAt?: number }[]): Allowed {
  const forms = new Set<string>(Array.from(FUNCTION_CHARACTERS))
  const own = new Set(items.map(item => item.ref))
  const bands = new Set(items.flatMap(item => { const unit = catalog.units.get(item.ref); return unit ? [unit.band] : [] }))
  for (const item of items) {
    forms.add(item.zh)
    for (const run of item.zh.match(/\p{Script=Han}+/gu) ?? []) for (const char of run) forms.add(char)
  }
  const words = [...knownRefs].sort((a, b) => Number(bands.has(b.band as never)) - Number(bands.has(a.band as never)) || (b.addedAt ?? 0) - (a.addedAt ?? 0))
    .flatMap(entry => { const unit = catalog.units.get(entry.ref); return unit?.kind === 'vocabulary' && !own.has(unit.ref) ? [unit.record] : [] })
  for (const record of words) forms.add(record.ch)
  const prompt = words.slice(0, MAX_KNOWN_IN_PROMPT).map(record => `${record.ch} (${record.pr}): ${record.ds}`)
  return { segmenter: createSegmenter(forms), prompt }
}

const RULE = 'Every Chinese word must come from the items, otherKnownVocabulary or the basic function characters 的了吗呢吧是不很也都和在有这那我你他她们个. No other words.'

/** Validates the model's sentences against what was asked: a known ref, Chinese text that contains the item, pinyin and plain English. */
export function validSentences(value: unknown, asked: readonly ItemInfo[], allowed?: Segmenter): Record<string, Sentence> {
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
    if (allowed && !allowed.covers(zh)) continue
    result[item.ref] = { zh: zh.trim(), py: py.trim(), en: en.trim(), source: 'ai' }
  }
  return result
}

export function validConversations(value: unknown, allowed?: Segmenter): Conversation[] {
  const rows = (value as { conversations?: unknown })?.conversations
  if (!Array.isArray(rows)) return []
  return rows.flatMap(row => {
    const parsed = conversationSchema.safeParse(row)
    if (!parsed.success) return []
    const conversation = parsed.data
    if (allowed && !conversation.lines.every(line => allowed.covers(line.zh)) ) return []
    const questions = conversation.questions.filter(question => question.after < conversation.lines.length && question.answer < question.options.length && new Set(question.options).size === question.options.length)
    return questions.length ? [{ ...conversation, questions }] : []
  })
}

/**
 * The check pass over sentences the AI wrote (one batched call per request, on this connection): natural Chinese, English that matches. A sentence that fails is rewritten once in one
 * batch and checked again, then dropped. Passed ones are marked checked; ones the check could not judge stay, unmarked as checked.
 */
export async function checkSentences(connection: Parameters<typeof requestStructuredJSON>[0], found: Record<string, Sentence>, asked: readonly ItemInfo[], allowed: Allowed, signal?: AbortSignal): Promise<Record<string, Sentence>> {
  const entries = Object.entries(found).map(([ref, sentence]) => ({ ref, sentence }))
  const review = await reviewMaterial(entries, {
    describe: entry => ({ id: entry.ref, kind: 'sentence', zh: entry.sentence.zh, en: entry.sentence.en }),
    check: judgeWith(connection, signal),
    rewrite: async failed => {
      const items = failed.map(entry => asked.find(item => item.ref === entry.item.ref)).filter((item): item is ItemInfo => !!item)
      const value = await requestStructuredJSON(connection, { name: 'drill_sentences', schema: sentenceSchemaJSON, system: SYSTEM, signal, maxOutputTokens: 3000,
        user: `Rewrite one short sentence (at most 14 characters) for each item below; the previous one failed review for the reason given. The Chinese sentence must contain the item's form. ${RULE} Return {"sentences":[{"ref","zh","py","en"}]} with the ref copied from the item.\n${JSON.stringify({ items: failed.map(entry => ({ ref: entry.item.ref, form: asked.find(item => item.ref === entry.item.ref)?.zh, previous: entry.item.sentence.zh, problem: entry.reason })), otherKnownVocabulary: allowed.prompt })}` })
      return Object.entries(validSentences(value, items, allowed.segmenter)).map(([ref, sentence]) => ({ ref, sentence }))
    },
  })
  return Object.fromEntries([
    ...review.accepted.map(entry => [entry.ref, { ...entry.sentence, checked: true }] as const),
    ...review.unchecked.map(entry => [entry.ref, { ...entry.sentence, checked: false }] as const),
  ])
}

/** The check pass over conversations (natural, English matches, each question has exactly one right option); those that fail are dropped. */
export async function checkConversations(connection: Parameters<typeof requestStructuredJSON>[0], conversations: Conversation[], signal?: AbortSignal): Promise<Conversation[]> {
  const review = await reviewMaterial(conversations.map((conversation, at) => ({ conversation, id: String(at) })), {
    describe: entry => ({ id: entry.id, kind: 'conversation', lines: entry.conversation.lines.map(line => ({ who: line.who, zh: line.zh, en: line.en })), questions: entry.conversation.questions.map(question => ({ question: question.question, options: question.options, answerIndex: question.answer })) }),
    check: judgeWith(connection, signal),
  })
  return [...review.accepted, ...review.unchecked].map(entry => entry.conversation)
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
  if (!set || set.status === 'abandoned') return
  const catalog = await loadCatalog()
  const items = await loadItems(set.refs, catalog)
  const sentences: Record<string, Sentence> = { ...set.content.sentences }
  const knowledge = await db.knowledge.toArray()
  // The catalog's examples, chosen from the learner's words: the knowledge set plus the set's own refs (see pickSentences).
  const chosen = await pickSentences(catalog, items.filter(item => !sentences[item.ref]), new Set([...knowledge.map(entry => entry.ref), ...set.refs]))
  Object.assign(sentences, chosen)
  const allowed = allowedVocabulary(catalog, items, knowledge)
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
          user: `Write exactly one short sentence (at most 14 characters) for each item below. The Chinese sentence must contain the item's form. ${RULE} Return {"sentences":[{"ref","zh","py","en"}]} with the ref copied from the item.\n${JSON.stringify({ items: chunk.map(item => ({ ref: item.ref, form: item.zh, pinyin: item.py, meaning: item.en })), otherKnownVocabulary: allowed.prompt })}` })
        const found = await checkSentences(connection, validSentences(value, chunk, allowed.segmenter), chunk, allowed, signal)
        await patch(setId, content => ({ ...content, sentences: { ...content.sentences, ...found } }))
      } catch (reason) { note(reason) }
      await finished()
    }),
    ...(wantConversations ? [(async () => {
      try {
        const subject = items.slice(0, MAX_CONVERSATION_ITEMS)
        const value = await requestStructuredJSON(connection, { name: 'drill_conversations', schema: conversationJSON, system: SYSTEM, signal, maxOutputTokens: 4000,
          user: `Write 2 short conversations (4 to 6 lines each, speakers A and B) that use these study items between them. After some lines add a comprehension question in English with 2 to 4 options; "after" is the 0-based index of the line it follows and "answer" the 0-based index of the right option. Each conversation has 2 questions. ${RULE} The English questions and options may use any English.\n${JSON.stringify({ items: subject.map(item => ({ form: item.zh, pinyin: item.py, meaning: item.en })), otherKnownVocabulary: allowed.prompt })}` })
        const found = await checkConversations(connection, validConversations(value, allowed.segmenter), signal)
        if (!found.length) throw new Error('The AI produced no usable conversation.')
        await patch(setId, content => ({ ...content, conversations: found }))
      } catch (reason) { note(reason) }
      await finished()
    })()] : []),
  ])
  if (signal.aborted) return
  await patch(setId, content => failure ? { ...content, state: 'failed', error: failure.message.slice(0, 600) } : { ...content, state: 'ready', error: undefined })
}
