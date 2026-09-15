import { z } from 'zod'
import { db } from '../database'
import type { ConversationMessage, ConversationThread, LanguageProfile } from '../domain'
import type { PronunciationAttempt, VoiceRecording } from './contracts'
import { targetLocales } from './contracts'

export const MAX_RECORDING_BYTES = 44 + 120 * 32_000
export const MAX_BACKUP_AUDIO_BYTES = 128 * 1024 * 1024
const id = z.string().min(1).max(200)
const locale = z.enum(['en-US', 'zh-CN', 'ja-JP', 'ko-KR'])
const provider = z.object({
  provider: z.literal('azure'),
  configurationVersion: z.number().int().nonnegative(),
})
const score = z.number().finite().min(0).max(100).optional()
export const recordingMetadataSchema = z.object({
  id, profileId: id, threadId: id, messageId: id.optional(),
  purpose: z.enum(['conversation', 'practice']),
  locale,
  durationMs: z.number().finite().positive().max(120_000),
  mimeType: z.literal('audio/wav'),
  encoding: z.literal('pcm-s16le-16000-mono'),
  audioUnavailable: z.boolean().optional(),
  recognizedTranscript: z.string().max(128_000),
  submittedTranscript: z.string().max(128_000).optional(),
  transcriptSegments: z.array(z.object({ text: z.string().max(128_000), locale })).max(1_000).optional(),
  provider,
  createdAt: z.string().datetime(),
}).superRefine((value, ctx) => {
  if (value.purpose === 'practice' && value.durationMs > 30_000) {
    ctx.addIssue({ code: 'custom', message: 'Practice recordings are limited to 30 seconds.' })
  }
})
export const attemptSchema = z.object({
  id, profileId: id, threadId: id, recordingId: id,
  referenceText: z.string().min(1).max(5_000).refine((text) => text.trim().length > 0),
  locale, provider,
  result: z.object({
    status: z.enum(['assessed', 'no-speech', 'incomplete']),
    accuracy: score, fluency: score, completeness: score,
    words: z.array(z.object({
      text: z.string().max(1_000),
      accuracy: score,
      errorType: z.string().max(200).optional(),
      phonemes: z.array(z.object({ text: z.string().max(200), accuracy: score })).max(200).optional(),
    })).max(5_000),
  }).optional(),
  error: z.string().max(4_000).optional(),
  createdAt: z.string().datetime(),
})

function invalid(message: string): never {
  throw new Error(`Invalid voice data: ${message}`)
}

export async function readAudioBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(new Error('Unable to read the recording.'))
    reader.readAsArrayBuffer(blob)
  })
}

export async function validateRecording(value: VoiceRecording): Promise<VoiceRecording> {
  const metadata = recordingMetadataSchema.parse(value)
  const audio = value.audio
  if (audio === undefined) {
    if (!metadata.audioUnavailable) invalid('Missing audio must be marked unavailable.')
    return { ...metadata, audioUnavailable: true }
  }
  if (!(audio instanceof Blob) || audio.type !== 'audio/wav' ||
      audio.size < 46 || audio.size > 44 + metadata.durationMs * 32 + 32 ||
      audio.size > (metadata.purpose === 'practice' ? 960_044 : MAX_RECORDING_BYTES)) {
    invalid('Recording must be a bounded mono 16 kHz PCM WAV Blob.')
  }
  const buffer = await readAudioBytes(audio)
  const view = new DataView(buffer)
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(buffer, offset, 4))
  // The shared capture pipeline emits a canonical 44-byte PCM WAV header.
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' ||
      tag(36) !== 'data' || view.getUint32(4, true) !== buffer.byteLength - 8 ||
      view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
      view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16_000 ||
      view.getUint32(28, true) !== 32_000 || view.getUint16(32, true) !== 2 ||
      view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== buffer.byteLength - 44 ||
      (buffer.byteLength - 44) % 2 !== 0 ||
      Math.abs((buffer.byteLength - 44) / 32 - metadata.durationMs) > 1) {
    invalid('WAV encoding, length, or duration does not match the recording.')
  }
  return { ...metadata, audio, audioUnavailable: false }
}

export function validateVoiceReferences(
  profiles: LanguageProfile[],
  threads: ConversationThread[],
  messages: ConversationMessage[],
  recordings: VoiceRecording[],
  attempts: PronunciationAttempt[],
): void {
  const profileIds = new Set(profiles.map((item) => item.id))
  const profileMap = new Map(profiles.map((item) => [item.id, item]))
  const threadMap = new Map(threads.map((item) => [item.id, item]))
  const messageMap = new Map(messages.map((item) => [item.id, item]))
  const recordingMap = new Map(recordings.map((item) => [item.id, item]))
  for (const thread of threads) {
    if (!profileIds.has(thread.profileId)) invalid('Thread has no owning profile.')
  }
  for (const message of messages) {
    if (!threadMap.has(message.threadId)) invalid('Message has no owning thread.')
    if (message.speechSegments) {
      const profile = profileMap.get(threadMap.get(message.threadId)!.profileId)
      if (message.role !== 'assistant' || !profile ||
          message.speechSegments.some(segment => segment.locale !== 'en-US' && segment.locale !== targetLocales[profile.targetLanguage]) ||
          message.canonicalContent !== message.speechSegments.map(segment => segment.text).join(' ')) {
        invalid('Speech segments must match the displayed reply and profile language.')
      }
    }
    if (message.recordingId !== undefined) {
      const recording = recordingMap.get(message.recordingId)
      if (!recording || recording.threadId !== message.threadId ||
          recording.messageId !== message.id || recording.purpose !== 'conversation' ||
          message.role !== 'user') invalid('Message recording ownership does not match.')
    }
  }
  for (const recording of recordings) {
    if (!profileIds.has(recording.profileId) ||
        threadMap.get(recording.threadId)?.profileId !== recording.profileId) {
      invalid('Recording profile/thread ownership does not match.')
    }
    const targetLocale = targetLocales[profileMap.get(recording.profileId)!.targetLanguage]
    if ((recording.locale !== 'en-US' && recording.locale !== targetLocale) ||
        recording.transcriptSegments?.some(segment => segment.locale !== 'en-US' && segment.locale !== targetLocale)) {
      invalid('Recording locale does not match its profile.')
    }
    if (recording.messageId !== undefined) {
      const message = messageMap.get(recording.messageId)
      if (!message || message.threadId !== recording.threadId ||
          (recording.purpose === 'conversation' && message.role !== 'user') ||
          (message.recordingId && recording.purpose === 'conversation' &&
            message.recordingId !== recording.id)) invalid('Recording message ownership does not match.')
    }
  }
  for (const attempt of attempts) {
    const recording = recordingMap.get(attempt.recordingId)
    if (!recording || recording.purpose !== 'practice' ||
        recording.profileId !== attempt.profileId || recording.threadId !== attempt.threadId ||
        recording.locale !== attempt.locale) invalid('Attempt recording ownership does not match.')
  }
}

function quotaError(error: unknown): never {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError') {
    throw new Error('Recording was not saved: device storage is full. Keep this draft open to replay it, delete recordings or free device space, then retry. No earlier recordings were removed.')
  }
  throw error
}

export async function requestVoiceStoragePersistence(): Promise<boolean> {
  try {
    return typeof navigator !== 'undefined' && navigator.storage?.persist
      ? await navigator.storage.persist() : false
  } catch { return false }
}

async function checkAvailableStorage(recording: VoiceRecording): Promise<void> {
  if (!recording.audio || typeof navigator === 'undefined' || !navigator.storage?.estimate) return
  const estimate = await navigator.storage.estimate().catch(() => undefined)
  const previous = await db.voiceRecordings.get(recording.id)
  const additionalBytes = Math.max(0, recording.audio.size - (previous?.audio?.size ?? 0))
  if (estimate?.quota !== undefined && estimate.usage !== undefined &&
      additionalBytes > 0 && additionalBytes > estimate.quota - estimate.usage) {
    quotaError({ name: 'QuotaExceededError' })
  }
}

const voiceTables = () => [
  db.profiles, db.conversationThreads, db.conversationMessages,
  db.voiceRecordings, db.pronunciationAttempts,
]

async function assertOwner(threadId: string, profileId: string): Promise<void> {
  if (!(await db.profiles.get(profileId)) ||
      (await db.conversationThreads.get(threadId))?.profileId !== profileId) {
    invalid('Thread does not belong to the active profile.')
  }
}

export async function saveRecording(recording: VoiceRecording, attempt?: PronunciationAttempt): Promise<void> {
  const value = await validateRecording(recording)
  try {
    await checkAvailableStorage(value)
    await db.transaction('rw', voiceTables(), async () => {
      await assertOwner(value.threadId, value.profileId)
      const previous = await db.voiceRecordings.get(value.id)
      if (previous && (previous.profileId !== value.profileId || previous.threadId !== value.threadId ||
          previous.purpose !== value.purpose || previous.locale !== value.locale ||
          (previous.messageId !== undefined && previous.messageId !== value.messageId))) {
        invalid('Recording ownership cannot be changed.')
      }
      const messages = await db.conversationMessages.where('threadId').equals(value.threadId).toArray()
      validateVoiceReferences(
        [await db.profiles.get(value.profileId) as LanguageProfile],
        [await db.conversationThreads.get(value.threadId) as ConversationThread],
        messages.filter((message) => message.id === value.messageId || message.recordingId === value.id),
        [value], [],
      )
      await db.voiceRecordings.put(value)
      if (attempt) {
        if (attempt.recordingId !== value.id) invalid('Practice recording reference does not match.')
        await saveAttempt(attempt)
      }
    })
  } catch (error) { quotaError(error) }
}

export async function saveAttempt(attempt: PronunciationAttempt): Promise<void> {
  const value = attemptSchema.parse(attempt)
  try {
    await db.transaction('rw', voiceTables(), async () => {
      await assertOwner(value.threadId, value.profileId)
      const recording = await db.voiceRecordings.get(value.recordingId)
      const previous = await db.pronunciationAttempts.get(value.id)
      if (previous && (previous.profileId !== value.profileId || previous.threadId !== value.threadId ||
          previous.recordingId !== value.recordingId || previous.locale !== value.locale ||
          previous.referenceText !== value.referenceText)) invalid('Attempt ownership/reference cannot be changed.')
      if (!recording || recording.purpose !== 'practice' || recording.profileId !== value.profileId ||
          recording.threadId !== value.threadId || recording.locale !== value.locale) {
        invalid('Attempt recording ownership does not match.')
      }
      await db.pronunciationAttempts.put(value)
    })
  } catch (error) { quotaError(error) }
}

async function removeRecording(id: string): Promise<void> {
  await db.pronunciationAttempts.where('recordingId').equals(id).delete()
  await db.conversationMessages.filter((message) => message.recordingId === id)
    .modify((message) => { delete message.recordingId })
  await db.voiceRecordings.delete(id)
}

export async function deleteRecording(id: string, profileId: string): Promise<void> {
  await db.transaction('rw', voiceTables(), async () => {
    const recording = await db.voiceRecordings.get(id)
    if (!recording) return
    if (recording.profileId !== profileId) invalid('Recording does not belong to the active profile.')
    await assertOwner(recording.threadId, profileId)
    await removeRecording(id)
  })
}

async function removeThreadVoiceData(threadId: string, profileId: string): Promise<void> {
  await assertOwner(threadId, profileId)
  const recordings = await db.voiceRecordings.where('threadId').equals(threadId).toArray()
  for (const recording of recordings) {
    if (recording.profileId !== profileId) invalid('Recording ownership does not match.')
    await removeRecording(recording.id)
  }
  await db.pronunciationAttempts.where('threadId').equals(threadId).delete()
}

export async function deleteThreadVoiceData(threadId: string, profileId: string): Promise<void> {
  await db.transaction('rw', voiceTables(), () => removeThreadVoiceData(threadId, profileId))
}

export async function deleteVoiceThread(threadId: string, profileId: string): Promise<void> {
  await db.transaction('rw', voiceTables(), async () => {
    await removeThreadVoiceData(threadId, profileId)
    await db.conversationMessages.where('threadId').equals(threadId).delete()
    await db.conversationThreads.delete(threadId)
  })
}

export async function getVoiceStorageUsage(): Promise<number> {
  const recordings = await db.voiceRecordings.toArray()
  return recordings.reduce((total, recording) => total + (recording.audio?.size ?? 0), 0)
}
