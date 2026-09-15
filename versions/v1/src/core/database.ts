import Dexie, { type EntityTable } from 'dexie'
import { z } from 'zod'
import type { PronunciationAttempt, SpeechConnection, VoiceRecording } from './voice/contracts'
import {
  attemptSchema, MAX_BACKUP_AUDIO_BYTES, MAX_RECORDING_BYTES, readAudioBytes,
  recordingMetadataSchema, validateRecording, validateVoiceReferences,
} from './voice/storage'
import type {
  AIConnection,
  AppSetting,
  ConversationMessage,
  ConversationThread,
  EvidenceEvent,
  LanguageProfile,
  LearningItem,
  LibraryItem,
  ReadingBookmark,
  ReadingProgress,
  ReviewAttempt,
  UserItemState,
} from './domain'

class LangAppDatabase extends Dexie {
  settings!: EntityTable<AppSetting, 'key'>
  profiles!: EntityTable<LanguageProfile, 'id'>
  libraryItems!: EntityTable<LibraryItem, 'id'>
  learningItems!: EntityTable<LearningItem, 'id'>
  userItemStates!: EntityTable<UserItemState, 'id'>
  evidenceEvents!: EntityTable<EvidenceEvent, 'id'>
  aiConnections!: EntityTable<AIConnection, 'id'>
  conversationThreads!: EntityTable<ConversationThread, 'id'>
  conversationMessages!: EntityTable<ConversationMessage, 'id'>
  reviewAttempts!: EntityTable<ReviewAttempt, 'id'>
  readingProgress!: EntityTable<ReadingProgress, 'id'>
  readingBookmarks!: EntityTable<ReadingBookmark, 'id'>
  speechConnections!: EntityTable<SpeechConnection, 'id'>
  voiceRecordings!: EntityTable<VoiceRecording, 'id'>
  pronunciationAttempts!: EntityTable<PronunciationAttempt, 'id'>

  constructor() {
    super('linguaweave')

    this.version(1).stores({
      settings: '&key',
      profiles: '&id, targetLanguage, createdAt',
      libraryItems: '&id, profileId, createdAt, updatedAt',
      learningItems: '&id, targetLanguage, sourceText',
      userItemStates: '&id, profileId, itemId, tier, updatedAt',
      evidenceEvents: '&id, profileId, itemId, sourceModuleId, createdAt',
      aiConnections: '&id',
      conversationThreads: '&id, profileId, updatedAt',
      conversationMessages: '&id, threadId, createdAt, status',
    })

    this.version(2).stores({
      reviewAttempts: '&id, profileId, itemId, activity, createdAt',
    })

    this.version(3)
      .stores({})
      .upgrade((transaction) =>
        transaction
          .table<LibraryItem>('libraryItems')
          .toCollection()
          .modify((item) => {
            if (!item.chapters?.length) {
              item.chapters = [
                {
                  id: `${item.id}_chapter_1`,
                  title: 'Full text',
                  content: item.content,
                  annotations: item.annotations ?? [],
                  analysisStatus: item.analysisStatus ?? 'not-analyzed',
                  analysisError: item.analysisError,
                },
              ]
            }
          }),
      )

    this.version(4).stores({
      readingProgress: '&id, profileId, documentId, chapterId, updatedAt',
      readingBookmarks:
        '&id, profileId, documentId, chapterId, createdAt',
    })

    this.version(5)
      .stores({})
      .upgrade((transaction) =>
        transaction
          .table<LibraryItem>('libraryItems')
          .toCollection()
          .modify((item) => {
            for (const chapter of item.chapters ?? []) {
              if (
                chapter.analysisStatus === 'failed' &&
                chapter.content.length <= 128_000 &&
                chapter.analysisError?.includes('"maximum": 20000')
              ) {
                chapter.analysisStatus = 'not-analyzed'
                chapter.analysisError = ''
              }
            }
            const failedChapter = item.chapters?.find(
              (chapter) => chapter.analysisStatus === 'failed',
            )
            item.analysisStatus = failedChapter
              ? 'failed'
              : item.chapters?.every(
                    (chapter) => chapter.analysisStatus === 'ready',
                  )
                ? 'ready'
                : 'not-analyzed'
            item.analysisError = failedChapter?.analysisError ?? ''
          }),
      )

    this.version(6).stores({
      speechConnections: '&id',
      voiceRecordings: '&id, profileId, threadId, messageId, purpose, createdAt',
      pronunciationAttempts: '&id, profileId, threadId, recordingId, createdAt',
    })
  }
}

export const db = new LangAppDatabase()

export async function clearLocalData(): Promise<void> {
  await db.delete()
  await db.open()
}

interface BackupRecording extends Omit<VoiceRecording, 'audio'> {
  audio?: { version: 1; encoding: 'base64'; byteLength: number; data: string }
}

interface BackupEnvelope {
  format: 'linguaweave-backup'
  version: 1 | 2
  exportedAt: string
  data: {
    settings: AppSetting[]
    profiles: LanguageProfile[]
    libraryItems: LibraryItem[]
    learningItems: LearningItem[]
    userItemStates: UserItemState[]
    evidenceEvents: EvidenceEvent[]
    conversationThreads: ConversationThread[]
    conversationMessages: ConversationMessage[]
    reviewAttempts: ReviewAttempt[]
    readingProgress: ReadingProgress[]
    readingBookmarks: ReadingBookmark[]
    voiceRecordings?: BackupRecording[]
    pronunciationAttempts?: PronunciationAttempt[]
  }
}

function safeSettings(
  settings: AppSetting[], profiles: LanguageProfile[], libraryItems: LibraryItem[],
): AppSetting[] {
  // Only real preference keys with valid reference values may cross the backup boundary.
  const profileIds = new Set(profiles.map((profile) => profile.id))
  return settings.filter((setting) =>
    (setting.key === 'activeProfileId' && profileIds.has(setting.value)) ||
    libraryItems.some((item) =>
      setting.key === `lastReadingDocument:${item.profileId}` &&
      profileIds.has(item.profileId) && setting.value === item.id),
  ).map(({ key, value }) => ({ key, value }))
}

async function encodeRecording(recording: VoiceRecording, includeAudio: boolean): Promise<BackupRecording> {
  const metadata = recordingMetadataSchema.parse(recording)
  if (!includeAudio || !recording.audio) return { ...metadata, audioUnavailable: true }
  const validated = await validateRecording(recording)
  const bytes = new Uint8Array(await readAudioBytes(validated.audio!))
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return {
    ...metadata, audioUnavailable: false,
    audio: { version: 1, encoding: 'base64', byteLength: bytes.length, data: btoa(binary) },
  }
}

export async function exportBackup(includeRecordings = false): Promise<BackupEnvelope> {
  const [
    settings,
    profiles,
    libraryItems,
    learningItems,
    userItemStates,
    evidenceEvents,
    conversationThreads,
    conversationMessages,
    reviewAttempts,
    readingProgress,
    readingBookmarks,
    voiceRecordings,
    pronunciationAttempts,
  ] = await db.transaction('r', [
    db.settings, db.profiles, db.libraryItems, db.learningItems, db.userItemStates,
    db.evidenceEvents, db.conversationThreads, db.conversationMessages, db.reviewAttempts,
    db.readingProgress, db.readingBookmarks, db.voiceRecordings, db.pronunciationAttempts,
  ], () => Promise.all([
    db.settings.toArray(),
    db.profiles.toArray(),
    db.libraryItems.toArray(),
    db.learningItems.toArray(),
    db.userItemStates.toArray(),
    db.evidenceEvents.toArray(),
    db.conversationThreads.toArray(),
    db.conversationMessages.toArray(),
    db.reviewAttempts.toArray(),
    db.readingProgress.toArray(),
    db.readingBookmarks.toArray(),
    db.voiceRecordings.toArray(),
    db.pronunciationAttempts.toArray(),
  ]))
  if (includeRecordings && voiceRecordings.reduce((total, item) => total + (item.audio?.size ?? 0), 0) >
      MAX_BACKUP_AUDIO_BYTES) {
    throw new Error('Audio backup exceeds the 128 MiB limit. Export without recordings or delete recordings explicitly.')
  }
  const serializedRecordings: BackupRecording[] = []
  for (const recording of voiceRecordings) {
    serializedRecordings.push(await encodeRecording(recording, includeRecordings))
  }

  return {
    format: 'linguaweave-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    data: {
      settings: safeSettings(settings, profiles, libraryItems),
      profiles,
      libraryItems,
      learningItems,
      userItemStates,
      evidenceEvents,
      conversationThreads,
      conversationMessages,
      reviewAttempts,
      readingProgress,
      readingBookmarks,
      voiceRecordings: serializedRecordings,
      pronunciationAttempts: pronunciationAttempts.map((attempt) => attemptSchema.parse(attempt)),
    },
  }
}

const identifiedRows = z.array(z.object({ id: z.string().min(1) }).passthrough())
const conversationThreadRows = z.array(z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  mode: z.enum(['text', 'voice']).optional(),
}).passthrough())
const conversationMessageRows = z.array(z.object({
  id: z.string().min(1), threadId: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  canonicalContent: z.string(),
  status: z.enum(['pending', 'completed', 'failed']),
  recordingId: z.string().min(1).optional(),
  recognizedTranscript: z.string().max(128_000).optional(),
  speechSegments: z.array(z.object({
    text: z.string().trim().min(1).max(2_000),
    locale: z.enum(['en-US', 'zh-CN', 'ja-JP', 'ko-KR']),
  })).min(1).max(12).optional(),
  playbackStatus: z.enum(['playing', 'completed', 'interrupted', 'failed']).optional(),
  cancelled: z.boolean().optional(),
}).passthrough())
const backupSchema = () => z.object({
  format: z.literal('linguaweave-backup'),
  version: z.union([z.literal(1), z.literal(2)]),
  data: z.object({
    settings: z.array(z.object({ key: z.string(), value: z.string() })),
    profiles: identifiedRows,
    libraryItems: identifiedRows,
    learningItems: identifiedRows,
    userItemStates: identifiedRows,
    evidenceEvents: identifiedRows,
    conversationThreads: conversationThreadRows,
    conversationMessages: conversationMessageRows,
    reviewAttempts: identifiedRows.default([]),
    readingProgress: identifiedRows.default([]),
    readingBookmarks: identifiedRows.default([]),
    voiceRecordings: z.array(z.unknown()).max(100_000).default([]),
    pronunciationAttempts: z.array(attemptSchema).max(100_000).default([]),
  }),
})
const encodedAudioSchema = () => z.object({
  version: z.literal(1),
  encoding: z.literal('base64'),
  byteLength: z.number().int().min(46).max(MAX_RECORDING_BYTES),
  data: z.string().max(4 * Math.ceil(MAX_RECORDING_BYTES / 3)),
})

async function decodeRecording(value: unknown): Promise<VoiceRecording> {
  const metadata = recordingMetadataSchema.parse(value)
  const audioValue = (value as { audio?: unknown }).audio
  if (audioValue === undefined) {
    return validateRecording({ ...metadata, audioUnavailable: true })
  }
  const audio = encodedAudioSchema().parse(audioValue)
  if (audio.data.length !== 4 * Math.ceil(audio.byteLength / 3) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(audio.data)) {
    throw new Error('Invalid recording base64 length or encoding.')
  }
  const binary = atob(audio.data)
  if (binary.length !== audio.byteLength || btoa(binary) !== audio.data) {
    throw new Error('Invalid recording byte length.')
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return validateRecording({ ...metadata, audio: new Blob([bytes], { type: 'audio/wav' }) })
}

export async function importBackup(input: unknown): Promise<void> {
  const parsed = backupSchema().parse(input)
  const data = parsed.data as unknown as BackupEnvelope['data']
  const voiceRecordings: VoiceRecording[] = []
  let totalAudioBytes = 0
  if (parsed.version === 2) {
    // Decode and inspect every bounded WAV before opening the restoring transaction.
    for (const recording of parsed.data.voiceRecordings) {
      const encoded = (recording as { audio?: unknown } | null)?.audio
      if (encoded !== undefined) {
        totalAudioBytes += encodedAudioSchema().parse(encoded).byteLength
        if (totalAudioBytes > MAX_BACKUP_AUDIO_BYTES) throw new Error('Audio backup exceeds the 128 MiB limit.')
      }
      voiceRecordings.push(await decodeRecording(recording))
    }
  }
  const pronunciationAttempts = parsed.version === 2 ? parsed.data.pronunciationAttempts : []
  for (const rows of [...Object.values(data).filter(Array.isArray), voiceRecordings, pronunciationAttempts]) {
    const keys = rows.map((row) => 'id' in row ? row.id : row.key)
    if (new Set(keys).size !== keys.length) throw new Error('Backup contains duplicate record identifiers.')
  }
  validateVoiceReferences(data.profiles, data.conversationThreads, data.conversationMessages,
    voiceRecordings, pronunciationAttempts)

  await db.transaction(
    'rw',
    [
      db.settings,
      db.profiles,
      db.libraryItems,
      db.learningItems,
      db.userItemStates,
      db.evidenceEvents,
      db.conversationThreads,
      db.conversationMessages,
      db.reviewAttempts,
      db.readingProgress,
      db.readingBookmarks,
      db.voiceRecordings,
      db.pronunciationAttempts,
    ],
    async () => {
      await Promise.all([
        db.settings.clear(),
        db.profiles.clear(),
        db.libraryItems.clear(),
        db.learningItems.clear(),
        db.userItemStates.clear(),
        db.evidenceEvents.clear(),
        db.conversationThreads.clear(),
        db.conversationMessages.clear(),
        db.reviewAttempts.clear(),
        db.readingProgress.clear(),
        db.readingBookmarks.clear(),
        db.voiceRecordings.clear(),
        db.pronunciationAttempts.clear(),
      ])

      await Promise.all([
        db.settings.bulkAdd(safeSettings(data.settings, data.profiles, data.libraryItems)),
        db.profiles.bulkAdd(data.profiles),
        db.libraryItems.bulkAdd(data.libraryItems),
        db.learningItems.bulkAdd(data.learningItems),
        db.userItemStates.bulkAdd(data.userItemStates),
        db.evidenceEvents.bulkAdd(data.evidenceEvents),
        db.conversationThreads.bulkAdd(data.conversationThreads),
        db.conversationMessages.bulkAdd(data.conversationMessages),
        db.reviewAttempts.bulkAdd(data.reviewAttempts),
        db.readingProgress.bulkAdd(data.readingProgress),
        db.readingBookmarks.bulkAdd(data.readingBookmarks),
        db.voiceRecordings.bulkAdd(voiceRecordings),
        db.pronunciationAttempts.bulkAdd(pronunciationAttempts),
      ])
    },
  )
}
