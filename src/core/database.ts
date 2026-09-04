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
  ] = await Promise.all([
    db.settings.toArray(),
    db.profiles.toArray(),
    db.libraryItems.toArray(),
    db.learningItems.toArray(),
    db.userItemStates.toArray(),
    db.evidenceEvents.toArray(),
    db.conversationThreads.toArray(),
    db.conversationMessages.toArray(),
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
      ])
    },
  )
}
