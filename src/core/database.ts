import Dexie, { type EntityTable } from 'dexie'
import type {
  AIConnection,
  AppSetting,
  ConversationMessage,
  ConversationThread,
  EvidenceEvent,
  LanguageProfile,
  LearningItem,
  LibraryItem,
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
  }
}

export const db = new LangAppDatabase()

export async function clearLocalData(): Promise<void> {
  await db.delete()
  await db.open()
}

interface BackupEnvelope {
  format: 'linguaweave-backup'
  version: 1
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
  }
}

export async function exportBackup(): Promise<BackupEnvelope> {
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
  ] = await Promise.all([
    db.settings.toArray(),
    db.profiles.toArray(),
    db.libraryItems.toArray(),
    db.learningItems.toArray(),
    db.userItemStates.toArray(),
    db.evidenceEvents.toArray(),
    db.conversationThreads.toArray(),
    db.conversationMessages.toArray(),
    db.reviewAttempts.toArray(),
  ])

  return {
    format: 'linguaweave-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      settings,
      profiles,
      libraryItems,
      learningItems,
      userItemStates,
      evidenceEvents,
      conversationThreads,
      conversationMessages,
      reviewAttempts,
    },
  }
}

export async function importBackup(backup: BackupEnvelope): Promise<void> {
  if (backup.format !== 'linguaweave-backup' || backup.version !== 1) {
    throw new Error('This backup format is not supported.')
  }

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
      ])

      await Promise.all([
        db.settings.bulkAdd(backup.data.settings),
        db.profiles.bulkAdd(backup.data.profiles),
        db.libraryItems.bulkAdd(backup.data.libraryItems),
        db.learningItems.bulkAdd(backup.data.learningItems),
        db.userItemStates.bulkAdd(backup.data.userItemStates),
        db.evidenceEvents.bulkAdd(backup.data.evidenceEvents),
        db.conversationThreads.bulkAdd(backup.data.conversationThreads),
        db.conversationMessages.bulkAdd(backup.data.conversationMessages),
        db.reviewAttempts.bulkAdd(backup.data.reviewAttempts ?? []),
      ])
    },
  )
}
