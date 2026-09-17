import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../database'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { assistantMessageSchema, type PracticeResult } from './contracts'
import { messageText } from './message-text'
import { createConversation, deleteThread, saveDraft, selectPracticePhrase, updateThread } from './store'
import { saveInlinePracticeResult, savePracticeResult } from './practice-results'

const phrase = { type: 'speech', text: '\u4f60\u597d', locale: 'zh-Hans', meaning: 'Hello' } as const
const result: PracticeResult = { kind: 'transcript-diff', reason: 'not-configured', phrase, transcript: '\u4f60\u597d' }
let threadId: string
beforeEach(async () => {
  await db.delete(); await db.open(); await initializeWorkspace()
  threadId = await createConversation()
  await saveDraft(threadId, 'My draft')
  await selectPracticePhrase(threadId, phrase)
})

describe('local-only practice results', () => {
  it('updates just the selected reply block without appending history or touching the thread', async () => {
    await db.assistantMessages.add({
      id: 'reply', threadId, sequence: 0, role: 'assistant', blocks: [phrase, phrase], text: '',
      mode: 'conversation', intent: 'message', status: 'completed', createdAt: 1,
    })
    const thread = await db.assistantThreads.get(threadId)
    await saveInlinePracticeResult(threadId, 'reply', 1, result)
    await saveInlinePracticeResult(threadId, 'reply', 1, { ...result, transcript: 'another attempt' })
    const message = (await db.assistantMessages.get('reply'))!
    expect(message.blocks).toEqual([phrase, phrase])
    expect(message.practiceResults).toEqual([{ blockIndex: 1, result: { ...result, transcript: 'another attempt' } }])
    expect(messageText(message)).toContain('Recognized: another attempt')
    expect(await db.assistantMessages.count()).toBe(1)
    expect(await db.assistantThreads.get(threadId)).toEqual(thread)
    expect(await db.assistantRuns.count()).toBe(0)
    await expect(saveInlinePracticeResult(threadId, 'reply', 5, result)).rejects.toThrow()
    await expect(saveInlinePracticeResult(threadId, 'reply', 0, { ...result, phrase: { ...phrase, text: 'changed' } })).rejects.toThrow()
    expect(await db.assistantMessages.get('reply')).toEqual(message)
  })

  it('preserves feedback on other blocks and messages when attempts finish concurrently', async () => {
    const message = { threadId, sequence: 0, role: 'assistant', blocks: [phrase, phrase], text: '',
      mode: 'conversation', intent: 'message', status: 'completed', createdAt: 1 } as const
    await db.assistantMessages.bulkAdd([
      assistantMessageSchema.parse({ ...message, id: 'first' }),
      assistantMessageSchema.parse({ ...message, id: 'second', sequence: 1 }),
    ])
    await Promise.all([
      saveInlinePracticeResult(threadId, 'first', 0, result),
      saveInlinePracticeResult(threadId, 'first', 1, { ...result, transcript: 'second block' }),
      saveInlinePracticeResult(threadId, 'second', 0, { ...result, transcript: 'second message' }),
    ])
    expect((await db.assistantMessages.get('first'))?.practiceResults).toEqual([
      { blockIndex: 0, result }, { blockIndex: 1, result: { ...result, transcript: 'second block' } },
    ])
    expect((await db.assistantMessages.get('second'))?.practiceResults).toEqual([
      { blockIndex: 0, result: { ...result, transcript: 'second message' } },
    ])
  })

  it('rejects missing replies, wrong conversations, and stale block references', async () => {
    await db.assistantMessages.add({
      id: 'reply', threadId, sequence: 0, role: 'assistant', blocks: [phrase], text: '',
      mode: 'conversation', intent: 'message', status: 'completed', createdAt: 1,
    })
    const other = await createConversation()
    await expect(saveInlinePracticeResult(other, 'reply', 0, result)).rejects.toThrow('no longer available')
    await db.assistantMessages.update('reply', { blocks: [{ ...phrase, meaning: 'changed reference' }] })
    await expect(saveInlinePracticeResult(threadId, 'reply', 0, result)).rejects.toThrow('unchanged speech block')
    await db.assistantMessages.delete('reply')
    await expect(saveInlinePracticeResult(threadId, 'reply', 0, result)).rejects.toThrow('no longer available')
    expect(await db.assistantMessages.count()).toBe(0)
  })

  it('round-trips inline metadata and rejects malformed ownership before replacing a workspace', async () => {
    const message = { id: 'reply', threadId, sequence: 0, role: 'assistant', blocks: [phrase], text: '',
      mode: 'conversation', intent: 'message', status: 'completed', createdAt: 1 } as const
    await db.assistantMessages.add(assistantMessageSchema.parse(message))
    await saveInlinePracticeResult(threadId, 'reply', 0, result)
    const saved = (await db.assistantMessages.get('reply'))!
    const backup = await exportWorkspaceBackup()
    await restoreBackup(backup)
    expect(await db.assistantMessages.get('reply')).toEqual(saved)
    for (const patch of [
      { role: 'user' }, { role: 'event' }, { status: 'pending' },
      { practiceResults: [{ blockIndex: 1, result }] },
      { practiceResults: [{ blockIndex: 0, result }, { blockIndex: 0, result }] },
      { practiceResults: [{ blockIndex: 0, result: { ...result, phrase: { ...phrase, text: 'different' } } }] },
      { blocks: [{ type: 'text', markdown: phrase.text }] },
      { role: 'user', practiceResults: [] },
    ]) {
      expect(assistantMessageSchema.safeParse({ ...saved, ...patch }).success).toBe(false)
      const invalid: { assistant: { messages: unknown[] } } = JSON.parse(backup)
      invalid.assistant.messages = [{ ...saved, ...patch }]
      await expect(restoreBackup(JSON.stringify(invalid))).rejects.toThrow()
      expect(await db.assistantMessages.get('reply')).toEqual(saved)
    }
  })

  it('atomically saves an idempotent bubble without AI runs, draft changes, mode switches, or learning evidence', async () => {
    const before = await loadWorkspace()
    await Promise.all([savePracticeResult(threadId, 'attempt', result), savePracticeResult(threadId, 'attempt', result)])
    expect(await db.assistantMessages.count()).toBe(1)
    expect(await db.assistantMessages.get('attempt')).toMatchObject({ role: 'practice', sequence: 0, status: 'completed', practiceResult: result })
    expect(await db.assistantThreads.get(threadId)).toMatchObject({ mode: 'conversation', draft: 'My draft', practicePhrase: phrase, title: 'New conversation' })
    expect(await db.assistantRuns.count()).toBe(0)
    expect(await loadWorkspace()).toEqual(before)
    await expect(savePracticeResult(threadId, 'attempt', { ...result, transcript: 'different' })).rejects.toThrow('different saved result')
  })
  it('assigns distinct sequences to concurrent completed attempts', async () => {
    await Promise.all([savePracticeResult(threadId, 'one', result), savePracticeResult(threadId, 'two', result)])
    expect((await db.assistantMessages.orderBy('[threadId+sequence]').toArray()).map(message => message.sequence)).toEqual([0, 1])
  })
  it('rejects late completion for deleted conversations or another selected translation', async () => {
    await selectPracticePhrase(threadId, { ...phrase, text: '\u8336' })
    await expect(savePracticeResult(threadId, 'late', result)).rejects.toThrow('translation changed')
    await deleteThread(threadId)
    await expect(savePracticeResult(threadId, 'late', result)).rejects.toThrow('no longer exists')
    expect(await db.assistantMessages.count()).toBe(0)
  })
  it('round-trips results and feedback preferences through backups while preserving drafts', async () => {
    await db.speechConnections.put({
      id: 'assistant-speech', provider: 'azure', region: 'eastus', apiKey: 'fake-private-speech-key',
      storageAcknowledged: true, revision: 'speech-settings', updatedAt: 1,
    })
    await updateThread(threadId, { speechFeedback: false })
    await savePracticeResult(threadId, 'attempt', result)
    const backup = await exportWorkspaceBackup()
    expect(backup).not.toMatch(/fake-private-speech-key|speechConnections|speech-settings/)
    await db.speechConnections.update('assistant-speech', { apiKey: 'fake-newer-key', revision: 'newer-settings' })
    await deleteThread(threadId)
    await restoreBackup(backup)
    expect(await db.assistantMessages.get('attempt')).toMatchObject({ practiceResult: result })
    expect(await db.assistantThreads.get(threadId)).toMatchObject({ speechFeedback: false, draft: 'My draft' })
    expect(await db.speechConnections.get('assistant-speech')).toMatchObject({ apiKey: 'fake-newer-key', revision: 'newer-settings' })
    await deleteThread(threadId)
    expect(await db.assistantMessages.count()).toBe(0)
  })
  it('copies expected and recognized text, provenance, and actual scores including zero', async () => {
    await savePracticeResult(threadId, 'attempt', { kind: 'azure', phrase, transcript: 'recognized',
      assessment: { status: 'incomplete', accuracy: 0, words: [{ text: '\u4f60', accuracy: 12, errorType: 'Mispronunciation' }] } })
    const text = messageText((await db.assistantMessages.get('attempt'))!)
    expect(text).toContain(`Expected: ${phrase.text}`)
    expect(text).toContain('Recognized: recognized')
    expect(text).toContain('Accuracy: 0 / 100')
    expect(text).not.toContain('Fluency:')
    expect(text).toContain('Mispronunciation')
    expect(text).toContain('Not sent to the language model')
  })
  it('rejects malformed results or attaching local-only feedback to model runs/messages', async () => {
    await savePracticeResult(threadId, 'attempt', result)
    const message = (await db.assistantMessages.get('attempt'))!
    for (const patch of [{ role: 'user' }, { runId: 'run' }, { status: 'pending' }, { practiceResult: undefined }, { text: 'model text' }]) {
      expect(assistantMessageSchema.safeParse({ ...message, ...patch }).success).toBe(false)
    }
    await expect(savePracticeResult(threadId, 'invalid', { kind: 'azure', phrase, transcript: 'text',
      assessment: { status: 'assessed', accuracy: 101, words: [] } })).rejects.toThrow()
    expect(await db.assistantMessages.count()).toBe(1)
  })
})
