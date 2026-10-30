import { parse, stringify } from 'yaml'
import { CONTENT_VERSION } from '../../data/content-version'
import { createEmptyProfile, parseProfileYaml, serializeProfileYaml } from '../profiles/codec'
import type { ProfileSnapshot } from '../profiles/contracts'
import type { ProfileMetadata } from '../profiles/identity'
import { isSourceEntryFile, loadBackupV2, sourceEntryFiles } from './layout'
import { joinCollections, splitCollections } from '../collections/snapshot'
import type { CollectionsBackup } from '../collections/contracts'
import { parseJournal, replay, replayFrom, serializeJournal, toSegments, type JournalEvent } from './journal'

// File layout inside profiles/<profile-id>/ (every file is YAML):
//   profile.yaml      id and name
//   settings.yaml     preferences, AI endpoints, speech connection, backup connection (replaced on change)
//   checkpoint.yaml   snapshot of learning data plus the journal position it covers
//   knowledge.yaml    readable view of the knowledge set, regenerated; never a source of truth
//   journal/YYYY-MM.yaml  append-only events
//   conversations/<thread>.yaml, conversations/practice-history.yaml, library/<book>.yaml

export const CHECKPOINT_FORMAT = 'linguaweave-checkpoint'
export const SETTINGS_FORMAT = 'linguaweave-settings'

export interface BackupConnection { owner: string; repo: string; branch: string; token: string }

const dump = (value: unknown) => stringify(value, { aliasDuplicateObjects: false, lineWidth: 0 })
const safeName = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_')
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function knowledgeView(snapshot: ProfileSnapshot): string {
  const study = snapshot.knowledge.study
  const cards = new Map(study.cards.map(card => [card.ref, card]))
  const lines = [...study.knowledge].sort((a, b) => a.addedAt - b.addedAt || a.ref.localeCompare(b.ref)).map(entry => {
    const card = cards.get(entry.ref)
    const item = {
      ref: entry.ref, band: Number(entry.band), added: day(entry.addedAt), standing: card ? card.state : 'new',
      ...(card && card.state !== 'new' ? { due: day(card.due), reps: card.reps, lapses: card.lapses } : {}),
    }
    return '- ' + stringify(item, { collectionStyle: 'flow', lineWidth: 0 }).trim() + '\n'
  })
  return '# Readable view regenerated from the journal and database. Not a source of truth.\n' + lines.join('')
}

export function buildBackupFiles(snapshot: ProfileSnapshot, journal: JournalEvent[], connection?: BackupConnection): Map<string, string> {
  const files = new Map<string, string>()
  const whole = parse(serializeProfileYaml(snapshot)) as Record<string, unknown> & {
    conversations: { threads: { id: string }[]; messages: { threadId: string }[]; runs: { threadId: string }[]; practiceHistory?: unknown[] }
    library: { id: string }[]
    media: { id: string }[]
    sourceEntries: ProfileSnapshot['sourceEntries']
    collections: CollectionsBackup
  }
  const { conversations, library, media, collections, sourceEntries, ...rest } = whole
  files.set('profile.yaml', dump({ id: snapshot.profile.id, name: snapshot.profile.name }))
  files.set('settings.yaml', dump({ format: SETTINGS_FORMAT, version: 1, settings: snapshot.settings, ...(connection ? { backup: connection } : {}) }))
  // exportedAt changes on every read; keep it out so an unchanged profile produces identical bytes.
  files.set('checkpoint.yaml', dump({ format: CHECKPOINT_FORMAT, version: 1, journal: { position: journal.length }, profile: { ...rest, exportedAt: 0 } }))
  files.set('knowledge.yaml', knowledgeView(snapshot))
  for (const thread of conversations.threads) {
    files.set(`conversations/${safeName(thread.id)}.yaml`, dump({
      thread, messages: conversations.messages.filter(message => message.threadId === thread.id),
      runs: conversations.runs.filter(run => run.threadId === thread.id),
    }))
  }
  if (conversations.practiceHistory?.length) files.set('conversations/practice-history.yaml', dump({ practiceHistory: conversations.practiceHistory }))
  for (const book of library) files.set(`library/${safeName(book.id)}.yaml`, dump(book))
  for (const item of media) files.set(`media/${safeName(item.id)}.yaml`, dump(item))
  for (const [path, text] of sourceEntryFiles(sourceEntries ?? [])) files.set(path, text)
  for (const part of splitCollections(collections)) files.set(`collections/${safeName(part.id)}.yaml`, dump(part.value))
  for (const [name, events] of toSegments(journal)) files.set(name, serializeJournal(events))
  return files
}

export interface LoadedBackup {
  snapshot: ProfileSnapshot
  journal: JournalEvent[]
  /** 'checkpoint' restored a checkpoint plus the journal tail; 'journal' rebuilt from the whole journal. */
  mode: 'checkpoint' | 'journal'
  tailEvents: number
  backup?: BackupConnection
  profile: Partial<ProfileMetadata>
}

function readJournal(files: Map<string, string>): JournalEvent[] {
  return [...files.keys()].filter(path => /^journal\/\d{4}-\d{2}\.yaml$/.test(path)).sort()
    .flatMap(path => parseJournal(files.get(path)!))
}

function required(files: Map<string, string>, path: string): string {
  const text = files.get(path)
  if (text === undefined) throw new Error(`The backup has no ${path}.`)
  return text
}

/** Reads a backup file set into a snapshot: latest checkpoint plus journal tail, or the whole journal when the checkpoint cannot be read. */
export function loadBackup(files: Map<string, string>, profileFallback: ProfileMetadata): LoadedBackup {
  if (files.has('manifest.yaml')) return loadBackupV2(files, profileFallback)
  const journal = readJournal(files)
  const settingsFile = parse(required(files, 'settings.yaml')) as { settings: ProfileSnapshot['settings']; backup?: BackupConnection }
  const meta = files.has('profile.yaml') ? parse(files.get('profile.yaml')!) as Partial<ProfileMetadata> : {}
  const conversations = { threads: [] as unknown[], messages: [] as unknown[], runs: [] as unknown[], practiceHistory: [] as unknown[] }
  const library: unknown[] = []
  const media: unknown[] = []
  const sourceEntries: unknown[] = []
  const collectionParts: CollectionsBackup[] = []
  for (const [path, text] of files) {
    if (path === 'conversations/practice-history.yaml') conversations.practiceHistory.push(...(parse(text) as { practiceHistory: unknown[] }).practiceHistory)
    else if (path.startsWith('conversations/')) {
      const item = parse(text) as { thread: unknown; messages: unknown[]; runs: unknown[] }
      conversations.threads.push(item.thread); conversations.messages.push(...item.messages); conversations.runs.push(...item.runs)
    } else if (path.startsWith('library/')) library.push(parse(text))
    else if (path.startsWith('media/')) media.push(parse(text))
    else if (isSourceEntryFile(path)) sourceEntries.push(...(parse(text) as { entries: unknown[] }).entries)
    else if (path.startsWith('collections/')) collectionParts.push(parse(text) as CollectionsBackup)
  }
  const collections = joinCollections(collectionParts)
  const rest = { ...conversations, ...(conversations.practiceHistory.length ? {} : { practiceHistory: undefined }) }

  let snapshot: ProfileSnapshot | undefined
  let tailEvents = 0
  try {
    const checkpoint = parse(required(files, 'checkpoint.yaml')) as { format: string; version: number; journal: { position: number }; profile: Record<string, unknown> }
    if (checkpoint.format !== CHECKPOINT_FORMAT || checkpoint.version !== 1 || !Number.isInteger(checkpoint.journal?.position)) throw new Error('Unsupported checkpoint.')
    const base = parseProfileYaml(dump({ ...checkpoint.profile, contentVersion: CONTENT_VERSION, conversations: rest, library, media, sourceEntries, collections }))
    const tail = journal.slice(checkpoint.journal.position)
    const state = replay(tail, replayFrom({
      knowledge: base.knowledge.study.knowledge, cards: base.knowledge.study.cards,
      attempts: base.knowledge.study.attempts, characters: base.knowledge.characterStates,
    }))
    snapshot = { ...base, settings: settingsFile.settings, knowledge: { ...base.knowledge,
      characterStates: [...state.characters.values()],
      study: { ...base.knowledge.study, knowledge: [...state.knowledge.values()], cards: [...state.cards.values()], attempts: [...state.exerciseAttempts.values()] } } }
    tailEvents = tail.length
  } catch {
    snapshot = undefined // Format changed or file damaged: rebuild from the journal below.
  }
  let mode: LoadedBackup['mode'] = 'checkpoint'
  if (!snapshot) {
    mode = 'journal'
    const empty = createEmptyProfile({ id: meta.id ?? profileFallback.id, name: meta.name ?? profileFallback.name })
    const state = replay(journal)
    snapshot = { ...empty, settings: settingsFile.settings, knowledge: { ...empty.knowledge,
      characterStates: [...state.characters.values()],
      study: { ...empty.knowledge.study, knowledge: [...state.knowledge.values()], cards: [...state.cards.values()], attempts: [...state.exerciseAttempts.values()] } },
    conversations: { threads: [], messages: [], runs: [] } }
    // Conversations and library files are independent of the checkpoint, so they still apply.
    snapshot = parseProfileYaml(dump({ ...(parse(serializeProfileYaml(snapshot)) as object), conversations: rest, library, media, sourceEntries, collections }))
    tailEvents = journal.length
  }
  return { snapshot: parseProfileYaml(serializeProfileYaml(snapshot)), journal, mode, tailEvents, ...(settingsFile.backup ? { backup: settingsFile.backup } : {}), profile: meta }
}
