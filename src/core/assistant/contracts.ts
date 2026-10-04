import { z } from 'zod'
import { speechAssessmentSchema } from './speech-contracts'
import { practiceChainSchema } from './practice-chain-contracts'

export const MAX_DRAFT_LENGTH = 8000
export const MAX_TOOL_ROUNDS = 4
export const RUN_TIMEOUT_MS = 120_000
export const LOOPBACK_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]']

const id = z.string().min(1).max(200)
const timestamp = z.number().int().nonnegative()
export const assistantModeSchema = z.enum(['conversation', 'shadow'])
export const assistantIntentSchema = z.enum(['message', 'shadow', 'repeat', 'explain'])
export const speechLocaleSchema = z.enum(['en-US', 'zh-Hans'])
export const speechRateSchema = z.union([z.literal(0.25), z.literal(0.5), z.literal(0.75), z.literal(1), z.literal(1.25)])
export type SpeechRate = z.infer<typeof speechRateSchema>

export const browserVoicePreferenceSchema = z.object({
  voiceURI: z.string().max(2048),
  name: z.string().max(512),
  lang: z.string().min(1).max(100),
  localService: z.boolean(),
}).strict()
export const edgeVoiceIdSchema = z.string().regex(/^(?:en-[A-Z]{2}|zh-(?:CN|SG|TW))(?:-[a-z]+)?-[A-Za-z][A-Za-z0-9]{0,63}Neural$/)
export const edgeVoicePreferenceSchema = z.object({
  provider: z.literal('edge'),
  voice: edgeVoiceIdSchema,
}).strict()
export const speechVoicePreferencesSchema = z.object({
  'zh-Hans': z.union([browserVoicePreferenceSchema, edgeVoicePreferenceSchema.refine(value => value.voice.startsWith('zh-'))]).optional(),
  'en-US': z.union([browserVoicePreferenceSchema, edgeVoicePreferenceSchema.refine(value => value.voice.startsWith('en-'))]).optional(),
}).strict()
export type BrowserVoicePreference = z.infer<typeof browserVoicePreferenceSchema>
export type EdgeVoicePreference = z.infer<typeof edgeVoicePreferenceSchema>
export type SpeechVoicePreference = BrowserVoicePreference | EdgeVoicePreference
export type SpeechVoicePreferences = z.infer<typeof speechVoicePreferencesSchema>

export function isEdgeVoice(preference: SpeechVoicePreference | undefined): preference is EdgeVoicePreference {
  return Boolean(preference && 'provider' in preference && preference.provider === 'edge')
}

export const assistantSourceSchema = z.object({
  text: z.string().min(1).max(MAX_DRAFT_LENGTH).refine(value => value.trim().length > 0, 'Source text must not be blank.'),
  title: z.string().min(1).max(200),
  route: z.string().min(1).max(300).regex(/^[\w:/.-]+$/),
  meaning: z.string().max(3000).optional(),
  locale: speechLocaleSchema.optional(),
}).strict()

export const textBlockSchema = z.object({
  type: z.literal('text'),
  markdown: z.string().trim().min(1).max(12000),
}).strict()
export const speechBlockSchema = z.object({
  type: z.literal('speech'),
  text: z.string().trim().min(1).max(3000),
  locale: speechLocaleSchema,
  romanization: z.string().max(3000).optional(),
  meaning: z.string().max(3000).optional(),
}).strict()
export const practiceInputSchema = z.enum(['listen-repeat', 'spoken-feedback'])
export const practicePhraseSchema = speechBlockSchema.extend({ locale: z.literal('zh-Hans') })
export const practiceHistoryEntrySchema = z.object({
  text: z.string().min(1).max(3000),
  phrase: practicePhraseSchema,
  rate: speechRateSchema,
  lastOpenedAt: timestamp,
  chain: practiceChainSchema.optional(),
}).strict().refine(entry => entry.text === entry.phrase.text && (!entry.chain || entry.chain.text === entry.text),
  'History must retain the exact practiced phrase.')
export type PracticeHistoryEntry = z.infer<typeof practiceHistoryEntrySchema>
export const practiceAttemptSchema = z.object({
  phrase: practicePhraseSchema,
  input: z.literal('speech-transcript'),
}).strict()
const practiceResultBase = z.object({
  phrase: practicePhraseSchema,
  transcript: z.string().max(MAX_DRAFT_LENGTH),
})
export const practiceResultSchema = z.discriminatedUnion('kind', [
  practiceResultBase.extend({ kind: z.literal('transcript-diff'), reason: z.enum(['not-configured', 'disabled']) }).strict(),
  practiceResultBase.extend({ kind: z.literal('azure'), assessment: speechAssessmentSchema }).strict(),
  practiceResultBase.extend({ kind: z.literal('error'), service: z.enum(['azure', 'browser']), error: z.string().min(1).max(1000) }).strict(),
])
export const assistantBlockSchema = z.discriminatedUnion('type', [textBlockSchema, speechBlockSchema])
export const assistantReplySchema = z.object({
  blocks: z.array(assistantBlockSchema).min(1).max(12),
  conversationTitle: z.string().trim().min(1).max(120).nullable().optional(),
}).strict().transform(normalizeAssistantReply)

export function normalizeAssistantReply(reply: { blocks: AssistantBlock[]; conversationTitle?: string | null }) {
  return {
    ...(reply.conversationTitle ? { conversationTitle: reply.conversationTitle } : {}),
    blocks: reply.blocks.map(block => {
      if (block.type === 'text') return block
      const { romanization, meaning, ...speech } = block
      return {
        ...speech,
        ...(romanization?.trim() ? { romanization } : {}),
        ...(meaning?.trim() ? { meaning } : {}),
      }
    }),
  }
}

export const assistantThreadSchema = z.object({
  id,
  title: z.string().min(1).max(120),
  titleManuallySet: z.boolean().optional(),
  draft: z.string().max(MAX_DRAFT_LENGTH),
  source: assistantSourceSchema.optional(),
  mode: assistantModeSchema,
  shadowIntent: z.enum(['new-phrase', 'repeat']),
  shadowPhrase: speechBlockSchema.optional(),
  practiceInput: practiceInputSchema.optional(),
  speechFeedback: z.boolean().optional(),
  voiceEnabled: z.boolean().optional(),
  voiceInputLocale: speechLocaleSchema.optional(),
  practicePhrase: practicePhraseSchema.optional(),
  practiceDraft: z.string().max(MAX_DRAFT_LENGTH).optional(),
  practiceChain: practiceChainSchema.optional(),
  romanization: z.boolean(),
  speechRate: speechRateSchema,
  returnRoute: z.string().min(1).max(300).regex(/^[\w:/.-]+$/),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict()

export const assistantMessageSchema = z.object({
  id,
  threadId: id,
  sequence: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant', 'event', 'practice']),
  text: z.string().max(MAX_DRAFT_LENGTH),
  blocks: z.array(assistantBlockSchema).max(12),
  source: assistantSourceSchema.optional(),
  practice: practiceAttemptSchema.optional(),
  practiceResult: practiceResultSchema.optional(),
  practiceResults: z.array(z.object({
    blockIndex: z.number().int().min(0).max(11),
    result: practiceResultSchema,
  }).strict()).max(12).optional(),
  practiceChains: z.array(z.object({
    blockIndex: z.number().int().min(0).max(11),
    chain: practiceChainSchema,
  }).strict()).max(12).optional(),
  mode: assistantModeSchema,
  intent: assistantIntentSchema,
  status: z.enum(['pending', 'completed', 'failed', 'cancelled']),
  runId: id.optional(),
  error: z.string().max(1000).optional(),
  createdAt: timestamp,
}).strict().superRefine((message, context) => {
  if (message.practiceChains) {
    if (message.role !== 'assistant' || message.status !== 'completed') {
      context.addIssue({ code: 'custom', message: 'Practice playlists belong to completed assistant replies.' })
    }
    const indices = new Set<number>()
    for (const entry of message.practiceChains) {
      const block = message.blocks[entry.blockIndex]
      if (indices.has(entry.blockIndex) || block?.type !== 'speech'
        || block.locale !== 'zh-Hans' || block.text !== entry.chain.text) {
        context.addIssue({ code: 'custom', message: 'Practice chunks must belong to a unique, unchanged Mandarin phrase.' })
      }
      indices.add(entry.blockIndex)
    }
  }
  if (message.practiceResults) {
    if (message.role !== 'assistant' || message.status !== 'completed') {
      context.addIssue({ code: 'custom', message: 'Inline practice feedback is only allowed in completed assistant replies.' })
    }
    const indices = new Set<number>()
    for (const entry of message.practiceResults) {
      const block = message.blocks[entry.blockIndex]
      if (indices.has(entry.blockIndex)
        || block?.type !== 'speech' || JSON.stringify(block) !== JSON.stringify(entry.result.phrase)) {
        context.addIssue({ code: 'custom', message: 'Inline practice feedback must belong to a unique, unchanged speech block in a completed reply.' })
      }
      indices.add(entry.blockIndex)
    }
  }
  if (message.role === 'practice') {
    if (!message.practiceResult || message.runId || message.practice || message.source
      || message.text || message.blocks.length || message.status !== 'completed' || message.intent !== 'repeat') {
      context.addIssue({ code: 'custom', message: 'Practice results must be completed local-only messages, separate from model replies.' })
    }
  } else if (message.practiceResult) {
    context.addIssue({ code: 'custom', message: 'Only local practice messages may contain practice results.' })
  }
})

export const assistantToolNameSchema = z.enum(['lookup_words', 'lookup_lessons', 'get_learning_context'])
export const assistantToolArgumentsSchema = z.object({ query: z.string().max(200) }).strict()
export const assistantToolStepSchema = z.object({
  callId: id,
  name: assistantToolNameSchema,
  arguments: assistantToolArgumentsSchema,
  result: z.string().max(20000),
}).strict()
export const assistantRunSchema = z.object({
  id,
  threadId: id,
  userMessageId: id,
  assistantMessageId: id,
  connectionRevision: id,
  status: z.enum(['running', 'awaiting-learner', 'failed', 'cancelled', 'interrupted']),
  steps: z.array(assistantToolStepSchema).max(MAX_TOOL_ROUNDS * 4),
  error: z.string().max(1000).optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: timestamp,
}).strict()

export const aiApiTypeSchema = z.enum(['chat-completions', 'responses'])

export const MAX_AI_HEADERS = 20
// Names a browser refuses to let scripts set (Fetch "forbidden request-header names").
const FORBIDDEN_HEADER_NAMES = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method', 'connection',
  'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer', 'set-cookie',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
])
// Headers the app sets itself on every request. They are refused rather than silently overridden.
export const APP_SET_HEADER_NAMES = ['content-type', 'authorization'] as const
export function headerNameProblem(name: string): string | undefined {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return 'Header names may only contain letters, digits and !#$%&\'*+-.^_`|~.'
  const lower = name.toLowerCase()
  if ((APP_SET_HEADER_NAMES as readonly string[]).includes(lower)) return `${name} is set by the app and cannot be customized.`
  if (FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) return `Browsers do not allow scripts to set the ${name} header.`
  return undefined
}
export const aiHeaderSchema = z.object({
  name: z.string().trim().min(1, 'Header name is required.').max(100).superRefine((name, context) => {
    const problem = headerNameProblem(name)
    if (problem) context.addIssue({ code: 'custom', message: problem })
  }),
  value: z.string().trim().min(1, 'Header value is required.').max(4000)
    .refine(value => ![...value].some(char => char === '\0' || char === '\r' || char === '\n'), 'Header values cannot contain line breaks or null characters.')
    .refine(value => [...value].every(char => char.charCodeAt(0) <= 0xff && (char === '\t' || char.charCodeAt(0) >= 0x20) && char.charCodeAt(0) !== 0x7f), 'Header values must use printable Latin-1 characters.'),
}).strict()
export const aiHeadersSchema = z.array(aiHeaderSchema).max(MAX_AI_HEADERS)
  .refine(headers => new Set(headers.map(header => header.name.toLowerCase())).size === headers.length, 'Header names must be unique (case-insensitive).')
export type AIHeader = z.infer<typeof aiHeaderSchema>

export const aiConnectionInputSchema = z.object({
  apiType: aiApiTypeSchema.optional(),
  baseUrl: z.string().trim().url().max(2000).refine(value => {
    const url = new URL(value)
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.includes(url.hostname)))
  }, 'Use HTTPS, or HTTP on localhost, without embedded credentials, query parameters, or fragments.'),
  apiKey: z.string().trim().min(1).max(4000),
  model: z.string().trim().min(1).max(200),
  nativeTools: z.boolean(),
  structuredOutput: z.boolean(),
  headers: aiHeadersSchema.optional(),
  storageAcknowledged: z.literal(true),
}).strict()
// The 'assistant' row is the active endpoint's working copy, which every AI consumer reads.
export const aiConnectionSchema = aiConnectionInputSchema.extend({
  id: z.literal('assistant'),
  endpointId: id.optional(),
  name: z.string().max(80).optional(),
  revision: id,
  updatedAt: timestamp,
}).strict()

export const aiEndpointNameSchema = z.string().trim().min(1, 'Endpoint name is required.').max(80)
export const aiEndpointInputSchema = aiConnectionInputSchema.extend({ name: aiEndpointNameSchema }).strict()
export const aiEndpointSchema = aiEndpointInputSchema.extend({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  order: z.number().int().nonnegative(),
  revision: id,
  updatedAt: timestamp,
}).strict()
// Versioned export shape for the endpoint list.
export const AI_ENDPOINTS_VERSION = 1
export const aiEndpointsExportSchema = z.object({
  version: z.literal(AI_ENDPOINTS_VERSION),
  active: aiEndpointSchema.shape.id.optional(),
  endpoints: z.array(aiEndpointInputSchema.extend({ id: aiEndpointSchema.shape.id }).strict()).min(1).max(20),
}).strict().superRefine((value, context) => {
  const ids = new Set(value.endpoints.map(endpoint => endpoint.id))
  const names = new Set(value.endpoints.map(endpoint => endpoint.name.toLowerCase()))
  if (ids.size !== value.endpoints.length || names.size !== value.endpoints.length) {
    context.addIssue({ code: 'custom', message: 'Endpoint ids and names must be unique.' })
  }
  if (value.active !== undefined && !ids.has(value.active)) context.addIssue({ code: 'custom', message: 'The active endpoint is not in the list.' })
})
export const MAX_AI_ENDPOINTS = 20

export const assistantBackupSchema = z.object({
  threads: z.array(assistantThreadSchema).max(500),
  messages: z.array(assistantMessageSchema).max(10000),
  runs: z.array(assistantRunSchema).max(5000),
  practiceHistory: z.array(practiceHistoryEntrySchema).refine(entries => new Set(entries.map(entry => entry.text)).size === entries.length,
    'History contains duplicate phrases.').optional(),
}).strict()

export type AssistantMode = z.infer<typeof assistantModeSchema>
export type AssistantIntent = z.infer<typeof assistantIntentSchema>
export type SpeechLocale = z.infer<typeof speechLocaleSchema>
export type AssistantSource = z.infer<typeof assistantSourceSchema>
export type SpeechBlock = z.infer<typeof speechBlockSchema>
export type PracticeInput = z.infer<typeof practiceInputSchema>
export type PracticeAttempt = z.infer<typeof practiceAttemptSchema>
export type PracticeResult = z.infer<typeof practiceResultSchema>
export type AssistantBlock = z.infer<typeof assistantBlockSchema>
export type AssistantReply = z.infer<typeof assistantReplySchema>
export type AssistantThread = z.infer<typeof assistantThreadSchema>
export type AssistantMessage = z.infer<typeof assistantMessageSchema>
export type AssistantRun = z.infer<typeof assistantRunSchema>
export type AssistantToolStep = z.infer<typeof assistantToolStepSchema>
export type AssistantToolName = z.infer<typeof assistantToolNameSchema>
export type AIConnectionInput = z.infer<typeof aiConnectionInputSchema>
export type AIAPIType = z.infer<typeof aiApiTypeSchema>
export type AIConnection = z.infer<typeof aiConnectionSchema>
export type AIEndpointInput = z.infer<typeof aiEndpointInputSchema>
export type AIEndpoint = z.infer<typeof aiEndpointSchema>
export type AIEndpointsExport = z.infer<typeof aiEndpointsExportSchema>
export type AssistantBackup = z.infer<typeof assistantBackupSchema>
