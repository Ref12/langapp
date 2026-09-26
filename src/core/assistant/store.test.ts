import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, LearningDatabase, loadWorkspace } from '../database'
import { openStory, startPractice, submitAnswer, trackWord } from '../learning'
import { curriculumLessons } from '../../data/curriculum'
import type { Workspace } from '../model'
import {
  createConversation, deleteThread, expireAssistantRuns, removeAIConnection, saveAIConnection, saveDraft, savePracticeDraft, selectPracticePhrase, updateThread,
} from './store'
import { assistantThreadSchema, MAX_DRAFT_LENGTH, type AIConnectionInput, type AssistantMessage, type AssistantRun, type AssistantSource } from './contracts'

const source: AssistantSource = {
  text: '  你好，朋友。\n', title: 'Greeting', route: 'dictionary', meaning: 'Hello, friend.', locale: 'zh-Hans',
}
const connection: AIConnectionInput = {
  baseUrl: 'https://example.test/v1///', apiKey: 'device-secret', model: 'test-model',
  nativeTools: false, structuredOutput: false, storageAcknowledged: true,
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => vi.restoreAllMocks())

async function addRun(threadId: string, expiresAt: number, status: AssistantRun['status'] = 'running') {
  const run: AssistantRun = {
    id: crypto.randomUUID(), threadId, userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(),
    connectionRevision: 'test-revision', status, steps: [], createdAt: 1, updatedAt: 1, expiresAt,
  }
  const user: AssistantMessage = {
    id: run.userMessageId, threadId, sequence: 0, role: 'user', text: 'Help me', blocks: [],
    mode: 'conversation', intent: 'message', status: 'completed', runId: run.id, createdAt: 1,
  }
  const reply: AssistantMessage = {
    ...user, id: run.assistantMessageId, sequence: 1, role: 'assistant', text: '',
    status: status === 'running' ? 'pending' : status === 'awaiting-learner' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed',
  }
  await db.transaction('rw', db.assistantRuns, db.assistantMessages, async () => {
    await db.assistantRuns.add(run)
    await db.assistantMessages.bulkAdd([user, reply])
  })
  return { run, user, reply }
}

describe('Assistant database migration', () => {
  it('adds current workspace tables without changing schema 1 learning records or another database', async () => {
    await trackWord('zh:tea', 'dictionary')
    await openStory('zh:tea-house')
    const id = await startPractice('lesson', curriculumLessons[0].id)
    const session = (await db.sessions.get(id))!
    await submitAnswer(id, 0, session.questions[0].wordId)
    const workspace = await loadWorkspace()
    const name = `linguaweave-next-migration-${crypto.randomUUID()}`
    const old = new Dexie(name)
    old.version(1).stores({
      preferences: '&id', words: '&wordId, dueAt', readings: '&storyId, updatedAt', lessons: '&lessonId',
      sessions: '&id, status, createdAt', attempts: '&id, sessionId, wordId, createdAt',
    })
    const separate = new Dexie(`${name}-v1`)
    separate.version(1).stores({ sentinel: '&id' })
    const migrated = new LearningDatabase(name)
    try {
      await separate.table('sentinel').add({ id: 'legacy', value: 'untouched' })
      await old.table('preferences').add(workspace.preferences)
      for (const table of ['words', 'readings', 'lessons', 'sessions', 'attempts'] as const) {
        await old.table(table).bulkAdd(workspace[table])
      }
      old.close()
      await migrated.open()
      expect(migrated.verno).toBe(9)
      expect(await migrated.preferences.get('workspace')).toEqual(workspace.preferences)
      for (const table of ['words', 'readings', 'lessons', 'sessions', 'attempts'] as const) {
        expect(await migrated.table(table).toArray()).toEqual(workspace[table])
      }
      expect(await migrated.assistantThreads.count()).toBe(0)
      expect(await migrated.assistantMessages.count()).toBe(0)
      expect(await migrated.assistantRuns.count()).toBe(0)
      expect(await migrated.aiConnections.count()).toBe(0)
      expect(await migrated.speechConnections.count()).toBe(0)
      expect(await migrated.knowledge.count()).toBe(0)
      expect(await migrated.studyCards.count()).toBe(0)
      expect(await migrated.exerciseSessions.count()).toBe(0)
      expect(await migrated.exerciseAttempts.count()).toBe(0)
      expect(await migrated.profileState.count()).toBe(0)
      expect(await migrated.mahjongGames.count()).toBe(0)
      expect(await migrated.characterStates.count()).toBe(0)
      expect(await migrated.libraryBooks.count()).toBe(0)
      expect(await migrated.sudokuGames.count()).toBe(0)
      expect(migrated.characterStates.schema.primKey.name).toBe('character')
      expect(migrated.mahjongGames.schema.primKey.name).toBe('id')
      expect(migrated.assistantMessages.schema.idxByName['[threadId+sequence]'].unique).toBe(true)
      expect(migrated.assistantThreads.schema.idxByName.updatedAt).toBeDefined()
      expect(migrated.assistantRuns.schema.idxByName['[threadId+status]']).toBeDefined()
      expect(await separate.table('sentinel').get('legacy')).toEqual({ id: 'legacy', value: 'untouched' })
    } finally {
      old.close()
      await migrated.delete()
      await separate.delete()
    }
  })

  it('loads only the learning workspace and excludes Assistant tables from its transaction', async () => {
    await createConversation(source)
    const original = db.preferences.get.bind(db.preferences)
    const tables: string[][] = []
    vi.spyOn(db.preferences, 'get').mockImplementation(() => {
      tables.push(Dexie.currentTransaction!.storeNames)
      return original('workspace')
    })
    const workspace: Workspace = await loadWorkspace()
    expect(workspace).not.toHaveProperty('assistant')
    expect(tables).toEqual([[
      'preferences', 'words', 'readings', 'lessons', 'sessions', 'attempts',
      'knowledge', 'studyCards', 'exerciseSessions', 'exerciseAttempts', 'characterStates',
    ]])
  })
})

describe('durable independent conversations', () => {
  it.each(['conversation', 'shadow'] as const)('persists voice preferences independently of %s teaching, practice, drafts, and progress', async mode => {
    await trackWord('zh:tea', 'dictionary')
    await db.preferences.update('workspace', { defaultSpeechRate: 0.5 })
    const id = await createConversation(source)
    const other = await createConversation()
    const { run } = await addRun(id, Date.now() + 60_000)
    await updateThread(id, { mode, practiceInput: 'spoken-feedback', speechRate: 0.75 })
    const phrase = { type: 'speech', text: '茶', locale: 'zh-Hans' } as const
    await selectPracticePhrase(id, phrase)
    await savePracticeDraft(id, phrase, 'private practice draft')
    const before = (await db.assistantThreads.get(id))!
    const otherBefore = await db.assistantThreads.get(other)
    const learning = await loadWorkspace()
    const messages = await db.assistantMessages.toArray()
    expect(before).toMatchObject({ voiceEnabled: false, voiceInputLocale: 'en-US' })
    await updateThread(id, { voiceEnabled: true, voiceInputLocale: 'zh-Hans' })
    const updated = (await db.assistantThreads.get(id))!
    expect(updated).toEqual({ ...before, voiceEnabled: true, voiceInputLocale: 'zh-Hans', updatedAt: updated.updatedAt })
    await updateThread(id, { voiceEnabled: false })
    expect(await db.assistantThreads.get(id)).toMatchObject({ voiceEnabled: false, voiceInputLocale: 'zh-Hans' })
    await updateThread(id, { voiceEnabled: true, voiceInputLocale: 'en-US' })
    db.close()
    await db.open()
    expect(await db.assistantThreads.get(id)).toMatchObject({
      ...before, updatedAt: expect.any(Number), voiceEnabled: true, voiceInputLocale: 'en-US',
    })
    expect(await db.assistantThreads.get(other)).toEqual(otherBefore)
    expect(await db.assistantMessages.toArray()).toEqual(messages)
    expect(await db.assistantRuns.get(run.id)).toEqual(run)
    expect(await loadWorkspace()).toEqual(learning)
  })

  it('accepts old threads without voice fields and does not persist implicit voice defaults on unrelated edits', async () => {
    const id = await createConversation(source)
    const legacy = (await db.assistantThreads.get(id))!
    delete legacy.voiceEnabled
    delete legacy.voiceInputLocale
    expect(assistantThreadSchema.parse(legacy)).toEqual(legacy)
    await db.assistantThreads.put(legacy)
    await updateThread(id, { romanization: false })
    const saved = await db.assistantThreads.get(id)
    expect(saved).not.toHaveProperty('voiceEnabled')
    expect(saved).not.toHaveProperty('voiceInputLocale')
    expect(saved).toMatchObject({ draft: legacy.draft, source: legacy.source, mode: legacy.mode, speechRate: legacy.speechRate })
    await updateThread(id, { voiceEnabled: true })
    expect(await db.assistantThreads.get(id)).toMatchObject({ voiceEnabled: true })
    expect(await db.assistantThreads.get(id)).not.toHaveProperty('voiceInputLocale')
    expect(await db.assistantMessages.count()).toBe(0)
  })

  it.each([
    { voiceEnabled: 'true' }, { voiceEnabled: 1 }, { voiceEnabled: null },
    { voiceInputLocale: 'zh-CN' }, { voiceInputLocale: 'en-GB' }, { voiceInputLocale: '' }, { voiceInputLocale: null },
    { voiceEnabled: true, voiceAutoSubmit: true },
  ])('rejects invalid voice settings atomically (case %#)', async changes => {
    const id = await createConversation(source)
    const before = await db.assistantThreads.get(id)
    await expect(updateThread(id, changes as never)).rejects.toThrow()
    expect(await db.assistantThreads.get(id)).toEqual(before)
    expect(await db.assistantMessages.count()).toBe(0)
  })

  it('persists independent practice input and phrases without changing mode or the composer', async () => {
    const id = await createConversation(source)
    const other = await createConversation()
    const before = await db.assistantThreads.get(id)
    expect(before?.practiceInput).toBe('listen-repeat')
    const phrase = { type: 'speech', text: '\u8336', locale: 'zh-Hans', meaning: 'tea' } as const
    await updateThread(id, { practiceInput: 'spoken-feedback' })
    await selectPracticePhrase(id, phrase)
    await savePracticeDraft(id, phrase, '  reviewed transcript  ')
    await selectPracticePhrase(id, phrase)
    expect(await db.assistantThreads.get(id)).toMatchObject({
      practiceInput: 'spoken-feedback', practicePhrase: phrase, practiceDraft: '  reviewed transcript  ',
      mode: before?.mode, draft: before?.draft, source: before?.source,
    })
    expect((await db.assistantThreads.get(other))?.practiceInput).toBe('listen-repeat')
    expect(await db.assistantMessages.count()).toBe(0)
    await selectPracticePhrase(id)
    expect((await db.assistantThreads.get(id))?.practicePhrase).toBeUndefined()
    expect((await db.assistantThreads.get(id))?.practiceDraft).toBeUndefined()
    await expect(savePracticeDraft(id, phrase, 'late')).rejects.toThrow('translation changed')
    expect((await db.assistantThreads.get(id))?.draft).toBe(before?.draft)
  })

  it('validates practice choices and protects a replacement phrase from stale transcript saves', async () => {
    const id = await createConversation()
    const phrase = { type: 'speech', text: '\u8336', locale: 'zh-Hans' } as const
    await expect(updateThread(id, { practiceInput: 'automatic-recording' } as never)).rejects.toThrow()
    await expect(selectPracticePhrase(id, { ...phrase, locale: 'en-US' })).rejects.toThrow()
    await selectPracticePhrase(id, phrase)
    await expect(savePracticeDraft(id, phrase, 'x'.repeat(MAX_DRAFT_LENGTH + 1))).rejects.toThrow()
    await selectPracticePhrase(id, { ...phrase, text: '\u4f60\u597d' })
    await expect(savePracticeDraft(id, phrase, 'old attempt')).rejects.toThrow('translation changed')
    expect((await db.assistantThreads.get(id))?.practiceDraft).toBeUndefined()
  })

  it('preserves a maximum-length source without silently truncating its draft', async () => {
    const text = 'x'.repeat(MAX_DRAFT_LENGTH)
    const id = await createConversation({ ...source, text })
    expect((await db.assistantThreads.get(id))?.source?.text).toBe(text)
    expect((await db.assistantThreads.get(id))?.draft).toBe(text)
    await expect(createConversation({ ...source, text: `${text}x` })).rejects.toThrow()
  })

  it('creates validated defaults and editable explanation context without changing learning evidence', async () => {
    const before = await loadWorkspace()
    const empty = await createConversation()
    const contextual = await createConversation(source)
    const overridden = await createConversation(source, 'overview')
    expect(new Set([empty, contextual, overridden]).size).toBe(3)
    expect(await db.assistantThreads.get(empty)).toMatchObject({
      title: 'New conversation', draft: '', mode: 'conversation', shadowIntent: 'new-phrase',
      romanization: true, speechRate: 1, returnRoute: 'overview', voiceEnabled: false, voiceInputLocale: 'en-US',
    })
    expect(await db.assistantThreads.get(contextual)).toMatchObject({
      source, draft: `Please explain this passage:\n\n${source.text}`, returnRoute: 'dictionary',
    })
    expect((await db.assistantThreads.get(overridden))?.returnRoute).toBe('overview')
    expect(await loadWorkspace()).toEqual(before)
    expect(await db.aiConnections.count()).toBe(0)
    expect(await db.assistantMessages.count()).toBe(0)
  })

  it('isolates concurrent drafts, preserves preferences and removes context without losing text', async () => {
    const first = await createConversation(source)
    const second = await createConversation()
    await updateThread(first, { romanization: false, speechRate: 0.75, shadowIntent: 'repeat' })
    await Promise.all([saveDraft(first, 'My edited question'), saveDraft(second, 'Independent draft')])
    expect((await db.assistantThreads.get(first))?.source).toEqual(source)
    await saveDraft(first, 'Keep this question', null)
    expect(await db.assistantThreads.get(first)).toMatchObject({
      draft: 'Keep this question', romanization: false, speechRate: 0.75, shadowIntent: 'repeat',
    })
    expect(await db.assistantThreads.get(first)).not.toHaveProperty('source')
    expect((await db.assistantThreads.get(second))?.draft).toBe('Independent draft')
    await saveDraft(second, 'Ask this instead', source)
    expect((await db.assistantThreads.get(second))?.source).toEqual(source)
    db.close()
    await db.open()
    expect((await db.assistantThreads.get(first))?.draft).toBe('Keep this question')
    expect((await db.assistantThreads.get(second))?.draft).toBe('Ask this instead')
  })

  it('appends mode markers in sequence and never rewrites old messages or live work', async () => {
    const id = await createConversation()
    const { run, user, reply } = await addRun(id, Date.now() + 60_000)
    await saveDraft(id, 'Unsent draft')
    await updateThread(id, { mode: 'shadow', shadowPhrase: { type: 'speech', text: '你好', locale: 'zh-Hans' } })
    await updateThread(id, { mode: 'shadow', speechRate: 1.25 })
    await updateThread(id, { mode: 'conversation' })
    expect(await db.assistantRuns.get(run.id)).toEqual(run)
    expect(await db.assistantMessages.get(user.id)).toEqual(user)
    expect(await db.assistantMessages.get(reply.id)).toEqual(reply)
    const messages = await db.assistantMessages.where('[threadId+sequence]').between([id, 0], [id, 99]).toArray()
    expect(messages.map(message => message.sequence)).toEqual([0, 1, 2, 3])
    expect(messages.slice(2)).toMatchObject([
      { role: 'event', status: 'completed', mode: 'shadow', text: 'Switched to Shadow mode.' },
      { role: 'event', status: 'completed', mode: 'conversation', text: 'Switched to Conversation mode.' },
    ])
    expect((await db.assistantThreads.get(id))?.draft).toBe('Unsent draft')
  })

  it('serializes competing mode changes and enforces per-thread sequence uniqueness', async () => {
    const id = await createConversation()
    await Promise.all([updateThread(id, { mode: 'shadow' }), updateThread(id, { mode: 'conversation' })])
    const events = await db.assistantMessages.where('threadId').equals(id).toArray()
    expect(events).toHaveLength(2)
    expect(new Set(events.map(event => event.sequence)).size).toBe(2)
    await expect(db.assistantMessages.add({ ...events[0], id: crypto.randomUUID() })).rejects.toThrow()
  })

  it('rejects missing threads and invalid changes rather than partially saving', async () => {
    await expect(saveDraft('missing', 'draft')).rejects.toThrow('no longer exists')
    await expect(updateThread('missing', { mode: 'shadow' })).rejects.toThrow('no longer exists')
    await expect(deleteThread('missing')).rejects.toThrow('no longer exists')
    await expect(createConversation({ ...source, route: 'javascript:alert(1)' })).rejects.toThrow()
    const id = await createConversation(source)
    const before = await db.assistantThreads.get(id)
    await expect(saveDraft(id, 'x'.repeat(MAX_DRAFT_LENGTH + 1))).rejects.toThrow()
    await expect(saveDraft(id, 'changed', { ...source, text: '' })).rejects.toThrow()
    await expect(updateThread(id, { speechRate: 9 } as never)).rejects.toThrow()
    await expect(updateThread(id, { title: 'forbidden' } as never)).rejects.toThrow()
    expect(await db.assistantThreads.get(id)).toEqual(before)
    expect(await db.assistantMessages.count()).toBe(0)
    vi.spyOn(db.assistantThreads, 'put').mockRejectedValueOnce(new Error('Storage full'))
    await expect(updateThread(id, { mode: 'shadow' })).rejects.toThrow('Storage full')
    expect(await db.assistantMessages.count()).toBe(0)
    expect(await db.assistantThreads.get(id)).toEqual(before)
  })

  it('atomically deletes only owned history and runs, preserving other conversations and device settings', async () => {
    const id = await createConversation()
    const other = await createConversation()
    const owned = await addRun(id, 500)
    const retained = await addRun(other, 500)
    await trackWord('zh:tea', 'dictionary')
    await saveAIConnection(connection)
    const learning = await loadWorkspace()
    const savedConnection = await db.aiConnections.get('assistant')
    vi.spyOn(db.assistantThreads, 'delete').mockRejectedValueOnce(new Error('Storage full'))
    await expect(deleteThread(id)).rejects.toThrow('Storage full')
    expect(await db.assistantRuns.get(owned.run.id)).toEqual(owned.run)
    expect(await db.assistantMessages.where('threadId').equals(id).count()).toBe(2)
    expect(await db.assistantThreads.get(id)).toBeDefined()
    await deleteThread(id)
    expect(await db.assistantThreads.get(id)).toBeUndefined()
    expect(await db.assistantRuns.get(owned.run.id)).toBeUndefined()
    expect(await db.assistantMessages.where('threadId').equals(id).count()).toBe(0)
    expect(await db.assistantRuns.get(retained.run.id)).toEqual(retained.run)
    expect(await db.assistantMessages.where('threadId').equals(other).count()).toBe(2)
    expect(await db.aiConnections.get('assistant')).toEqual(savedConnection)
    expect(await loadWorkspace()).toEqual(learning)
  })
})

describe('device-only AI connection', () => {
  it('preserves explicit protocols, accepts older records, and rejects unknown APIs', async () => {
    await saveAIConnection(connection)
    expect((await db.aiConnections.get('assistant'))?.apiType).toBeUndefined()
    for (const apiType of ['chat-completions', 'responses'] as const) {
      await saveAIConnection({ ...connection, apiType })
      expect((await db.aiConnections.get('assistant'))?.apiType).toBe(apiType)
    }
    await expect(saveAIConnection({ ...connection, apiType: 'unsupported' } as never)).rejects.toThrow()
    expect((await db.aiConnections.get('assistant'))?.apiType).toBe('responses')
  })

  it('normalizes URLs, requires acknowledgement and rotates the revision on every save', async () => {
    await expect(saveAIConnection({ ...connection, storageAcknowledged: false } as never)).rejects.toThrow()
    await expect(saveAIConnection({ ...connection, apiKey: '  ' })).rejects.toThrow()
    expect(await db.aiConnections.count()).toBe(0)
    await saveAIConnection(connection)
    const first = (await db.aiConnections.get('assistant'))!
    expect(first).toMatchObject({ ...connection, id: 'assistant', baseUrl: 'https://example.test/v1' })
    await saveAIConnection(connection)
    expect((await db.aiConnections.get('assistant'))?.revision).not.toBe(first.revision)
    expect(await db.aiConnections.count()).toBe(1)
    await removeAIConnection()
    expect(await db.aiConnections.count()).toBe(0)
  })

  it.each([
    'http://example.test/v1', 'https://name:secret@example.test/v1', 'https://example.test/v1?key=secret',
    'https://example.test/v1#secret', 'javascript:alert(1)',
  ])('rejects unsafe connection URL %s', async baseUrl => {
    await expect(saveAIConnection({ ...connection, baseUrl })).rejects.toThrow()
    expect(await db.aiConnections.count()).toBe(0)
  })

  it.each(['http://localhost:1234/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:1234/v1'])(
    'allows explicit local development URL %s', async baseUrl => {
      await saveAIConnection({ ...connection, baseUrl })
      expect((await db.aiConnections.get('assistant'))?.baseUrl).toBe(baseUrl)
    },
  )
})

describe('honest interrupted-run recovery', () => {
  it('expires only running records at or past their lease while preserving live and settled records', async () => {
    const expired = await addRun(await createConversation(), 100)
    const live = await addRun(await createConversation(), 101)
    const completed = await addRun(await createConversation(), 1, 'awaiting-learner')
    const cancelled = await addRun(await createConversation(), 1, 'cancelled')
    const network = vi.spyOn(globalThis, 'fetch')
    db.close()
    await db.open()
    await expireAssistantRuns(100)
    expect(await db.assistantRuns.get(expired.run.id)).toMatchObject({ status: 'interrupted', updatedAt: 100, error: expect.stringContaining('send again') })
    expect(await db.assistantMessages.get(expired.reply.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('send again') })
    expect(await db.assistantMessages.get(expired.user.id)).toEqual(expired.user)
    for (const fixture of [live, completed, cancelled]) {
      expect(await db.assistantRuns.get(fixture.run.id)).toEqual(fixture.run)
      expect(await db.assistantMessages.get(fixture.reply.id)).toEqual(fixture.reply)
    }
    await expireAssistantRuns(100)
    expect(network).not.toHaveBeenCalled()
  })

  it('does not partially recover when a run has broken ownership or writes fail', async () => {
    const fixture = await addRun(await createConversation(), 1)
    await db.assistantMessages.update(fixture.reply.id, { threadId: 'different-thread' })
    await expect(expireAssistantRuns(2)).rejects.toThrow('inconsistent saved records')
    expect(await db.assistantRuns.get(fixture.run.id)).toEqual(fixture.run)
    await db.assistantMessages.put(fixture.reply)
    vi.spyOn(db.assistantMessages, 'put').mockRejectedValueOnce(new Error('Storage full'))
    await expect(expireAssistantRuns(2)).rejects.toThrow('Storage full')
    expect(await db.assistantRuns.get(fixture.run.id)).toEqual(fixture.run)
    expect(await db.assistantMessages.get(fixture.reply.id)).toEqual(fixture.reply)
    await expect(expireAssistantRuns(Number.NaN)).rejects.toThrow()
  })
})
