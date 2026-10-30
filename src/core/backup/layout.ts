import { parse, stringify } from 'yaml'
import { CONTENT_VERSION } from '../../data/content-version'
import { parseProfileYaml } from '../profiles/codec'
import { PROFILE_FORMAT, PROFILE_VERSION, type ProfileSnapshot } from '../profiles/contracts'
import type { ProfileMetadata } from '../profiles/identity'
import { toProfileYaml } from '../profiles/vocabulary'
import { joinCollections, splitCollections } from '../collections/snapshot'
import type { CollectionsBackup } from '../collections/contracts'
import type { CharacterState } from '../characters/contracts'
import type { ExerciseAttempt, KnowledgeEntry, StudyCard } from '../study/contracts'
import { eventLine, parseJournal, replay, replayFrom, type JournalEvent } from './journal'
import type { LoadedBackup } from './files'
import type { SourceEntry } from '../media/contracts'

const SOURCE_ENTRY_CHUNK = 500
/** Source entries are many and small: stored in files of up to 500, ordered by id so unchanged chunks stay byte-identical. */
export function sourceEntryFiles(entries: readonly SourceEntry[]): [string, string][] {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id))
  const out: [string, string][] = []
  for (let from = 0; from < sorted.length; from += SOURCE_ENTRY_CHUNK) {
    out.push([`source-entries/${String(from / SOURCE_ENTRY_CHUNK).padStart(4, '0')}.yaml`, stringify({ entries: sorted.slice(from, from + SOURCE_ENTRY_CHUNK) }, { aliasDuplicateObjects: false, lineWidth: 0 })])
  }
  return out
}
export const isSourceEntryFile = (path: string) => path.startsWith('source-entries/')

// Version 2 layout inside profiles/<profile-id>/ (every file is YAML):
//   manifest.yaml                    cursor (last journal seq covered), the snapshot's cursor and the segments after it
//   journal/<from>-<to>.yaml         immutable log segments (journal sequence numbers, inclusive), written once
//   state/snapshot.yaml              knowledge, cards, exercise answers and characters at the snapshot cursor, written occasionally
//   state/state.yaml                 what the log does not carry: words, readings, lessons, practice sessions and answers
//   state/exercise-sessions/<id>.yaml  one file per exercise session, so a finished session is never re-sent
//   settings.yaml, profile.yaml, knowledge.yaml (readable view, regenerated with each snapshot)
//   conversations/<thread>.yaml, conversations/practice-history.yaml, library/<book>.yaml
// Restore = snapshot + the segments after its cursor. Segments the snapshot covers are pruned from the tip when a newer snapshot is written (git history keeps them).

export const MANIFEST_FORMAT = 'linguaweave-backup'
export const SETTINGS_FORMAT = 'linguaweave-settings'
export const SEGMENT_EVENTS = 1000
/** A snapshot is written again after this many segments or events since the last one. */
export const SNAPSHOT_EVERY_SEGMENTS = 25
export const SNAPSHOT_EVERY_EVENTS = 5000

export interface SegmentRef { path: string; from: number; to: number; events: number }
export interface Manifest { format: typeof MANIFEST_FORMAT; version: 2; cursor: number; snapshot: { file: string; cursor: number }; segments: SegmentRef[] }
export type SequencedEvent = JournalEvent & { seq: number }

export const dump = (value: unknown) => stringify(value, { aliasDuplicateObjects: false, lineWidth: 0 })
export const safeName = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_')
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const pad = (value: number) => String(value).padStart(9, '0')

export const segmentPath = (from: number, to: number) => `journal/${pad(from)}-${pad(to)}.yaml`

export function knowledgeView(snapshot: Pick<ProfileSnapshot, 'knowledge'>): string {
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

/** The log-derived state: what replaying the journal produces. */
export interface LogState { knowledge: KnowledgeEntry[]; cards: StudyCard[]; attempts: ExerciseAttempt[]; characters: CharacterState[] }

export interface UnjournaledState {
  words: ProfileSnapshot['knowledge']['words']; readings: ProfileSnapshot['knowledge']['readings']
  lessons: ProfileSnapshot['knowledge']['lessons']; sessions: ProfileSnapshot['knowledge']['sessions']
  attempts: ProfileSnapshot['knowledge']['attempts']; exerciseSessions: ProfileSnapshot['knowledge']['study']['sessions']
  practiceHistory: NonNullable<ProfileSnapshot['conversations']['practiceHistory']>
  threads: ProfileSnapshot['conversations']['threads']; messages: ProfileSnapshot['conversations']['messages']
  runs: ProfileSnapshot['conversations']['runs']; library: ProfileSnapshot['library']; media: ProfileSnapshot['media']; sourceEntries: ProfileSnapshot['sourceEntries']
  collections: ProfileSnapshot['collections']
}

export interface BuildInput {
  profile: ProfileMetadata
  settings: ProfileSnapshot['settings']
  unjournaled: UnjournaledState
  state: LogState
  cursor: number
  /** Events after the previous backup's cursor (all of them on a full backup). */
  fresh: SequencedEvent[]
  /** Segments already in the repository since the last snapshot, with their paths. */
  existing: SegmentRef[]
  snapshotDue: boolean
  /** The first backup keeps the whole log next to its snapshot; later snapshots prune what they cover. */
  first: boolean
  snapshotCursor: number
  connection?: { owner: string; repo: string; branch: string; token: string }
}

export interface BuildOutput {
  files: Map<string, string>
  /** Paths whose content is unchanged and already in the repository: not rebuilt. */
  keep: Set<string>
  manifest: Manifest
}

/** Splits events into immutable segments of at most SEGMENT_EVENTS. */
export function segmentsOf(events: SequencedEvent[]): { ref: SegmentRef; text: string }[] {
  const out: { ref: SegmentRef; text: string }[] = []
  for (let i = 0; i < events.length; i += SEGMENT_EVENTS) {
    const part = events.slice(i, i + SEGMENT_EVENTS)
    out.push({ ref: { path: segmentPath(part[0].seq, part[part.length - 1].seq), from: part[0].seq, to: part[part.length - 1].seq, events: part.length }, text: part.map(eventLine).join('') })
  }
  return out
}

export function buildFilesV2(input: BuildInput): BuildOutput {
  const { profile, settings, unjournaled: u, state, cursor } = input
  const files = new Map<string, string>()
  const keep = new Set<string>()
  const assembled = {
    format: PROFILE_FORMAT, version: PROFILE_VERSION, contentVersion: CONTENT_VERSION, exportedAt: 0, profile, settings,
    knowledge: {
      words: u.words, readings: u.readings, lessons: u.lessons, sessions: u.sessions, attempts: u.attempts, characterStates: state.characters,
      study: { knowledge: state.knowledge, cards: state.cards, sessions: u.exerciseSessions, attempts: state.attempts },
    },
    conversations: { threads: u.threads, messages: u.messages, runs: u.runs, ...(u.practiceHistory.length ? { practiceHistory: u.practiceHistory } : {}) },
    library: u.library,
    media: u.media,
    sourceEntries: u.sourceEntries,
    collections: u.collections,
  } as ProfileSnapshot
  const whole = toProfileYaml(assembled) as unknown as { knowledge: Record<string, unknown> & { study: Record<string, unknown> & { sessions: { id: string }[] } }; conversations: { threads: { id: string }[]; messages: { threadId: string }[]; runs: { threadId: string }[]; practiceHistory?: unknown[] }; library: { id: string }[]; media: { id: string }[]; collections: CollectionsBackup }
  const { study, characterStates, ...plain } = whole.knowledge
  const { sessions: exerciseSessions, knowledge: studyKnowledge, cards, attempts } = study

  files.set('profile.yaml', dump({ id: profile.id, name: profile.name }))
  files.set('settings.yaml', dump({ format: SETTINGS_FORMAT, version: 1, settings, ...(input.connection ? { backup: input.connection } : {}) }))
  files.set('state/state.yaml', dump({ knowledge: plain }))
  for (const session of exerciseSessions) files.set(`state/exercise-sessions/${safeName(session.id)}.yaml`, dump(session))
  for (const thread of whole.conversations.threads) {
    files.set(`conversations/${safeName(thread.id)}.yaml`, dump({
      thread, messages: whole.conversations.messages.filter(message => message.threadId === thread.id),
      runs: whole.conversations.runs.filter(run => run.threadId === thread.id),
    }))
  }
  if (whole.conversations.practiceHistory?.length) files.set('conversations/practice-history.yaml', dump({ practiceHistory: whole.conversations.practiceHistory }))
  for (const book of whole.library) files.set(`library/${safeName(book.id)}.yaml`, dump(book))
  for (const item of whole.media) files.set(`media/${safeName(item.id)}.yaml`, dump(item))
  for (const [path, text] of sourceEntryFiles(u.sourceEntries)) files.set(path, text)
  for (const part of splitCollections(whole.collections)) files.set(`collections/${safeName(part.id)}.yaml`, dump(part.value))

  // The log: the new segment(s) only; segments already in the repository are kept as they are.
  const fresh = segmentsOf(input.fresh)
  for (const segment of fresh) files.set(segment.ref.path, segment.text)
  let segments = [...input.existing, ...fresh.map(segment => segment.ref)]
  let snapshotCursor = input.snapshotCursor
  if (input.snapshotDue) {
    files.set('state/snapshot.yaml', dump({ format: 'linguaweave-snapshot', version: 1, cursor, knowledge: { characterStates, study: { knowledge: studyKnowledge, cards, attempts } } }))
    files.set('knowledge.yaml', knowledgeView(assembled))
    snapshotCursor = cursor
    // Everything up to the new snapshot is covered by it; the log before it leaves the tip.
    if (!input.first) {
      segments = segments.filter(segment => segment.to > cursor)
      for (const segment of fresh) if (segment.ref.to <= cursor) files.delete(segment.ref.path)
    }
  } else {
    keep.add('state/snapshot.yaml'); keep.add('knowledge.yaml')
  }
  for (const segment of segments) if (!files.has(segment.path)) keep.add(segment.path)
  const manifest: Manifest = { format: MANIFEST_FORMAT, version: 2, cursor, snapshot: { file: 'state/snapshot.yaml', cursor: snapshotCursor }, segments }
  files.set('manifest.yaml', dump(manifest))
  return { files, keep, manifest }
}

/** Reads a version 2 file set: the snapshot plus the log segments after its cursor. */
export function loadBackupV2(files: Map<string, string>, profileFallback: ProfileMetadata): LoadedBackup {
  const required = (path: string) => {
    const text = files.get(path)
    if (text === undefined) throw new Error(`The backup has no ${path}.`)
    return text
  }
  const manifest = parse(required('manifest.yaml')) as Manifest
  if (manifest.format !== MANIFEST_FORMAT || manifest.version !== 2 || !Array.isArray(manifest.segments)) throw new Error('Unsupported backup manifest.')
  const snapshotFile = parse(required(manifest.snapshot.file)) as { cursor: number; knowledge: { characterStates: unknown[]; study: Record<string, unknown> } }
  const settingsFile = parse(required('settings.yaml')) as { settings: ProfileSnapshot['settings']; backup?: LoadedBackup['backup'] }
  const stateFile = parse(required('state/state.yaml')) as { knowledge: Record<string, unknown> }
  const meta = files.has('profile.yaml') ? parse(files.get('profile.yaml')!) as Partial<ProfileMetadata> : {}
  const sessions: unknown[] = []
  const conversations = { threads: [] as unknown[], messages: [] as unknown[], runs: [] as unknown[], practiceHistory: [] as unknown[] }
  const library: unknown[] = []
  const media: unknown[] = []
  const sourceEntries: unknown[] = []
  const collectionParts: CollectionsBackup[] = []
  for (const [path, text] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (path.startsWith('state/exercise-sessions/')) sessions.push(parse(text))
    else if (path === 'conversations/practice-history.yaml') conversations.practiceHistory.push(...(parse(text) as { practiceHistory: unknown[] }).practiceHistory)
    else if (path.startsWith('conversations/')) {
      const item = parse(text) as { thread: unknown; messages: unknown[]; runs: unknown[] }
      conversations.threads.push(item.thread); conversations.messages.push(...item.messages); conversations.runs.push(...item.runs)
    } else if (path.startsWith('library/')) library.push(parse(text))
    else if (path.startsWith('media/')) media.push(parse(text))
    else if (isSourceEntryFile(path)) sourceEntries.push(...(parse(text) as { entries: unknown[] }).entries)
    else if (path.startsWith('collections/')) collectionParts.push(parse(text) as CollectionsBackup)
  }
  const rest = { ...conversations, ...(conversations.practiceHistory.length ? {} : { practiceHistory: undefined }) }
  const profile = { id: meta.id ?? profileFallback.id, name: meta.name ?? profileFallback.name }
  const wire = {
    format: PROFILE_FORMAT, version: PROFILE_VERSION, contentVersion: CONTENT_VERSION, exportedAt: 0, profile, settings: settingsFile.settings,
    knowledge: { ...stateFile.knowledge, characterStates: snapshotFile.knowledge.characterStates, study: { ...snapshotFile.knowledge.study, sessions } },
    conversations: rest, library, media, sourceEntries, collections: joinCollections(collectionParts),
  }
  const base = parseProfileYaml(dump(wire))
  const tail: JournalEvent[] = []
  for (const segment of [...manifest.segments].sort((a, b) => a.from - b.from)) {
    if (segment.to <= snapshotFile.cursor) continue
    for (const event of parseJournal(required(segment.path))) {
      const { seq, ...plain } = event as SequencedEvent
      if (typeof seq !== 'number' || seq > snapshotFile.cursor) tail.push(plain as JournalEvent)
    }
  }
  const state = replay(tail, replayFrom({ knowledge: base.knowledge.study.knowledge, cards: base.knowledge.study.cards, attempts: base.knowledge.study.attempts, characters: base.knowledge.characterStates }))
  const snapshot: ProfileSnapshot = { ...base, settings: settingsFile.settings, knowledge: { ...base.knowledge,
    characterStates: [...state.characters.values()],
    study: { ...base.knowledge.study, knowledge: [...state.knowledge.values()], cards: [...state.cards.values()], attempts: [...state.exerciseAttempts.values()] } } }
  return { snapshot, journal: tail, mode: 'checkpoint', tailEvents: tail.length, ...(settingsFile.backup ? { backup: settingsFile.backup } : {}), profile: meta }
}
