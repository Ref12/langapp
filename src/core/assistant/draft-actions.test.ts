import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { MAX_DRAFT_LENGTH, type AssistantSource } from './contracts'
import { clearUnsavedDrafts, rememberDraft } from './drafts'
import { prepareAssistantDraft, registerDraftEditor } from './draft-actions'
import { createConversation, saveDraft, updateThread } from './store'

const source: AssistantSource = { text: '  quoted text\n', title: 'Selection', route: 'dictionary' }

beforeEach(async () => {
  clearUnsavedDrafts()
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { clearUnsavedDrafts(); vi.restoreAllMocks() })

describe('contextual Assistant drafts', () => {
  it('creates a separate chat outside a conversation, even when other drafts exist', async () => {
    const existing = await createConversation()
    await saveDraft(existing, 'Keep this draft')
    const id = await prepareAssistantDraft(source)
    expect(id).not.toBe(existing)
    expect((await db.assistantThreads.get(existing))?.draft).toBe('Keep this draft')
    expect(await db.assistantThreads.get(id)).toMatchObject({ source, draft: `Please explain this passage:\n\n${source.text}` })
    expect(await db.assistantMessages.count()).toBe(0)
    expect(await db.assistantRuns.count()).toBe(0)
  })

  it('appends to the specified chat, keeping its earlier context and mode', async () => {
    const previous = { ...source, title: 'Original source', text: 'original context' }
    const id = await createConversation(previous)
    await saveDraft(id, '  Keep my question.  ')
    await updateThread(id, { mode: 'shadow' })
    const other = await createConversation()
    expect(await prepareAssistantDraft(source, id)).toBe(id)
    expect(await db.assistantThreads.get(id)).toMatchObject({
      draft: `  Keep my question.  \n\nPlease explain this passage:\n\n${source.text}`,
      source: previous, mode: 'shadow',
    })
    expect((await db.assistantThreads.get(other))?.draft).toBe('')
    expect(await db.assistantThreads.count()).toBe(2)
    expect(await db.assistantRuns.count()).toBe(0)
  })

  it('uses the active editor so unsaved text and queued keystrokes are preserved', async () => {
    const id = await createConversation()
    rememberDraft(id, 'Unsaved text')
    const editor = vi.fn(async () => {})
    const unregister = registerDraftEditor(id, editor)
    try {
      expect(await prepareAssistantDraft(source, id)).toBe(id)
      expect(editor).toHaveBeenCalledExactlyOnceWith(source)
      expect((await db.assistantThreads.get(id))?.draft).toBe('')
    } finally { unregister() }
    await expect(prepareAssistantDraft(source, id)).rejects.toThrow('unsaved draft')
    expect(editor).toHaveBeenCalledTimes(1)
  })

  it('serializes simultaneous appends without replacing either snippet', async () => {
    const id = await createConversation()
    await Promise.all([
      prepareAssistantDraft({ ...source, text: 'first snippet' }, id),
      prepareAssistantDraft({ ...source, text: 'second snippet' }, id),
    ])
    const thread = await db.assistantThreads.get(id)
    expect(thread?.draft).toContain('first snippet')
    expect(thread?.draft).toContain('second snippet')
    expect(await db.assistantThreads.count()).toBe(1)
  })

  it('rejects overflow without truncation or creating another conversation', async () => {
    const id = await createConversation()
    const original = 'x'.repeat(MAX_DRAFT_LENGTH)
    await saveDraft(id, original)
    await expect(prepareAssistantDraft(source, id)).rejects.toThrow('not enough room')
    expect((await db.assistantThreads.get(id))?.draft).toBe(original)
    expect((await db.assistantThreads.get(id))?.source).toBeUndefined()
    expect(await db.assistantThreads.count()).toBe(1)
    await saveDraft(id, '')
    await prepareAssistantDraft({ ...source, text: original }, id)
    expect((await db.assistantThreads.get(id))?.draft).toBe(original)
  })

  it('does not silently create a chat when the current conversation was deleted', async () => {
    await expect(prepareAssistantDraft(source, 'deleted')).rejects.toThrow('no longer exists')
    expect(await db.assistantThreads.count()).toBe(0)
  })

  it('preserves meanings up to the canonical speech-block limit', async () => {
    const id = await createConversation()
    const meaning = 'm'.repeat(3000)
    await prepareAssistantDraft({ ...source, meaning }, id)
    const thread = await db.assistantThreads.get(id)
    expect(thread?.source?.meaning).toBe(meaning)
    expect(thread?.draft).toContain(`Meaning: ${meaning}`)
  })
})
