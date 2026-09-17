import { z } from 'zod'

export const MAX_DRAFT_LENGTH = 8000
export const MAX_TOOL_ROUNDS = 4
export const RUN_TIMEOUT_MS = 120_000
export const LOOPBACK_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]']

const id = z.string().min(1).max(200)
const timestamp = z.number().int().nonnegative()
export const assistantModeSchema = z.enum(['conversation', 'shadow'])
export const assistantIntentSchema = z.enum(['message', 'shadow', 'repeat', 'explain'])
export const speechLocaleSchema = z.enum(['en-US', 'zh-Hans'])

export const browserVoicePreferenceSchema = z.object({
  voiceURI: z.string().max(2048),
  name: z.string().max(512),
  lang: z.string().min(1).max(100),
  localService: z.boolean(),
}).strict()
export const speechVoicePreferencesSchema = z.object({
  'zh-Hans': browserVoicePreferenceSchema.optional(),
  'en-US': browserVoicePreferenceSchema.optional(),
}).strict()
export type BrowserVoicePreference = z.infer<typeof browserVoicePreferenceSchema>
export type SpeechVoicePreferences = z.infer<typeof speechVoicePreferencesSchema>

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
export const assistantBlockSchema = z.discriminatedUnion('type', [textBlockSchema, speechBlockSchema])
export const assistantReplySchema = z.object({
  blocks: z.array(assistantBlockSchema).min(1).max(12),
}).strict()

export const assistantThreadSchema = z.object({
  id,
  title: z.string().min(1).max(120),
  draft: z.string().max(MAX_DRAFT_LENGTH),
  source: assistantSourceSchema.optional(),
  mode: assistantModeSchema,
  shadowIntent: z.enum(['new-phrase', 'repeat']),
  shadowPhrase: speechBlockSchema.optional(),
  romanization: z.boolean(),
  speechRate: z.union([z.literal(0.5), z.literal(0.75), z.literal(1), z.literal(1.25)]),
  returnRoute: z.string().min(1).max(300).regex(/^[\w:/.-]+$/),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict()

export const assistantMessageSchema = z.object({
  id,
  threadId: id,
  sequence: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant', 'event']),
  text: z.string().max(MAX_DRAFT_LENGTH),
  blocks: z.array(assistantBlockSchema).max(12),
  source: assistantSourceSchema.optional(),
  mode: assistantModeSchema,
  intent: assistantIntentSchema,
  status: z.enum(['pending', 'completed', 'failed', 'cancelled']),
  runId: id.optional(),
  error: z.string().max(1000).optional(),
  createdAt: timestamp,
}).strict()

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
  storageAcknowledged: z.literal(true),
}).strict()
export const aiConnectionSchema = aiConnectionInputSchema.extend({
  id: z.literal('assistant'),
  revision: id,
  updatedAt: timestamp,
}).strict()

export const assistantBackupSchema = z.object({
  threads: z.array(assistantThreadSchema).max(500),
  messages: z.array(assistantMessageSchema).max(10000),
  runs: z.array(assistantRunSchema).max(5000),
}).strict()

export type AssistantMode = z.infer<typeof assistantModeSchema>
export type AssistantIntent = z.infer<typeof assistantIntentSchema>
export type SpeechLocale = z.infer<typeof speechLocaleSchema>
export type AssistantSource = z.infer<typeof assistantSourceSchema>
export type SpeechBlock = z.infer<typeof speechBlockSchema>
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
export type AssistantBackup = z.infer<typeof assistantBackupSchema>
