import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from './database'
import { exportBackup, exportWorkspaceBackup, MAX_BACKUP_BYTES, readBackup, restoreBackup } from './backup'
import { savePreferences, trackWord } from './learning'
import { createConversation, saveAIConnection, saveDraft, savePracticeDraft, selectPracticePhrase, updateThread } from './assistant/store'
import type { AssistantBackup, AssistantMessage, AssistantRun } from './assistant/contracts'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => vi.restoreAllMocks())

async function seedAssistant(status: AssistantRun['status'] = 'awaiting-learner') {
  const threadId = await createConversation({ text: '  你好。\n', title: 'Greeting', route: 'dictionary', locale: 'zh-Hans' })
  await saveDraft(threadId, 'My unsent question')
  const run: AssistantRun = {
    id: crypto.randomUUID(), threadId, userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(),
    connectionRevision: 'connection-revision-only', status, steps: [], createdAt: 1, updatedAt: 1, expiresAt: Date.now() + 100000,
  }
  const user: AssistantMessage = {
    id: run.userMessageId, threadId, sequence: 0, role: 'user', text: 'Explain the greeting',
    blocks: [], source: (await db.assistantThreads.get(threadId))!.source,
    mode: 'conversation', intent: 'explain', status: 'completed', runId: run.id, createdAt: 1,
  }
  const reply: AssistantMessage = {
    ...user, id: run.assistantMessageId, sequence: 1, role: 'assistant', text: '',
    blocks: status === 'awaiting-learner' ? [{ type: 'speech', text: '你好', locale: 'zh-Hans', romanization: 'nǐ hǎo' }] : [],
    status: status === 'running' ? 'pending' : status === 'awaiting-learner' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed',
  }
  await db.assistantMessages.bulkAdd([user, reply])
  await db.assistantRuns.add(run)
  await updateThread(threadId, { mode: 'shadow', romanization: false, speechRate: 0.75 })
  return { threadId, run, user, reply }
}

async function snapshot(): Promise<AssistantBackup> {
  return {
    threads: await db.assistantThreads.toArray(), messages: await db.assistantMessages.toArray(), runs: await db.assistantRuns.toArray(),
  }
}

async function saveConnection() {
  await saveAIConnection({
    baseUrl: 'https://private-provider.test/v1', apiKey: 'very-private-api-key', model: 'private-model',
    nativeTools: true, structuredOutput: true, storageAcknowledged: true,
  })
}

describe('compatible Assistant workspace backups', () => {
  it.each([
    { voiceEnabled: false, voiceInputLocale: 'en-US' },
    { voiceEnabled: true, voiceInputLocale: 'en-US' },
    { voiceEnabled: false, voiceInputLocale: 'zh-Hans' },
    { voiceEnabled: true, voiceInputLocale: 'zh-Hans' },
  ] as const)('round-trips per-thread voice settings without changing conversation or learning state (case %#)', async voice => {
    const { threadId } = await seedAssistant()
    await trackWord('zh:tea', 'dictionary')
    await updateThread(threadId, voice)
    const learning = await loadWorkspace()
    const assistant = await snapshot()
    const text = await exportWorkspaceBackup()
    expect(readBackup(text).assistant?.threads[0]).toMatchObject(voice)
    await updateThread(threadId, { voiceEnabled: !voice.voiceEnabled })
    await restoreBackup(text)
    expect(await snapshot()).toEqual(assistant)
    expect(await loadWorkspace()).toEqual(learning)
  })

  it.each([
    ['voiceEnabled'], ['voiceInputLocale'], ['voiceEnabled', 'voiceInputLocale'],
  ])('restores optional voice fields without adding new defaults (case %#)', async (...omitted) => {
    const { threadId } = await seedAssistant()
    const old = JSON.parse(await exportWorkspaceBackup())
    for (const field of omitted) delete old.assistant.threads[0][field]
    const text = JSON.stringify(old)
    const thread = readBackup(text).assistant?.threads[0]
    for (const field of omitted) expect(thread).not.toHaveProperty(field)
    await updateThread(threadId, { voiceEnabled: true, voiceInputLocale: 'zh-Hans' })
    await restoreBackup(text)
    expect(await db.assistantThreads.get(threadId)).toEqual(thread)
    const exported = readBackup(await exportWorkspaceBackup()).assistant?.threads[0]
    for (const field of omitted) expect(exported).not.toHaveProperty(field)
  })

  it.each([
    { voiceEnabled: 'true' }, { voiceEnabled: 1 }, { voiceEnabled: null },
    { voiceInputLocale: 'zh-CN' }, { voiceInputLocale: 'en-GB' }, { voiceInputLocale: '' }, { voiceInputLocale: null },
    { voiceEnabled: true, voiceAutoSubmit: true },
  ])('rejects invalid backup voice settings before any writes (case %#)', async voice => {
    await seedAssistant()
    const learning = await loadWorkspace()
    const assistant = await snapshot()
    const backup = JSON.parse(await exportWorkspaceBackup())
    Object.assign(backup.assistant.threads[0], voice)
    const text = JSON.stringify(backup)
    expect(() => readBackup(text)).toThrow()
    await expect(restoreBackup(text)).rejects.toThrow()
    expect(await snapshot()).toEqual(assistant)
    expect(await loadWorkspace()).toEqual(learning)
  })

  it('round-trips practice settings, reviewed draft, and original attempt target; old threads need no new fields', async () => {
    const { threadId, user } = await seedAssistant()
    const legacy = JSON.parse(await exportWorkspaceBackup())
    delete legacy.assistant.threads[0].practiceInput
    const legacyText = JSON.stringify(legacy)
    expect(readBackup(legacyText).assistant?.threads[0].practicePhrase).toBeUndefined()
    expect(readBackup(legacyText).assistant?.threads[0].practiceInput).toBeUndefined()
    const phrase = { type: 'speech', text: '\u8336', locale: 'zh-Hans', meaning: 'tea' } as const
    await updateThread(threadId, { practiceInput: 'spoken-feedback' })
    await selectPracticePhrase(threadId, phrase)
    await savePracticeDraft(threadId, phrase, '\u8336')
    await db.assistantMessages.update(user.id, { intent: 'repeat', practice: { phrase, input: 'speech-transcript' } })
    const text = await exportWorkspaceBackup()
    await restoreBackup(legacyText)
    await restoreBackup(text)
    expect(await db.assistantThreads.get(threadId)).toMatchObject({ practiceInput: 'spoken-feedback', practicePhrase: phrase, practiceDraft: '\u8336' })
    expect((await db.assistantMessages.get(user.id))?.practice?.phrase).toEqual(phrase)
    const invalid = JSON.parse(text)
    invalid.assistant.threads[0].practiceInput = 'auto-record'
    expect(() => readBackup(JSON.stringify(invalid))).toThrow()
  })

  it('round-trips optional voice preferences while older backups retain automatic voice selection', async () => {
    const old = await exportWorkspaceBackup()
    const speechVoices = { 'zh-Hans': { voiceURI: 'chosen-zh', name: 'Mandarin', lang: 'zh-CN', localService: true } }
    await savePreferences({ speechVoices })
    const text = await exportWorkspaceBackup()
    expect(readBackup(text).preferences.speechVoices).toEqual(speechVoices)
    await restoreBackup(old)
    expect((await loadWorkspace()).preferences.speechVoices).toBeUndefined()
    await restoreBackup(text)
    expect((await loadWorkspace()).preferences.speechVoices).toEqual(speechVoices)
    const invalid = JSON.parse(text)
    invalid.workspace.preferences.speechVoices['zh-Hans'].localService = 'yes'
    expect(() => readBackup(JSON.stringify(invalid))).toThrow()
  })

  it.each([0.5, 0.75, 1, 1.25] as const)('round-trips optional default speech rate %s without changing conversation overrides', async defaultSpeechRate => {
    const { threadId } = await seedAssistant()
    await savePreferences({ defaultSpeechRate })
    const text = await exportWorkspaceBackup()
    expect(readBackup(text).preferences.defaultSpeechRate).toBe(defaultSpeechRate)
    await savePreferences({ defaultSpeechRate: 1 })
    await restoreBackup(text)
    expect((await loadWorkspace()).preferences.defaultSpeechRate).toBe(defaultSpeechRate)
    expect((await db.assistantThreads.get(threadId))?.speechRate).toBe(0.75)
  })

  it.each([1, 2])('restores a legacy schema %s backup with no default rate without persisting an implicit fallback', async version => {
    const old = JSON.parse(await exportWorkspaceBackup())
    old.version = version
    if (version === 1) delete old.assistant
    expect(old.workspace.preferences).not.toHaveProperty('defaultSpeechRate')
    await savePreferences({ defaultSpeechRate: 0.5 })
    await restoreBackup(JSON.stringify(old))
    expect((await loadWorkspace()).preferences).not.toHaveProperty('defaultSpeechRate')
    expect(readBackup(await exportWorkspaceBackup()).preferences).not.toHaveProperty('defaultSpeechRate')
  })

  it.each([0, 0.6, 2, -1, '0.75', null])('rejects invalid backup default speech rates before writing (case %#)', async defaultSpeechRate => {
    const before = await loadWorkspace()
    const backup = JSON.parse(await exportWorkspaceBackup())
    backup.workspace.preferences.defaultSpeechRate = defaultSpeechRate
    await expect(restoreBackup(JSON.stringify(backup))).rejects.toThrow()
    expect(await loadWorkspace()).toEqual(before)
  })

  it('captures current learning and Assistant state, not stale UI state, without device secrets or settings', async () => {
    const stale = await loadWorkspace()
    await savePreferences({ name: 'Current workspace' })
    await trackWord('zh:tea', 'dictionary')
    await seedAssistant()
    await saveConnection()
    const before = await loadWorkspace()
    const assistant = await snapshot()
    const text = await exportWorkspaceBackup(stale)
    expect(JSON.parse(text)).toMatchObject({ format: 'linguaweave-next-backup', version: 2, contentVersion: 2 })
    expect(readBackup(text)).toEqual({ ...before, assistant })
    for (const secret of ['very-private-api-key', 'private-provider.test', 'private-model', 'apiKey', 'aiConnections', 'storageAcknowledged', 'baseUrl']) {
      expect(text).not.toContain(secret)
    }
    expect(text).toContain('connection-revision-only')
    const synchronous = exportBackup(before, assistant)
    expect(readBackup(synchronous)).toEqual({ ...before, assistant })
    expect(readBackup(exportBackup(readBackup(synchronous)))).toEqual({ ...before, assistant })
    expect(typeof exportBackup(before)).toBe('string')
  })

  it('reads all exportable tables in one consistent transaction that excludes device connections', async () => {
    const { default: Dexie } = await import('dexie')
    const original = db.assistantThreads.toArray.bind(db.assistantThreads)
    let tables: string[] = []
    vi.spyOn(db.assistantThreads, 'toArray').mockImplementation(() => {
      tables = Dexie.currentTransaction!.storeNames
      return original()
    })
    await exportWorkspaceBackup()
    expect(tables).toEqual([
      'preferences', 'words', 'readings', 'lessons', 'sessions', 'attempts',
      'assistantThreads', 'assistantMessages', 'assistantRuns',
    ])
    expect(tables).not.toContain('aiConnections')
  })

  it('round-trips drafts, exact snippets, mode markers, teaching blocks, and completed run relationships', async () => {
    await seedAssistant()
    await trackWord('zh:tea', 'dictionary')
    const before = await loadWorkspace()
    const assistant = await snapshot()
    const text = await exportWorkspaceBackup()
    await seedAssistant()
    await savePreferences({ name: 'Changed after export' })
    await saveConnection()
    const connection = await db.aiConnections.get('assistant')
    await restoreBackup(text)
    expect(await loadWorkspace()).toEqual(before)
    expect(await snapshot()).toEqual(assistant)
    expect(await db.aiConnections.get('assistant')).toEqual(connection)
  })

  it.each([1, 2])('accepts schema 1 content-version %s and replaces Assistant data but retains the device connection', async contentVersion => {
    await trackWord('zh:tea', 'dictionary')
    const before = await loadWorkspace()
    const old = JSON.parse(exportBackup(before))
    old.version = 1
    old.contentVersion = contentVersion
    delete old.assistant
    await seedAssistant()
    await saveConnection()
    const connection = await db.aiConnections.get('assistant')
    await restoreBackup(JSON.stringify(old))
    expect(readBackup(JSON.stringify(old))).toEqual(before)
    expect(await loadWorkspace()).toEqual(before)
    expect(await snapshot()).toEqual({ threads: [], messages: [], runs: [] })
    expect(await db.aiConnections.get('assistant')).toEqual(connection)
  })

  it('imports running work as interrupted without sending, while export leaves live local work alone', async () => {
    const fixture = await seedAssistant('running')
    const network = vi.spyOn(globalThis, 'fetch')
    const text = await exportWorkspaceBackup()
    expect(JSON.parse(text).assistant.runs[0].status).toBe('running')
    expect(await db.assistantRuns.get(fixture.run.id)).toEqual(fixture.run)
    const preview = readBackup(text)
    expect(preview.assistant?.runs[0]).toMatchObject({ status: 'interrupted', error: expect.stringContaining('send again') })
    await restoreBackup(text)
    expect(await db.assistantRuns.get(fixture.run.id)).toMatchObject({ status: 'interrupted' })
    expect(await db.assistantMessages.get(fixture.reply.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('restoring a backup') })
    expect((await db.assistantThreads.get(fixture.threadId))?.draft).toBe('My unsent question')
    expect(network).not.toHaveBeenCalled()
  })

  it.each([
    ['missing message thread', (assistant: AssistantBackup) => { assistant.messages[0].threadId = 'missing' }],
    ['cross-thread run', (assistant: AssistantBackup) => { assistant.runs[0].threadId = 'another-thread' }],
    ['missing paired message', (assistant: AssistantBackup) => { assistant.runs[0].assistantMessageId = 'missing' }],
    ['wrong role', (assistant: AssistantBackup) => { assistant.messages.find(message => message.role === 'assistant')!.role = 'user' }],
    ['wrong run backlink', (assistant: AssistantBackup) => { assistant.messages.find(message => message.role === 'assistant')!.runId = 'missing' }],
    ['duplicate threads', (assistant: AssistantBackup) => { assistant.threads.push({ ...assistant.threads[0] }) }],
    ['duplicate messages', (assistant: AssistantBackup) => { assistant.messages.push({ ...assistant.messages[0] }) }],
    ['duplicate runs', (assistant: AssistantBackup) => { assistant.runs.push({ ...assistant.runs[0] }) }],
    ['duplicate sequences', (assistant: AssistantBackup) => {
      assistant.messages.push({ ...assistant.messages[0], id: 'different-message-id' })
    }],
    ['mismatched statuses', (assistant: AssistantBackup) => {
      assistant.messages.find(message => message.role === 'assistant')!.status = 'pending'
    }],
    ['unowned pending message', (assistant: AssistantBackup) => {
      const message = assistant.messages.find(item => item.role === 'assistant')!
      message.status = 'pending'
      delete message.runId
    }],
    ['event run ownership', (assistant: AssistantBackup) => {
      assistant.messages.find(message => message.role === 'event')!.runId = assistant.runs[0].id
    }],
  ])('rejects %s before changing any persisted records', async (_label, mutate) => {
    await seedAssistant()
    await saveConnection()
    const before = await loadWorkspace()
    const assistant = await snapshot()
    const connection = await db.aiConnections.get('assistant')
    const invalid = JSON.parse(await exportWorkspaceBackup())
    mutate(invalid.assistant)
    await expect(restoreBackup(JSON.stringify(invalid))).rejects.toThrow()
    expect(await loadWorkspace()).toEqual(before)
    expect(await snapshot()).toEqual(assistant)
    expect(await db.aiConnections.get('assistant')).toEqual(connection)
  })

  it('rejects extra credential fields, unsupported schemas, future content, and oversized files', async () => {
    const text = await exportWorkspaceBackup()
    const valid = JSON.parse(text)
    const invalid = [
      { ...valid, aiConnections: [{ apiKey: 'secret' }] },
      { ...valid, assistant: { ...valid.assistant, connections: [] } },
      { ...valid, version: 3 },
      { ...valid, contentVersion: 3 },
    ]
    for (const backup of invalid) await expect(restoreBackup(JSON.stringify(backup))).rejects.toThrow()
    await expect(restoreBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).rejects.toThrow('5 MiB')
    const tooLarge = await loadWorkspace()
    tooLarge.preferences.name = '字'.repeat(Math.ceil(MAX_BACKUP_BYTES / 3))
    expect(() => exportBackup(tooLarge)).toThrow('5 MiB')
    expect((await loadWorkspace()).preferences.name).toBe('Your workspace')
  })

  it('rolls back all learning and Assistant tables if a restore write fails', async () => {
    await seedAssistant()
    const text = await exportWorkspaceBackup()
    await seedAssistant()
    await trackWord('zh:tea', 'dictionary')
    await saveConnection()
    const before = await loadWorkspace()
    const assistant = await snapshot()
    const connection = await db.aiConnections.get('assistant')
    vi.spyOn(db.assistantMessages, 'bulkAdd').mockRejectedValueOnce(new Error('Storage full'))
    await expect(restoreBackup(text)).rejects.toThrow('Storage full')
    expect(await loadWorkspace()).toEqual(before)
    expect(await snapshot()).toEqual(assistant)
    expect(await db.aiConnections.get('assistant')).toEqual(connection)
  })
})
