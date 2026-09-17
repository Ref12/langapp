import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { savePreferences } from '../learning'
import { createConversation, updateThread } from './store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
})

describe('new conversation speaking speed', () => {
  it('preserves the existing normal-speed fallback without saving an implicit workspace default', async () => {
    const before = await db.preferences.get('workspace')
    const id = await createConversation()
    expect((await db.assistantThreads.get(id))?.speechRate).toBe(1)
    expect(await db.preferences.get('workspace')).toEqual(before)
    expect(await db.preferences.get('workspace')).not.toHaveProperty('defaultSpeechRate')
  })

  it.each([0.5, 0.75, 1, 1.25] as const)('uses saved default %s for new conversations and source-based drafts', async defaultSpeechRate => {
    await savePreferences({ defaultSpeechRate })
    const empty = await createConversation()
    const source = await createConversation({ text: '茶', title: 'Tea', route: 'dictionary', locale: 'zh-Hans' })
    expect((await db.assistantThreads.get(empty))?.speechRate).toBe(defaultSpeechRate)
    expect((await db.assistantThreads.get(source))?.speechRate).toBe(defaultSpeechRate)
  })

  it('does not rewrite old conversations when the default changes or override their saved rates', async () => {
    const original = await createConversation()
    await updateThread(original, { speechRate: 1.25 })
    const before = await db.assistantThreads.get(original)
    await savePreferences({ defaultSpeechRate: 0.5 })
    const first = await createConversation()
    await savePreferences({ defaultSpeechRate: 0.75 })
    const second = await createConversation()
    expect(await db.assistantThreads.get(original)).toEqual(before)
    expect((await db.assistantThreads.get(first))?.speechRate).toBe(0.5)
    expect((await db.assistantThreads.get(second))?.speechRate).toBe(0.75)
    expect(await db.assistantMessages.count()).toBe(0)
    expect(await db.assistantRuns.count()).toBe(0)
  })
})
