import { z } from 'zod'
import { db } from '../database'
import { discardUnsavedDraft } from './drafts'
import {
  aiConnectionInputSchema, aiConnectionSchema, assistantMessageSchema, assistantRunSchema,
  assistantSourceSchema, assistantThreadSchema, MAX_DRAFT_LENGTH,
  type AIConnectionInput, type AssistantSource, type AssistantThread,
} from './contracts'

const threadIdSchema = assistantThreadSchema.shape.id
const threadChangesSchema = assistantThreadSchema.pick({
  mode: true, shadowIntent: true, shadowPhrase: true, romanization: true, speechRate: true, returnRoute: true,
}).partial().strict()
type ThreadChanges = Partial<Pick<AssistantThread, 'mode' | 'shadowIntent' | 'shadowPhrase' | 'romanization' | 'speechRate' | 'returnRoute'>>

async function requireThread(threadId: string): Promise<AssistantThread> {
  const thread = await db.assistantThreads.get(threadIdSchema.parse(threadId))
  if (!thread) throw new Error('This conversation no longer exists. Start a new conversation.')
  assistantThreadSchema.parse(thread)
  return thread
}

function exactSource(source: AssistantSource): AssistantSource {
  return assistantSourceSchema.parse(source)
}

export async function createConversation(source?: AssistantSource, returnRoute?: string): Promise<string> {
  assistantThreadSchema.shape.returnRoute.optional().parse(returnRoute)
  const context = source === undefined ? undefined : exactSource(source)
  const prompt = 'Please explain this passage:\n\n'
  const now = Date.now()
  const thread: AssistantThread = {
    id: crypto.randomUUID(),
    title: 'New conversation',
    draft: context ? (prompt.length + context.text.length <= MAX_DRAFT_LENGTH ? `${prompt}${context.text}` : context.text) : '',
    ...(context ? { source: context } : {}),
    mode: 'conversation',
    shadowIntent: 'new-phrase',
    romanization: true,
    speechRate: 1,
    returnRoute: returnRoute ?? context?.route ?? 'overview',
    createdAt: now,
    updatedAt: now,
  }
  assistantThreadSchema.parse(thread)
  await db.assistantThreads.add(thread)
  return thread.id
}

export async function saveDraft(threadId: string, draft: string, source?: AssistantSource | null): Promise<void> {
  assistantThreadSchema.shape.draft.parse(draft)
  const context = source == null ? source : exactSource(source)
  await db.transaction('rw', db.assistantThreads, async () => {
    const thread = await requireThread(threadId)
    const next = { ...thread, draft, updatedAt: Date.now() }
    if (context === null) delete next.source
    else if (context !== undefined) next.source = context
    assistantThreadSchema.parse(next)
    await db.assistantThreads.put(next)
  })
}

export async function updateThread(threadId: string, changes: ThreadChanges): Promise<void> {
  const validated = threadChangesSchema.parse(changes)
  await db.transaction('rw', db.assistantThreads, db.assistantMessages, async () => {
    const thread = await requireThread(threadId)
    const now = Date.now()
    const next = { ...thread, ...validated, updatedAt: now }
    assistantThreadSchema.parse(next)
    if (next.mode !== thread.mode) {
      const last = await db.assistantMessages.where('[threadId+sequence]')
        .between([threadId, 0], [threadId, Infinity]).last()
      const marker = assistantMessageSchema.parse({
        id: crypto.randomUUID(), threadId, sequence: (last?.sequence ?? -1) + 1,
        role: 'event', text: `Switched to ${next.mode === 'shadow' ? 'Shadow' : 'Conversation'} mode.`,
        blocks: [], mode: next.mode, intent: 'message', status: 'completed', createdAt: now,
      })
      await db.assistantMessages.add(marker)
    }
    await db.assistantThreads.put(next)
  })
}

export async function deleteThread(threadId: string): Promise<void> {
  await db.transaction('rw', db.assistantThreads, db.assistantMessages, db.assistantRuns, async () => {
    await requireThread(threadId)
    await db.assistantMessages.where('threadId').equals(threadId).delete()
    await db.assistantRuns.where('threadId').equals(threadId).delete()
    await db.assistantThreads.delete(threadId)
  })
  discardUnsavedDraft(threadId)
}

export async function saveAIConnection(input: AIConnectionInput): Promise<void> {
  const validated = aiConnectionInputSchema.parse(input)
  const connection = aiConnectionSchema.parse({
    ...validated, baseUrl: validated.baseUrl.replace(/\/+$/, ''),
    id: 'assistant', revision: crypto.randomUUID(), updatedAt: Date.now(),
  })
  await db.aiConnections.put(connection)
}

export async function removeAIConnection(): Promise<void> {
  await db.aiConnections.delete('assistant')
}

export async function expireAssistantRuns(now = Date.now()): Promise<void> {
  z.number().int().nonnegative().parse(now)
  await db.transaction('rw', db.assistantRuns, db.assistantMessages, async () => {
    const expired = await db.assistantRuns.where('status').equals('running').filter(run => run.expiresAt <= now).toArray()
    for (const run of expired) {
      assistantRunSchema.parse(run)
      const message = await db.assistantMessages.get(run.assistantMessageId)
      if (!message || message.threadId !== run.threadId || message.runId !== run.id
        || message.role !== 'assistant' || message.status !== 'pending') {
        throw new Error('An interrupted response has inconsistent saved records. Restore a valid backup or delete its conversation.')
      }
      const error = 'This response expired or was interrupted. Review your message and send again when ready.'
      const failedMessage = { ...message, status: 'failed' as const, error }
      assistantMessageSchema.parse(failedMessage)
      await db.assistantRuns.put(assistantRunSchema.parse({ ...run, status: 'interrupted', error, updatedAt: now }))
      await db.assistantMessages.put(failedMessage)
    }
  })
}
