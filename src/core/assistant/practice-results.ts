import { db } from '../database'
import { assistantMessageSchema, practiceResultSchema, type PracticeResult } from './contracts'

export async function saveInlinePracticeResult(
  threadId: string, messageId: string, blockIndex: number, value: PracticeResult,
): Promise<void> {
  const result = practiceResultSchema.parse(value)
  await db.transaction('rw', db.assistantThreads, db.assistantMessages, async () => {
    const thread = await db.assistantThreads.get(threadId)
    const message = await db.assistantMessages.get(messageId)
    if (!thread || !message || message.threadId !== threadId) throw new Error('This reply is no longer available.')
    const practiceResults = (message.practiceResults ?? []).filter(entry => entry.blockIndex !== blockIndex)
    practiceResults.push({ blockIndex, result })
    await db.assistantMessages.put(assistantMessageSchema.parse({ ...message, practiceResults }))
  })
}

export async function savePracticeResult(threadId: string, id: string, value: PracticeResult): Promise<void> {
  const result = practiceResultSchema.parse(value)
  await db.transaction('rw', db.assistantThreads, db.assistantMessages, async () => {
    const existing = await db.assistantMessages.get(id)
    if (existing) {
      if (existing.threadId === threadId && existing.role === 'practice'
        && JSON.stringify(existing.practiceResult) === JSON.stringify(result)) return
      throw new Error('This practice attempt already has a different saved result.')
    }
    const thread = await db.assistantThreads.get(threadId)
    if (!thread) throw new Error('This conversation no longer exists. The practice result was not saved.')
    const selected = thread.practicePhrase ?? (thread.shadowIntent === 'repeat' ? thread.shadowPhrase : undefined)
    if (JSON.stringify(selected) !== JSON.stringify(result.phrase)) throw new Error('The practice translation changed. This result was not saved to a different phrase.')
    const last = await db.assistantMessages.where('[threadId+sequence]')
      .between([threadId, 0], [threadId, Number.MAX_SAFE_INTEGER]).last()
    const now = Date.now()
    await db.assistantMessages.add(assistantMessageSchema.parse({
      id, threadId, sequence: (last?.sequence ?? -1) + 1, role: 'practice', text: '', blocks: [],
      mode: thread.mode, intent: 'repeat', status: 'completed', practiceResult: result, createdAt: now,
    }))
    await db.assistantThreads.update(threadId, { updatedAt: now })
  })
}
