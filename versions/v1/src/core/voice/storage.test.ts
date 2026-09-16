import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { clearLocalData, db, exportBackup, importBackup } from '../database'
import type { ConversationMessage, ConversationThread, LanguageProfile } from '../domain'
import type { PronunciationAttempt, VoiceRecording } from './contracts'
import {
  deleteRecording, deleteThreadVoiceData, deleteVoiceThread, getVoiceStorageUsage,
  MAX_RECORDING_BYTES, readAudioBytes, requestVoiceStoragePersistence, saveAttempt, saveRecording,
} from './storage'

const now = '2026-09-09T00:00:00.000Z'
const profile: LanguageProfile = {
  id: 'profile', name: 'Mandarin', sourceLanguage: 'en', targetLanguage: 'zh',
  romanization: 'Pinyin', dailyNewItemLimit: 5, createdAt: now, updatedAt: now,
}
const thread: ConversationThread = {
  id: 'thread', profileId: profile.id, title: 'Voice', mode: 'voice', createdAt: now, updatedAt: now,
}
const message: ConversationMessage = {
  id: 'message', threadId: thread.id, role: 'user', canonicalContent: 'Hello',
  annotations: [], status: 'completed', createdAt: now,
}

function wav(durationMs = 1_000): Blob {
  const buffer = new ArrayBuffer(44 + durationMs * 32)
  const view = new DataView(buffer)
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  tag(0, 'RIFF'); tag(8, 'WAVE'); tag(12, 'fmt '); tag(36, 'data')
  view.setUint32(4, buffer.byteLength - 8, true)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16_000, true)
  view.setUint32(28, 32_000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(40, buffer.byteLength - 44, true)
  return new Blob([buffer], { type: 'audio/wav' })
}
function recording(overrides: Partial<VoiceRecording> = {}): VoiceRecording {
  return {
    id: 'recording', profileId: profile.id, threadId: thread.id, purpose: 'conversation',
    locale: 'zh-CN', durationMs: 1_000, mimeType: 'audio/wav', encoding: 'pcm-s16le-16000-mono',
    audio: wav(), recognizedTranscript: '你好', provider: { provider: 'azure', configurationVersion: 1 },
    createdAt: now, ...overrides,
  }
}
function attempt(overrides: Partial<PronunciationAttempt> = {}): PronunciationAttempt {
  return {
    id: 'attempt', profileId: profile.id, threadId: thread.id, recordingId: 'practice',
    referenceText: '你好', locale: 'zh-CN', provider: { provider: 'azure', configurationVersion: 1 },
    createdAt: now, ...overrides,
  }
}
async function seedPractice(): Promise<void> {
  await saveRecording(recording({ id: 'practice', purpose: 'practice' }))
  await saveAttempt(attempt())
}
async function seedLinkedRecording(): Promise<void> {
  await db.conversationMessages.add(message)
  await saveRecording(recording({ messageId: message.id }))
  await db.conversationMessages.update(message.id, { recordingId: 'recording' })
}
async function seedCredentials(): Promise<void> {
  await db.aiConnections.put({
    id: 'default', baseUrl: 'https://example.test', apiKey: 'llm-secret', model: 'model',
    configurationVersion: 1, warningAcknowledged: true, updatedAt: now,
  })
  await db.speechConnections.put({
    id: 'default', apiKey: 'speech-secret', region: 'westus', configurationVersion: 1,
    warningAcknowledged: true, updatedAt: now,
  })
}

beforeEach(async () => {
  // Node's native Blob is structured-cloneable, unlike jsdom's Blob wrapper.
  vi.stubGlobal('Blob', NodeBlob)
  await clearLocalData()
  await db.profiles.add(profile)
  await db.conversationThreads.add(thread)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('voice storage', () => {
  it('stores unsent review drafts and their original audio across reopen', async () => {
    await saveRecording(recording())
    db.close()
    await db.open()
    const saved = await db.voiceRecordings.get('recording')
    expect(saved?.messageId).toBeUndefined()
    expect(saved?.recognizedTranscript).toBe('你好')
    expect(await readAudioBytes(saved!.audio!)).toEqual(await readAudioBytes(wav()))
    expect(await getVoiceStorageUsage()).toBe(32_044)
    expect(db.verno).toBe(6)
  })

  it('upgrades legacy version 5 without changing text threads', async () => {
    await db.delete()
    const legacy = new Dexie('linguaweave')
    legacy.version(5).stores({
      settings: '&key', profiles: '&id, targetLanguage, createdAt',
      libraryItems: '&id, profileId, createdAt, updatedAt',
      learningItems: '&id, targetLanguage, sourceText',
      userItemStates: '&id, profileId, itemId, tier, updatedAt',
      evidenceEvents: '&id, profileId, itemId, sourceModuleId, createdAt',
      aiConnections: '&id', conversationThreads: '&id, profileId, updatedAt',
      conversationMessages: '&id, threadId, createdAt, status',
      reviewAttempts: '&id, profileId, itemId, activity, createdAt',
      readingProgress: '&id, profileId, documentId, chapterId, updatedAt',
      readingBookmarks: '&id, profileId, documentId, chapterId, createdAt',
    })
    await legacy.table('conversationThreads').put({ ...thread, mode: undefined })
    legacy.close()
    await db.open()
    expect((await db.conversationThreads.get(thread.id))?.mode).toBeUndefined()
    expect(await db.voiceRecordings.count()).toBe(0)
    expect(db.verno).toBe(6)
  })

  it('rejects cross-profile/thread/message ownership and immutable reassignment', async () => {
    await db.profiles.add({ ...profile, id: 'other' })
    await db.conversationThreads.add({ ...thread, id: 'other-thread', profileId: 'other' })
    await db.conversationMessages.add({ ...message, threadId: 'other-thread' })
    await expect(saveRecording(recording({ profileId: 'other' }))).rejects.toThrow('profile')
    await expect(saveRecording(recording({ messageId: message.id }))).rejects.toThrow('message')
    await saveRecording(recording())
    await expect(saveRecording(recording({ profileId: 'other', threadId: 'other-thread' })))
      .rejects.toThrow('cannot be changed')
    expect((await db.voiceRecordings.get('recording'))?.profileId).toBe(profile.id)
  })

  it('allows draft attachment once but rejects detachment and reassignment', async () => {
    await saveRecording(recording())
    await db.conversationMessages.add(message)
    await saveRecording(recording({ messageId: message.id, submittedTranscript: 'Edited' }))
    await expect(saveRecording(recording())).rejects.toThrow('cannot be changed')
    expect((await db.voiceRecordings.get('recording'))?.submittedTranscript).toBe('Edited')
  })

  it('validates practice references, immutable reference text and assessment scores', async () => {
    await expect(saveAttempt(attempt())).rejects.toThrow('ownership')
    await saveRecording(recording())
    await expect(saveAttempt(attempt({ recordingId: 'recording' }))).rejects.toThrow('ownership')
    await seedPractice()
    await expect(saveAttempt(attempt({ referenceText: 'Different' }))).rejects.toThrow('cannot be changed')
    await expect(saveAttempt(attempt({ result: { status: 'assessed', accuracy: 101, words: [] } })))
      .rejects.toThrow()
    await saveAttempt(attempt({ result: { status: 'assessed', accuracy: 81, words: [] } }))
    expect((await db.pronunciationAttempts.get('attempt'))?.result?.accuracy).toBe(81)
  })

  it('preserves the exact practice reference and provider configuration', async () => {
    await saveRecording(recording({ id: 'practice', purpose: 'practice' }))
    await saveAttempt(attempt({ referenceText: ' 你好 ', provider: { provider: 'azure', configurationVersion: 2 } }))
    expect(await db.pronunciationAttempts.get('attempt')).toMatchObject({
      referenceText: ' 你好 ', provider: { provider: 'azure', configurationVersion: 2 },
    })
  })

  it('rejects invalid encodings, missing audio flags, duration and size caps', async () => {
    await expect(saveRecording(recording({ durationMs: 120_001 }))).rejects.toThrow()
    await expect(saveRecording(recording({ purpose: 'practice', durationMs: 30_001 }))).rejects.toThrow()
    await expect(saveRecording(recording({ audio: undefined }))).rejects.toThrow('unavailable')
    await expect(saveRecording(recording({ durationMs: 2_000 }))).rejects.toThrow('duration')
    await expect(saveRecording(recording({ audio: new Blob(['not wav'], { type: 'audio/wav' }) })))
      .rejects.toThrow('WAV')
    await expect(saveRecording(recording({ audio: 'base64' as unknown as Blob }))).rejects.toThrow('Blob')
    const wrongRate = await readAudioBytes(wav())
    new DataView(wrongRate).setUint32(24, 48_000, true)
    await expect(saveRecording(recording({ audio: new Blob([wrongRate], { type: 'audio/wav' }) })))
      .rejects.toThrow('encoding')
    await saveRecording(recording({ durationMs: 120_000, audio: wav(120_000) }))
    expect(await getVoiceStorageUsage()).toBe(MAX_RECORDING_BYTES)
  })

  it('deletes a recording and linked attempts without removing transcript metadata', async () => {
    await seedLinkedRecording()
    await seedPractice()
    await expect(deleteRecording('recording', 'other')).rejects.toThrow('profile')
    await deleteRecording('recording', profile.id)
    expect((await db.conversationMessages.get(message.id))?.recordingId).toBeUndefined()
    expect((await db.conversationMessages.get(message.id))?.canonicalContent).toBe('Hello')
    await deleteRecording('practice', profile.id)
    expect(await db.pronunciationAttempts.count()).toBe(0)
    expect(await getVoiceStorageUsage()).toBe(0)
  })

  it('deletes thread voice data separately and full threads without Dictionary evidence', async () => {
    await seedLinkedRecording()
    await seedPractice()
    await db.evidenceEvents.add({
      id: 'evidence', profileId: profile.id, itemId: 'shared', sourceModuleId: 'conversation',
      type: 'viewed', createdAt: now,
    })
    await expect(deleteThreadVoiceData(thread.id, 'other')).rejects.toThrow('profile')
    await deleteThreadVoiceData(thread.id, profile.id)
    expect(await db.voiceRecordings.count()).toBe(0)
    expect(await db.pronunciationAttempts.count()).toBe(0)
    expect(await db.conversationMessages.count()).toBe(1)
    await seedPractice()
    await deleteVoiceThread(thread.id, profile.id)
    expect(await db.voiceRecordings.count()).toBe(0)
    expect(await db.pronunciationAttempts.count()).toBe(0)
    expect(await db.conversationMessages.count()).toBe(0)
    expect(await db.conversationThreads.count()).toBe(0)
    expect(await db.evidenceEvents.count()).toBe(1)
  })

  it('surfaces actionable quota failures without evicting previous recordings', async () => {
    await saveRecording(recording())
    const draft = recording({ id: 'new' })
    vi.spyOn(db.voiceRecordings, 'put').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'))
    await expect(saveRecording(draft)).rejects.toThrow('Keep this draft open')
    expect(draft.audio?.size).toBe(32_044)
    expect(await db.voiceRecordings.count()).toBe(1)
    expect(await getVoiceStorageUsage()).toBe(32_044)
  })

  it('uses storage estimates and supports best-effort persistent storage', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: {
      estimate: vi.fn().mockResolvedValue({ quota: 100, usage: 90 }), persist,
    } })
    expect(await requestVoiceStoragePersistence()).toBe(true)
    expect(persist).toHaveBeenCalledOnce()
    await expect(saveRecording(recording())).rejects.toThrow('free device space')
    expect(await db.voiceRecordings.count()).toBe(0)
  })

  it('does not block transcript edits when the device estimate is already full', async () => {
    await saveRecording(recording())
    vi.stubGlobal('navigator', { storage: {
      estimate: vi.fn().mockResolvedValue({ quota: 100, usage: 110 }),
    } })
    await saveRecording(recording({ submittedTranscript: 'Edited transcript' }))
    expect((await db.voiceRecordings.get('recording'))?.submittedTranscript).toBe('Edited transcript')
  })
})

describe('voice backups', () => {
  it('defaults to metadata-only unavailable recordings and excludes every credential store/key', async () => {
    await seedLinkedRecording()
    await seedPractice()
    await seedCredentials()
    await db.settings.bulkPut([
      { key: 'activeProfileId', value: profile.id },
      { key: 'speechApiKey', value: 'generic-secret' },
      { key: 'aiConnection', value: 'generic-secret' },
      { key: 'lastReadingDocument:profile', value: 'generic-secret' },
      { key: 'voiceSecret', value: 'generic-secret' },
    ])
    const backup = await exportBackup()
    expect(backup.version).toBe(2)
    expect(backup.data.settings).toEqual([{ key: 'activeProfileId', value: profile.id }])
    expect(JSON.stringify(backup)).not.toContain('secret')
    expect(backup.data.voiceRecordings?.every((item) => item.audioUnavailable && !item.audio)).toBe(true)
    await importBackup(JSON.parse(JSON.stringify(backup)))
    expect((await db.voiceRecordings.get('recording'))?.audioUnavailable).toBe(true)
    expect((await db.voiceRecordings.get('recording'))?.recognizedTranscript).toBe('你好')
    expect(await getVoiceStorageUsage()).toBe(0)
    expect(await db.pronunciationAttempts.count()).toBe(1)
    expect((await db.aiConnections.get('default'))?.apiKey).toBe('llm-secret')
    expect((await db.speechConnections.get('default'))?.apiKey).toBe('speech-secret')
  })

  it('roundtrips opt-in audio bytes and assessment results through JSON', async () => {
    await seedPractice()
    await saveAttempt(attempt({ result: { status: 'assessed', accuracy: 90, words: [] } }))
    const backup = JSON.parse(JSON.stringify(await exportBackup(true)))
    expect(backup.data.voiceRecordings[0].audio).toMatchObject({
      version: 1, encoding: 'base64', byteLength: 32_044,
    })
    await importBackup(backup)
    const saved = await db.voiceRecordings.get('practice')
    expect(saved?.audioUnavailable).toBe(false)
    expect(await readAudioBytes(saved!.audio!)).toEqual(await readAudioBytes(wav()))
    expect((await db.pronunciationAttempts.get('attempt'))?.result?.accuracy).toBe(90)
  })

  it('imports legacy v1 without new fields and clears stale voice data, preserving credentials', async () => {
    const backup = await exportBackup()
    backup.version = 1
    delete backup.data.voiceRecordings
    delete backup.data.pronunciationAttempts
    await seedPractice()
    await seedCredentials()
    await importBackup(backup)
    expect(await db.voiceRecordings.count()).toBe(0)
    expect(await db.pronunciationAttempts.count()).toBe(0)
    expect(await db.speechConnections.count()).toBe(1)
    expect(await db.aiConnections.count()).toBe(1)
    expect(await db.conversationThreads.count()).toBe(1)
  })

  it('filters credential keys injected into imported settings', async () => {
    const backup = await exportBackup()
    backup.data.settings.push({ key: 'speechConnection', value: 'secret' })
    backup.data.settings.push({ key: 'activeProfileId', value: 'secret' })
    await importBackup(backup)
    expect(await db.settings.count()).toBe(0)
  })

  it.each(['profile', 'message', 'attempt', 'missing-recording'])(
    'rejects malicious %s ownership atomically', async (kind) => {
      await seedLinkedRecording()
      await seedPractice()
      const backup = await exportBackup(true)
      if (kind === 'profile') backup.data.voiceRecordings![0].profileId = 'other'
      if (kind === 'message') backup.data.voiceRecordings!.find((item) => item.id === 'recording')!.messageId = 'missing'
      if (kind === 'attempt') backup.data.pronunciationAttempts![0].threadId = 'other'
      if (kind === 'missing-recording') backup.data.conversationMessages[0].recordingId = 'missing'
      await expect(importBackup(backup)).rejects.toThrow()
      expect(await db.voiceRecordings.count()).toBe(2)
      expect((await db.voiceRecordings.get('recording'))?.audio?.size).toBe(32_044)
    },
  )

  it.each(['too-long', 'length-mismatch', 'invalid-base64', 'wrong-wav', 'wrong-duration'])(
    'rejects %s audio before opening the restore transaction', async (kind) => {
      await saveRecording(recording())
      const backup = await exportBackup(true)
      const record = backup.data.voiceRecordings![0]
      const audio = record.audio!
      if (kind === 'too-long') audio.byteLength = MAX_RECORDING_BYTES + 1
      if (kind === 'length-mismatch') audio.byteLength--
      if (kind === 'invalid-base64') audio.data = '%'.repeat(audio.data.length)
      if (kind === 'wrong-wav') audio.data = btoa('X'.repeat(audio.byteLength))
      if (kind === 'wrong-duration') record.durationMs = 100
      const transaction = vi.spyOn(db, 'transaction')
      await expect(importBackup(backup)).rejects.toThrow()
      expect(transaction).not.toHaveBeenCalled()
      expect(await getVoiceStorageUsage()).toBe(32_044)
    },
  )

  it('rolls back clears and writes if a restored table fails', async () => {
    await saveRecording(recording())
    const backup = await exportBackup()
    backup.data.conversationThreads[0].title = 'Replacement'
    vi.spyOn(db.voiceRecordings, 'bulkAdd').mockRejectedValueOnce(new Error('Write failed'))
    await expect(importBackup(backup)).rejects.toThrow('Write failed')
    expect((await db.conversationThreads.get(thread.id))?.title).toBe('Voice')
    expect(await getVoiceStorageUsage()).toBe(32_044)
  })
})
