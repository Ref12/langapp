import Dexie, { type EntityTable, type Transaction } from 'dexie'
import { CONTENT_VERSION } from '../../data/mandarin'
import { aiConnectionInputSchema, aiConnectionSchema } from '../assistant/contracts'
import { clearUnsavedDrafts } from '../assistant/drafts'
import { speechConnectionInputSchema, speechConnectionSchema } from '../assistant/speech-contracts'
import { configureDatabaseForProfile, db, LearningDatabase, profileDatabaseName, resetDatabaseForTests } from '../database'
import { createEmptyProfile, parseProfileYaml, serializeProfileYaml } from './codec'
import { PROFILE_FORMAT, PROFILE_VERSION, type ProfileSnapshot } from './contracts'
import { DEFAULT_PROFILE_ID, profileIdSchema, profileMetadataSchema, type ProfileMetadata } from './identity'

export const PROFILE_REGISTRY_DATABASE = 'linguaweave-profile-registry'
export const SELECTED_PROFILE_KEY = 'linguaweave-selected-profile'

interface ProfileRecord extends ProfileMetadata {
  nameKey: string
  state: 'creating' | 'ready'
  localSettingsImported?: boolean
}

class ProfileRegistry extends Dexie {
  profiles!: EntityTable<ProfileRecord, 'id'>

  constructor() {
    super(PROFILE_REGISTRY_DATABASE)
    this.version(1).stores({ profiles: '&id, &nameKey' })
  }
}

export const profileRegistry = new ProfileRegistry()
const registry = profileRegistry
let initialization: Promise<void> | undefined
let activeProfile: ProfileMetadata | undefined

function storage(): Storage {
  try {
    if (typeof window === 'undefined' || !window.localStorage) throw new Error()
    return window.localStorage
  } catch {
    throw new Error('Profile selection requires browser local storage. Enable it and reload.')
  }
}

function readSelectedId(): string {
  let value: string | null
  try { value = storage().getItem(SELECTED_PROFILE_KEY) } catch {
    throw new Error('Profile selection could not be read from browser storage. Enable it and reload.')
  }
  const result = profileIdSchema.safeParse(value ?? DEFAULT_PROFILE_ID)
  if (!result.success) throw new Error('The selected profile is invalid. Reset the selection to open the default profile.')
  return result.data
}

function metadata(id: string, name: string): ProfileMetadata {
  const result = profileMetadataSchema.safeParse({ id, name })
  if (!result.success) throw new Error('Use a profile name between 1 and 80 characters.')
  return result.data
}

function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase()
}

export function initializeProfiles(): Promise<void> {
  if (initialization) return initialization
  initialization = (async () => {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      throw new Error('Profiles require browser IndexedDB storage. Enable it and reload.')
    }
    // Capture once for this page: a different tab must never redirect running callbacks.
    const selectedId = readSelectedId()
    await registry.open()
    await registry.transaction('rw', registry.profiles, async () => {
      if (!await registry.profiles.get(DEFAULT_PROFILE_ID)) {
        await registry.profiles.add({
          id: DEFAULT_PROFILE_ID, name: 'default', nameKey: 'default', state: 'ready', localSettingsImported: false,
        })
      }
    })
    const selected = await registry.profiles.get(selectedId)
    if (!selected || selected.state !== 'ready') {
      throw new Error('The selected profile is unavailable. Reset the selection to open the default profile.')
    }
    if (selected.id !== DEFAULT_PROFILE_ID && !await Dexie.exists(profileDatabaseName(selected.id))) {
      throw new Error('The selected profile database is unavailable. Reset the selection to open the default profile.')
    }
    configureDatabaseForProfile(selected.id)
    activeProfile = metadata(selected.id, selected.name)
  })().catch(error => {
    initialization = undefined
    throw error
  })
  return initialization
}

export function getActiveProfile(): ProfileMetadata {
  if (!activeProfile) throw new Error('Profiles have not been initialized. Reload to try again.')
  return { ...activeProfile }
}

export async function listProfiles(): Promise<ProfileMetadata[]> {
  await initializeProfiles()
  const records = await registry.profiles.toArray()
  return records.filter(record => record.state === 'ready')
    .map(record => metadata(record.id, record.name))
    .sort((a, b) => a.id === DEFAULT_PROFILE_ID ? -1 : b.id === DEFAULT_PROFILE_ID ? 1 : a.name.localeCompare(b.name))
}

export async function selectProfile(id: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await initializeProfiles()
  const parsed = profileIdSchema.safeParse(id)
  if (!parsed.success) throw new Error('Choose a valid profile.')
  const profile = await registry.profiles.get(parsed.data)
  if (!profile || profile.state !== 'ready') throw new Error('The selected profile is unavailable.')
  signal?.throwIfAborted()
  try { storage().setItem(SELECTED_PROFILE_KEY, profile.id) } catch {
    throw new Error('The selected profile could not be saved. Enable browser local storage and try again.')
  }
}

export function resetSelectedProfile(): void {
  try { storage().removeItem(SELECTED_PROFILE_KEY) } catch {
    throw new Error('The profile selection could not be reset. Enable browser local storage and try again.')
  }
}

export function resetProfilesForTests(): void {
  if (import.meta.env?.MODE !== 'test') throw new Error('Profile reset is only available in tests.')
  registry.close()
  initialization = undefined
  activeProfile = undefined
  resetDatabaseForTests()
}

export async function needsLocalSettingsImport(): Promise<boolean> {
  await initializeProfiles()
  const profile = await registry.profiles.get(getActiveProfile().id)
  if (!profile || profile.state !== 'ready') throw new Error('The active profile metadata is unavailable. Reload to try again.')
  // A restore marks the workspace in its own transaction, even if its registry bootstrap was still pending.
  return !profile.localSettingsImported && !(await db.profileState.get('local-settings'))?.imported
}

export async function markLocalSettingsImported(): Promise<void> {
  await initializeProfiles()
  const updated = await registry.profiles.update(getActiveProfile().id, { localSettingsImported: true })
  if (!updated) throw new Error('The local settings import could not be recorded. Reload to try again.')
}

async function readSnapshot(database: LearningDatabase, profile: ProfileMetadata): Promise<ProfileSnapshot> {
  return database.transaction('r', database.tables, async () => {
    const preferences = await database.preferences.get('workspace')
    if (!preferences) throw new Error('Your workspace has not been initialized. Reload to try again.')
    const ai = await database.aiConnections.get('assistant')
    const speech = await database.speechConnections.get('assistant-speech')
    let aiConnection: ProfileSnapshot['settings']['aiConnection']
    let speechConnection: ProfileSnapshot['settings']['speechConnection']
    if (ai) {
      const parsed = aiConnectionSchema.safeParse(ai)
      if (!parsed.success) throw new Error('Saved AI connection settings are invalid. Review them before exporting.')
      aiConnection = aiConnectionInputSchema.strip().parse(parsed.data)
    }
    if (speech) {
      const parsed = speechConnectionSchema.safeParse(speech)
      if (!parsed.success) throw new Error('Saved speech connection settings are invalid. Review them before exporting.')
      speechConnection = speechConnectionInputSchema.strip().parse(parsed.data)
    }
    return {
      format: PROFILE_FORMAT, version: PROFILE_VERSION, contentVersion: CONTENT_VERSION, exportedAt: Date.now(), profile,
      settings: { preferences, ...(aiConnection ? { aiConnection } : {}), ...(speechConnection ? { speechConnection } : {}) },
      knowledge: {
        words: await database.words.toArray(), readings: await database.readings.toArray(),
        lessons: await database.lessons.toArray(), sessions: await database.sessions.toArray(),
        attempts: await database.attempts.toArray(),
        characterStates: await database.characterStates.toArray(),
        study: {
          knowledge: await database.knowledge.toArray(), cards: await database.studyCards.toArray(),
          sessions: await database.exerciseSessions.toArray(), attempts: await database.exerciseAttempts.toArray(),
        },
      },
      conversations: {
        threads: await database.assistantThreads.toArray(), messages: await database.assistantMessages.toArray(),
        runs: await database.assistantRuns.toArray(),
      },
      library: await database.libraryBooks.toArray(),
    }
  })
}

async function writeSnapshot(database: LearningDatabase, snapshot: ProfileSnapshot, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const { settings, knowledge, conversations } = snapshot
  const ai = settings.aiConnection && aiConnectionSchema.parse({
    ...settings.aiConnection, id: 'assistant', revision: crypto.randomUUID(), updatedAt: Date.now(),
  })
  const speech = settings.speechConnection && speechConnectionSchema.parse({
    ...settings.speechConnection, id: 'assistant-speech', revision: crypto.randomUUID(), updatedAt: Date.now(),
  })
  let transaction: Transaction | undefined
  const abort = () => transaction?.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await database.transaction('rw', database.tables, async () => {
      transaction = Dexie.currentTransaction!
      signal?.throwIfAborted()
      for (const table of database.tables) await table.clear()
      await database.preferences.add(settings.preferences)
      if (ai) await database.aiConnections.add(ai)
      if (speech) await database.speechConnections.add(speech)
      await database.words.bulkAdd(knowledge.words)
      await database.readings.bulkAdd(knowledge.readings)
      await database.lessons.bulkAdd(knowledge.lessons)
      await database.sessions.bulkAdd(knowledge.sessions)
      await database.attempts.bulkAdd(knowledge.attempts)
      await database.characterStates.bulkAdd(knowledge.characterStates)
      await database.libraryBooks.bulkAdd(snapshot.library.map(book => ({ ...book, revision: crypto.randomUUID() })))
      await database.knowledge.bulkAdd(knowledge.study.knowledge)
      await database.studyCards.bulkAdd(knowledge.study.cards)
      await database.exerciseSessions.bulkAdd(knowledge.study.sessions)
      await database.exerciseAttempts.bulkAdd(knowledge.study.attempts)
      await database.assistantThreads.bulkAdd(conversations.threads)
      await database.assistantMessages.bulkAdd(conversations.messages)
      await database.assistantRuns.bulkAdd(conversations.runs)
      await database.profileState.put({ id: 'local-settings', imported: true })
      signal?.throwIfAborted()
    })
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

export async function exportActiveProfile(): Promise<string> {
  await initializeProfiles()
  return serializeProfileYaml(await readSnapshot(db, getActiveProfile()))
}

export async function restoreActiveProfile(text: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const snapshot = parseProfileYaml(text)
  await initializeProfiles()
  snapshot.profile = getActiveProfile()
  await writeSnapshot(db, snapshot, signal)
  clearUnsavedDrafts()
}

async function addProfile(snapshot: ProfileSnapshot): Promise<ProfileMetadata> {
  const profile = snapshot.profile
  const record: ProfileRecord = { ...profile, nameKey: nameKey(profile.name), state: 'creating', localSettingsImported: true }
  try {
    await registry.profiles.add(record)
  } catch (error) {
    if (error instanceof Error && error.name === 'ConstraintError') {
      throw new Error('A profile with that name already exists. Choose another name.')
    }
    throw error
  }
  const database = new LearningDatabase(profileDatabaseName(profile.id))
  let ownsDatabase = false
  try {
    if (await Dexie.exists(database.name)) throw new Error('A database already exists for this profile. Try creating another profile.')
    ownsDatabase = true
    await writeSnapshot(database, snapshot)
    await registry.profiles.update(profile.id, { state: 'ready' })
    return { ...profile }
  } catch (error) {
    try {
      if (ownsDatabase) await database.delete()
      await registry.profiles.delete(profile.id)
    } catch {
      throw new Error('Profile creation failed and cleanup could not finish. Reload before trying again.')
    }
    throw error
  } finally {
    database.close()
  }
}

export async function createProfile(name: string, cloneCurrent: boolean): Promise<ProfileMetadata> {
  await initializeProfiles()
  const profile = metadata(crypto.randomUUID(), name)
  const snapshot = cloneCurrent
    ? parseProfileYaml(await exportActiveProfile())
    : createEmptyProfile(profile)
  snapshot.profile = profile
  return addProfile(snapshot)
}

export async function importNewProfile(text: string, name: string): Promise<ProfileMetadata> {
  const snapshot = parseProfileYaml(text)
  await initializeProfiles()
  snapshot.profile = metadata(crypto.randomUUID(), name)
  return addProfile(snapshot)
}
