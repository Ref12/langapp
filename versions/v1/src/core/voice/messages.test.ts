import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, clearLocalData, exportBackup, importBackup } from '../database'
import { submitVoiceMessage } from './messages'
import { encodeWav } from './pcm'
import { saveRecording } from './storage'

const now = '2026-09-09T00:00:00.000Z'
const message = { id: 'message', threadId: 'thread', role: 'user' as const, canonicalContent: 'Edited', status: 'completed' as const, annotations: [], createdAt: now }
beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob)
  await clearLocalData()
  await db.profiles.add({ id: 'profile', name: 'Japanese', sourceLanguage: 'en', targetLanguage: 'ja', romanization: 'Hepburn', dailyNewItemLimit: 5, createdAt: now, updatedAt: now })
  await db.conversationThreads.add({ id: 'thread', profileId: 'profile', title: 'Voice', mode: 'voice', createdAt: now, updatedAt: now })
  await saveRecording({
    id: 'recording', profileId: 'profile', threadId: 'thread', purpose: 'conversation', locale: 'ja-JP',
    durationMs: 1000, audio: encodeWav([new ArrayBuffer(32_000)]), mimeType: 'audio/wav', encoding: 'pcm-s16le-16000-mono',
    recognizedTranscript: 'Original', provider: { provider: 'azure', configurationVersion: 1 }, createdAt: now,
  })
})
afterEach(() => vi.unstubAllGlobals())
it('submits a validated unsent transcript restored from a default audio-free backup', async () => {
  await db.voiceRecordings.update('recording', { submittedTranscript: 'Saved draft edit' })
  const backup = await exportBackup()
  await clearLocalData()
  await importBackup(JSON.parse(JSON.stringify(backup)))
  const restored = (await db.voiceRecordings.get('recording'))!
  expect(restored.audio).toBeUndefined()
  expect(restored.audioUnavailable).toBe(true)
  expect(restored.submittedTranscript).toBe('Saved draft edit')
  await submitVoiceMessage({ ...message, canonicalContent: restored.submittedTranscript! }, 'profile', restored.id)
  expect(await db.conversationMessages.get(message.id)).toMatchObject({
    recordingId: restored.id, recognizedTranscript: 'Original', canonicalContent: 'Saved draft edit',
  })
  expect(await db.voiceRecordings.get(restored.id)).toMatchObject({
    audioUnavailable: true, messageId: message.id, submittedTranscript: 'Saved draft edit',
  })
  await expect(submitVoiceMessage({ ...message, id: 'duplicate' }, 'profile', restored.id)).rejects.toThrow('unsent')
})
it.each(['missing', 'unmarked', 'invalid-metadata', 'wrong-thread', 'practice'] as const)(
  'rejects %s recordings without persisting a message', async kind => {
    const recording = (await db.voiceRecordings.get('recording'))!
    await db.voiceRecordings.delete(recording.id)
    if (kind !== 'missing') await db.voiceRecordings.add({
      ...recording, audio: undefined, audioUnavailable: kind !== 'unmarked',
      durationMs: kind === 'invalid-metadata' ? -1 : 1000,
      threadId: kind === 'wrong-thread' ? 'other-thread' : 'thread',
      purpose: kind === 'practice' ? 'practice' : 'conversation',
    })
    await expect(submitVoiceMessage(message, 'profile', recording.id)).rejects.toThrow('Save this recording')
    expect(await db.conversationMessages.count()).toBe(0)
    expect((await db.voiceRecordings.get(recording.id))?.messageId).toBeUndefined()
  },
)
it('atomically links a recording, rejecting duplicate sends and different profile owners', async () => {
  await expect(submitVoiceMessage(message, 'different-profile', 'recording')).rejects.toThrow('active profile')
  expect(await db.conversationMessages.count()).toBe(0)
  await submitVoiceMessage(message, 'profile', 'recording')
  await expect(submitVoiceMessage({ ...message, id: 'duplicate' }, 'profile', 'recording')).rejects.toThrow('unsent')
  expect(await db.conversationMessages.count()).toBe(1)
  expect((await db.voiceRecordings.get('recording'))?.submittedTranscript).toBe('Edited')
  expect((await db.conversationMessages.get('message'))?.recognizedTranscript).toBe('Original')
})
it('rolls back a recording if its practice reference fails validation', async () => {
  const recording = (await db.voiceRecordings.get('recording'))!
  await expect(saveRecording({ ...recording, id: 'practice', purpose: 'practice' }, {
    id: 'attempt', profileId: 'wrong-profile', threadId: 'thread', recordingId: 'practice',
    referenceText: 'こんにちは', locale: 'ja-JP', provider: recording.provider, createdAt: now,
  })).rejects.toThrow('active profile')
  expect(await db.voiceRecordings.get('practice')).toBeUndefined()
})
it.each(['locale', 'content', 'shape'])('rejects imported voice %s mismatches before replacing stored data', async kind => {
  const backup = await exportBackup()
  const assistant = {
    ...message, role: 'assistant', canonicalContent: kind === 'content' ? 'Different visible text' : 'こんにちは',
    speechSegments: kind === 'shape' ? 'not segments' : [{ text: 'こんにちは', locale: kind === 'locale' ? 'zh-CN' : 'ja-JP' }],
  }
  await expect(importBackup({ ...backup, data: { ...backup.data, conversationMessages: [assistant] } })).rejects.toThrow()
  expect(await db.voiceRecordings.count()).toBe(1)
  expect(await db.conversationMessages.count()).toBe(0)
})
