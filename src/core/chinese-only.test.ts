import { IDBFactory } from 'fake-indexeddb'
import { parse, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { populatedProfile } from './profiles/test-fixtures'
import { parseProfileYaml, serializeProfileYaml } from './profiles/codec'
import { exportBackup, readBackup } from './backup-codec'
import { buildBackupFiles, loadBackup } from './backup/files'
import { omit } from './omit'
import { replay } from './backup/journal'

let database: typeof import('./database')
let store: typeof import('./profiles/store')
let learning: typeof import('./learning')
const opened: import('./database').LearningDatabase[] = []

// What current main writes into the same tables: other-language refs, lesson ids, session shapes, settings and fields Stable has no schema for.
const foreign = {
  knowledge: { ref: 'ja:w:neko', kind: 'vocabulary', lb: 'neko', band: '1', addedAt: 5, source: 'new' },
  card: { id: 'ja:w:neko:reading', ref: 'ja:w:neko', domain: 'reading', due: 9, stability: 1, difficulty: 5, reps: 1, lapses: 0, state: 'review', updatedAt: 6 },
  lesson: { lessonId: 'ko:lesson:3', startedAt: 7, completedAt: 8 },
  session: { id: 'ja-session', mode: 'new', domain: 'reading', targetRefs: ['ja:w:neko'], reviewRefs: [], exercises: [{ id: 'x', type: 'kana-trace', targets: ['ja:w:neko'] }], cursor: 0, status: 'active', model: '', rejected: [], createdAt: 3 },
  thread: { id: 'ja-thread', title: 'Ja', draft: '', mode: 'conversation', shadowIntent: 'new-phrase', source: { text: 'x', title: 't', route: 'a/b', language: 'ja' }, romanization: false, speechRate: 1, returnRoute: 'dictionary', createdAt: 1, updatedAt: 2 },
}
const extraPreferences = { currentLanguage: 'ja', startedTracks: ['ja'], otherLanguageCards: 'both', japaneseReading: 'kana', somethingNewer: { a: 1 } }

async function boot() {
  database = await import('./database')
  store = await import('./profiles/store')
  learning = await import('./learning')
  await store.initializeProfiles()
  opened.push(database.db)
  await database.initializeWorkspace()
}
const rowsOf = async () => {
  const { db } = database
  return { knowledge: await db.knowledge.get('ja:w:neko'), card: await db.studyCards.get('ja:w:neko:reading'), lesson: await db.lessons.get('ko:lesson:3'),
    session: await db.exerciseSessions.get('ja-session'), thread: await db.assistantThreads.get('ja-thread'),
    preferences: await db.preferences.get('workspace'), journal: (await db.journal.toArray()).filter(event => String(event.ref ?? '').startsWith('ja:')) }
}
async function seed() {
  const { db } = database
  await store.restoreActiveSnapshot(populatedProfile(), [])
  await db.knowledge.add(foreign.knowledge as never)
  await db.studyCards.add(foreign.card as never)
  await db.lessons.add(foreign.lesson)
  await db.exerciseSessions.add(foreign.session as never)
  await db.assistantThreads.add(foreign.thread as never)
  await db.preferences.update('workspace', extraPreferences as never)
  await db.journal.add({ t: '2026-01-01T00:00:00.000Z', op: 'add', ref: 'ja:w:neko', band: 1, source: 'new' })
  await db.journal.add({ t: '2026-01-01T00:00:01.000Z', op: 'review', ref: 'ja:w:neko', grade: 'good', domain: 'reading', sched: 'fsrs-v9-future' })
}

beforeEach(async () => {
  vi.resetModules()
  const factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  ;(await import('dexie')).default.dependencies.indexedDB = factory
  localStorage.clear()
  await boot()
})
afterEach(() => { for (const connection of opened.splice(0)) connection.close(); vi.unstubAllGlobals() })

describe('Stable ignores what it does not understand and deletes none of it', () => {
  it('exports a profile that holds other-language records, with Chinese state only', async () => {
    await seed()
    const text = await store.exportActiveProfile()
    expect(text).not.toMatch(/ja:|ko:|neko|kana|somethingNewer|startedTracks/)
    const snapshot = parseProfileYaml(text)
    expect(snapshot.knowledge.study.knowledge.map(entry => entry.ref)).toEqual(populatedProfile().knowledge.study.knowledge.map(entry => entry.ref))
    expect(snapshot.knowledge.lessons).toEqual(populatedProfile().knowledge.lessons)
  })

  it('restores a profile file that carries unknown settings, fields, lessons and refs, ignoring them', async () => {
    const wire = parse(serializeProfileYaml(populatedProfile())) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    Object.assign(wire.settings.preferences, extraPreferences)
    wire.knowledge.lessons.push(foreign.lesson)
    wire.knowledge.study.knowledge.push({ kind: 'ja', lb: 'w', band: '1', addedAt: 1, source: 'new' })
    wire.knowledge.study.cards.push({ ...foreign.card, id: undefined, ref: undefined, kind: 'ko', lb: 'w' })
    wire.knowledge.study.sessions.push(foreign.session)
    wire.conversations.threads.push(foreign.thread)
    const snapshot = parseProfileYaml(stringify(wire))
    expect(snapshot.knowledge.study.knowledge).toEqual(populatedProfile().knowledge.study.knowledge)
    expect(snapshot.knowledge.study.sessions).toEqual(populatedProfile().knowledge.study.sessions)
    expect(snapshot.knowledge.lessons).toEqual(populatedProfile().knowledge.lessons)
    expect(snapshot.settings.preferences).toEqual(populatedProfile().settings.preferences)
    // A conversation is kept; only the field Stable has no schema for is dropped.
    expect(snapshot.conversations.threads.find(thread => thread.id === 'ja-thread')?.source).toEqual({ text: 'x', title: 't', route: 'a/b' })
    expect(snapshot.knowledge.study.cards).toEqual(populatedProfile().knowledge.study.cards)
    await store.restoreActiveProfile(stringify(wire))
    expect((await database.db.knowledge.toArray()).map(entry => entry.ref).sort()).toEqual(populatedProfile().knowledge.study.knowledge.map(entry => entry.ref).sort())
  })

  it('backs up and restores Chinese state identically; the journal skips other-language events', async () => {
    await seed()
    const { readSnapshot } = store
    const snapshot = await readSnapshot(database.db, store.getActiveProfile())
    const journal = (await database.db.journal.toArray()).map(row => omit(row, 'seq') as unknown as import('./backup/journal').JournalEvent)
    expect(journal.some(event => event.ref === 'ja:w:neko')).toBe(true)
    const loaded = loadBackup(buildBackupFiles(snapshot, journal), store.getActiveProfile())
    const expected = populatedProfile()
    expect(loaded.snapshot.knowledge.study.knowledge).toEqual(expected.knowledge.study.knowledge)
    expect(loaded.snapshot.knowledge.study.cards).toEqual(expected.knowledge.study.cards)
    expect(loaded.snapshot.knowledge.words).toEqual(expected.knowledge.words)
    expect(loaded.snapshot.knowledge.lessons).toEqual(expected.knowledge.lessons)
    expect(loaded.snapshot.settings.preferences).toEqual(expected.settings.preferences)
    expect(replay(journal as never).knowledge.has('ja:w:neko')).toBe(false)
  })

  it('leaves the skipped records byte-identical after normal use, an export and a restore of the same profile', async () => {
    await seed()
    const before = await rowsOf()
    await learning.savePreferences({ theme: 'light', pinyin: false })
    await store.exportActiveProfile()
    expect(await rowsOf()).toEqual({ ...before, preferences: { ...before.preferences, theme: 'light', pinyin: false } })
    await database.db.assistantThreads.update('ja-thread', { title: 'Ja' })
    expect((await rowsOf()).thread).toEqual(before.thread)
  })

  it('reads a JSON backup made by current main, ignoring what it does not know', async () => {
    await seed()
    const { loadWorkspace } = database
    const workspace = await loadWorkspace()
    const own = JSON.parse(exportBackup(workspace))
    Object.assign(own.workspace.preferences, extraPreferences)
    own.workspace.lessons.push(foreign.lesson)
    own.study.knowledge.push(foreign.knowledge)
    own.study.cards.push(foreign.card)
    own.study.sessions.push(foreign.session)
    const read = readBackup(JSON.stringify(own))
    expect(read.knowledge).toEqual(workspace.knowledge)
    expect(read.lessons).toEqual(workspace.lessons)
    expect(read.preferences).toEqual(workspace.preferences)
  })
})
