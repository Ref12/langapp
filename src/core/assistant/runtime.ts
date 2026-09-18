import {
  abortable, AITransportError, AssistantCancelledError, createAssistantModelClient, validateAssistantReply,
  type ToolResult,
} from '../ai/provider'
import { db } from '../database'
import {
  aiConnectionSchema, assistantIntentSchema, assistantMessageSchema, assistantRunSchema,
  assistantSourceSchema, assistantThreadSchema, MAX_DRAFT_LENGTH, MAX_TOOL_ROUNDS, RUN_TIMEOUT_MS,
  type AIConnection, type AssistantIntent, type AssistantMessage, type AssistantReply,
  type AssistantRun, type AssistantSource, type AssistantThread, type AssistantToolStep, type PracticeAttempt,
} from './contracts'
import { expireAssistantRuns } from './store'
import { buildTutorMessages, executeAssistantTool, getLearningContext } from './tools'

export interface AssistantTurnRequest {
  text?: string
  intent?: AssistantIntent
  source?: AssistantSource
  preserveDraft?: boolean
  practice?: PracticeAttempt
}

class AssistantRunError extends Error {
  constructor(message: string) { super(message); this.name = 'AssistantRunError' }
}

interface ReservedTurn {
  thread: AssistantThread
  user: AssistantMessage
  pending: AssistantMessage
  run: AssistantRun
  connection: AIConnection
}

const controllers = new Map<string, { threadId: string; controller: AbortController }>()
const runTables = () => [db.assistantThreads, db.assistantMessages, db.assistantRuns, db.aiConnections]

function requireActiveSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new AssistantCancelledError()
}

async function reserveTurn(threadId: string, request: AssistantTurnRequest | undefined, signal: AbortSignal): Promise<ReservedTurn> {
  requireActiveSignal(signal)
  if (request?.intent === 'repeat' || request?.practice !== undefined) {
    throw new AssistantRunError('Recorded practice stays outside the language model. Use Listen and record for automatic speech feedback or transcript comparison.')
  }
  await expireAssistantRuns()
  requireActiveSignal(signal)
  return db.transaction('rw', runTables(), async transaction => {
    const abortReservation = () => transaction.abort()
    const releaseSignal = () => signal.removeEventListener('abort', abortReservation)
    signal.addEventListener('abort', abortReservation, { once: true })
    transaction.on('complete', releaseSignal)
    transaction.on('abort', releaseSignal)
    transaction.on('error', releaseSignal)
    requireActiveSignal(signal)
    const savedThread = await db.assistantThreads.get(threadId)
    if (!savedThread) throw new AssistantRunError('This conversation no longer exists. Start a new conversation.')
    const parsedThread = assistantThreadSchema.safeParse(savedThread)
    if (!parsedThread.success) throw new AssistantRunError('This conversation has invalid saved settings. Start a new conversation.')
    const thread = parsedThread.data
    const savedConnection = await db.aiConnections.get('assistant')
    if (!savedConnection) throw new AssistantRunError('Set up an AI connection in Settings before sending. Your draft is still saved.')
    const parsedConnection = aiConnectionSchema.safeParse(savedConnection)
    if (!parsedConnection.success) throw new AssistantRunError('The saved AI connection is invalid. Review and save it in Settings.')
    if (await db.assistantRuns.where('[threadId+status]').equals([threadId, 'running']).count()) {
      throw new AssistantRunError('A reply is already running in this conversation. Stop it or wait before sending again.')
    }
    const intent = request?.intent ?? (thread.mode === 'shadow' ? 'shadow' : 'message')
    if (!assistantIntentSchema.safeParse(intent).success) throw new AssistantRunError('That Assistant intent is not supported.')
    const text = request?.text ?? thread.draft
    if (typeof text !== 'string' || !text.trim()) throw new AssistantRunError('Enter a message before sending.')
    if (text.length > MAX_DRAFT_LENGTH) throw new AssistantRunError('This message is too long. Shorten it before sending.')
    const source = request && Object.prototype.hasOwnProperty.call(request, 'source') ? request.source : thread.source
    if (source !== undefined && !assistantSourceSchema.safeParse(source).success) throw new AssistantRunError('This source is invalid or too long. Choose a shorter excerpt.')
    const last = await db.assistantMessages.where('[threadId+sequence]')
      .between([threadId, 0], [threadId, Number.MAX_SAFE_INTEGER]).last()
    const now = Date.now()
    const runId = crypto.randomUUID()
    const user = assistantMessageSchema.parse({
      id: crypto.randomUUID(), threadId, sequence: (last?.sequence ?? -1) + 1,
      role: 'user', text, blocks: [], ...(source ? { source } : {}),
      mode: thread.mode, intent, status: 'completed', runId, createdAt: now,
    })
    const pending = assistantMessageSchema.parse({
      id: crypto.randomUUID(), threadId, sequence: user.sequence + 1,
      role: 'assistant', text: '', blocks: [], mode: thread.mode, intent,
      status: 'pending', runId, createdAt: now,
    })
    const run = assistantRunSchema.parse({
      id: runId, threadId, userMessageId: user.id, assistantMessageId: pending.id,
      connectionRevision: parsedConnection.data.revision, status: 'running', steps: [],
      createdAt: now, updatedAt: now, expiresAt: now + RUN_TIMEOUT_MS,
    })
    const firstSend = !await db.assistantMessages.where('threadId').equals(threadId).filter(message => message.role === 'user').count()
    const clearCapturedDraft = !request?.preserveDraft && thread.draft === text
    const nextThread: AssistantThread = {
      ...thread, updatedAt: now,
      ...(firstSend ? { title: text.trim().replace(/\s+/g, ' ').slice(0, 120) } : {}),
      ...(clearCapturedDraft ? { draft: '' } : {}),
    }
    if (clearCapturedDraft) delete nextThread.source
    requireActiveSignal(signal)
    await db.assistantThreads.put(assistantThreadSchema.parse(nextThread))
    await db.assistantMessages.bulkAdd([user, pending])
    await db.assistantRuns.add(run)
    requireActiveSignal(signal)
    return { thread, user, pending, run, connection: parsedConnection.data }
  })
}

function sameRun(actual: AssistantRun, expected: AssistantRun): boolean {
  return actual.id === expected.id && actual.threadId === expected.threadId
    && actual.userMessageId === expected.userMessageId && actual.assistantMessageId === expected.assistantMessageId
    && actual.connectionRevision === expected.connectionRevision && actual.createdAt === expected.createdAt
    && actual.expiresAt === expected.expiresAt
}

function ownsMessages(turn: ReservedTurn, user: AssistantMessage | undefined, pending: AssistantMessage | undefined): boolean {
  return !!user && !!pending && user.id === turn.user.id && pending.id === turn.pending.id
    && user.threadId === turn.thread.id && pending.threadId === turn.thread.id
    && user.runId === turn.run.id && pending.runId === turn.run.id
    && user.role === 'user' && user.status === 'completed' && pending.role === 'assistant' && pending.status === 'pending'
    && user.sequence === turn.user.sequence && pending.sequence === turn.pending.sequence
}

async function requireOwnedTurn(turn: ReservedTurn) {
  const [run, thread, connection, user, pending] = await Promise.all([
    db.assistantRuns.get(turn.run.id), db.assistantThreads.get(turn.thread.id),
    db.aiConnections.get('assistant'), db.assistantMessages.get(turn.user.id), db.assistantMessages.get(turn.pending.id),
  ])
  if (!run || !thread || !sameRun(run, turn.run)) throw new AssistantRunError('This conversation or response was deleted or restored. No late reply was saved.')
  if (run.status === 'cancelled') throw new AssistantCancelledError()
  if (run.status !== 'running') throw new AssistantRunError('This response is no longer running. Review the saved conversation before sending again.')
  if (run.expiresAt <= Date.now()) throw new AssistantRunError('This response timed out. Your message is saved; try again when ready.')
  if (!connection || connection.revision !== turn.run.connectionRevision) throw new AssistantRunError('The AI connection changed while this reply was running. Your message is saved; send again using the new settings.')
  if (!ownsMessages(turn, user, pending)) throw new AssistantRunError('This response has changed or was restored. No late reply was saved.')
  return { run, thread, pending: pending! }
}

async function checkTurn(turn: ReservedTurn, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new AssistantCancelledError()
  await db.transaction('r', runTables(), () => requireOwnedTurn(turn))
  if (signal.aborted) throw new AssistantCancelledError()
}

async function appendStep(turn: ReservedTurn, step: AssistantToolStep): Promise<void> {
  await db.transaction('rw', runTables(), async () => {
    const current = await requireOwnedTurn(turn)
    if (current.run.steps.some(existing => existing.callId === step.callId)) throw new AssistantRunError('The AI reused a tool-call ID. No duplicate tool was run; try again.')
    const next = assistantRunSchema.safeParse({ ...current.run, steps: [...current.run.steps, step], updatedAt: Date.now() })
    if (!next.success) throw new AssistantRunError('The tool result exceeded the supported limits. Use a narrower request.')
    await db.assistantRuns.put(next.data)
  })
}

async function publishReply(turn: ReservedTurn, value: AssistantReply, signal: AbortSignal): Promise<AssistantMessage> {
  requireActiveSignal(signal)
  const reply = validateAssistantReply(value)
  return db.transaction('rw', runTables(), async transaction => {
    const abortPublication = () => transaction.abort()
    const releaseSignal = () => signal.removeEventListener('abort', abortPublication)
    signal.addEventListener('abort', abortPublication, { once: true })
    transaction.on('complete', releaseSignal)
    transaction.on('abort', releaseSignal)
    transaction.on('error', releaseSignal)
    requireActiveSignal(signal)
    const current = await requireOwnedTurn(turn)
    const now = Date.now()
    const completed = assistantMessageSchema.parse({ ...current.pending, blocks: reply.blocks, status: 'completed' })
    await db.assistantMessages.put(completed)
    await db.assistantRuns.put(assistantRunSchema.parse({ ...current.run, status: 'awaiting-learner', updatedAt: now }))
    const phrase = [...reply.blocks].reverse().find(block => block.type === 'speech' && block.locale === 'zh-Hans')
    const rememberPhrase = turn.thread.mode === 'shadow' && current.thread.mode === 'shadow'
      && turn.user.intent === 'shadow' && current.thread.shadowIntent !== 'repeat'
      && JSON.stringify(current.thread.shadowPhrase) === JSON.stringify(turn.thread.shadowPhrase)
    const nextThread: AssistantThread = {
      ...current.thread, updatedAt: now,
      ...(rememberPhrase && phrase?.type === 'speech' ? { shadowPhrase: phrase } : {}),
    }
    await db.assistantThreads.put(assistantThreadSchema.parse(nextThread))
    requireActiveSignal(signal)
    return completed
  })
}

async function recordFailure(turn: ReservedTurn, status: 'failed' | 'cancelled', error: string): Promise<void> {
  await db.transaction('rw', runTables(), async () => {
    const [run, thread, user, pending] = await Promise.all([
      db.assistantRuns.get(turn.run.id), db.assistantThreads.get(turn.thread.id),
      db.assistantMessages.get(turn.user.id), db.assistantMessages.get(turn.pending.id),
    ])
    // Deletion, restore, another tab's Stop, or a completed response wins over this request.
    if (!run || !thread || !sameRun(run, turn.run) || run.status !== 'running') return
    await db.assistantRuns.put(assistantRunSchema.parse({ ...run, status, error, updatedAt: Date.now() }))
    if (ownsMessages(turn, user, pending)) {
      await db.assistantMessages.put(assistantMessageSchema.parse({ ...pending!, status, error }))
    }
  })
}

export async function sendAssistantTurn(threadId: string, request?: AssistantTurnRequest): Promise<AssistantMessage> {
  const controller = new AbortController()
  const invocationId = crypto.randomUUID()
  controllers.set(invocationId, { threadId, controller })
  let reserved: ReservedTurn | undefined
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const turn = await reserveTurn(threadId, request, controller.signal)
    reserved = turn
    timer = setTimeout(() => { timedOut = true; controller.abort() }, Math.max(0, turn.run.expiresAt - Date.now()))
    await checkTurn(turn, controller.signal)
    const history = await db.assistantMessages.where('[threadId+sequence]')
      .between([threadId, 0], [threadId, turn.user.sequence]).reverse()
      .filter(message => message.status === 'completed' && message.intent !== 'repeat' && !message.practice && !message.practiceResult
        && (message.role === 'user' || message.role === 'assistant'))
      .limit(24).toArray()
    const context = await abortable(getLearningContext((turn.user.source?.text ?? turn.user.text).slice(0, 200)), controller.signal)
    const messages = buildTutorMessages(turn.thread, turn.user, history, context)
    const client = createAssistantModelClient(turn.connection, messages)
    const callIds = new Set<string>()
    let results: ToolResult[] = []
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      await checkTurn(turn, controller.signal)
      const completion = await client.complete(results, { signal: controller.signal })
      if (completion.kind === 'reply') {
        if (controller.signal.aborted) throw new AssistantCancelledError()
        const completed = await publishReply(turn, completion.reply, controller.signal)
        requireActiveSignal(controller.signal)
        return completed
      }
      if (round === MAX_TOOL_ROUNDS - 1) throw new AssistantRunError('The AI reached the four-round lookup limit without a final reply. Ask a narrower question or try another model.')
      if (completion.calls.some(call => callIds.has(call.id))) throw new AssistantRunError('The AI reused a tool-call ID. No duplicate tool was run; try again.')
      results = []
      for (const call of completion.calls) {
        await checkTurn(turn, controller.signal)
        callIds.add(call.id)
        const result = await abortable(executeAssistantTool(call.name, call.arguments), controller.signal)
        await appendStep(turn, { callId: call.id, name: call.name, arguments: call.arguments, result })
        results.push({ callId: call.id, output: result })
      }
    }
    throw new AssistantRunError('The AI reached the four-round lookup limit without a final reply. Ask a narrower question or try another model.')
  } catch (error) {
    const failure = timedOut
      ? new AssistantRunError('This response timed out after two minutes. Your message is saved; try again when ready.')
      : controller.signal.aborted ? new AssistantCancelledError()
        : error instanceof AssistantCancelledError || error instanceof AITransportError || error instanceof AssistantRunError
          ? error : new AssistantRunError(reserved
            ? 'The Assistant could not finish this reply. Check browser storage and your AI connection, then try again. Your message is saved.'
            : 'The Assistant could not start. Check browser storage and your AI connection, then try again. Your draft was not cleared.')
    try {
      if (reserved) await recordFailure(reserved, failure instanceof AssistantCancelledError ? 'cancelled' : 'failed', failure.message)
    } catch {
      throw new AssistantRunError('The Assistant stopped, but browser storage could not record the result. Reload and review the conversation before retrying.')
    }
    throw failure
  } finally {
    clearTimeout(timer)
    controllers.delete(invocationId)
  }
}

export async function cancelAssistantRun(threadId: string): Promise<void> {
  for (const entry of controllers.values()) {
    if (entry.threadId === threadId) entry.controller.abort()
  }
  await db.transaction('rw', db.assistantRuns, db.assistantMessages, async () => {
    const running = await db.assistantRuns.where('[threadId+status]').equals([threadId, 'running']).toArray()
    for (const run of running) {
      const error = 'Assistant request cancelled. Your message is saved.'
      const pending = await db.assistantMessages.get(run.assistantMessageId)
      await db.assistantRuns.put(assistantRunSchema.parse({ ...run, status: 'cancelled', error, updatedAt: Date.now() }))
      if (pending?.threadId === threadId && pending.runId === run.id && pending.role === 'assistant' && pending.status === 'pending') {
        await db.assistantMessages.put(assistantMessageSchema.parse({ ...pending, status: 'cancelled', error }))
      }
    }
  })
}
