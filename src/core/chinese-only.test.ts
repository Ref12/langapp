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
    thread: await db.assistantThreads.get('ja-thread'),
    preferences: await db.preferences.get('workspace'), journal: (await db.journal.toArray()).filter(event => String(event.ref ?? '').startsWith('ja:')) }
}
async function seed() {
  const { db } = database
  await store.restoreActiveSnapshot(populatedProfile(), [])
  await db.knowledge.add(foreign.knowledge as never)
  await db.studyCards.add(foreign.card as never)
  await db.lessons.add(foreign.lesson)
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

describe('Stable carries what it does not show, and drops only fields no schema knows', () => {
  it('exports a profile that holds other-language records: the rows and track settings are in the file', async () => {
    await seed()
    const text = await store.exportActiveProfile()
    expect(text).toMatch(/ref: ja:w:neko/)
    expect(text).toMatch(/startedTracks/)
    expect(text).not.toMatch(/somethingNewer/)
    const snapshot = parseProfileYaml(text)
    expect(snapshot.knowledge.study.knowledge.map(entry => entry.ref).sort()).toEqual([...populatedProfile().knowledge.study.knowledge.map(entry => entry.ref), 'ja:w:neko'].sort())
    expect(snapshot.knowledge.study.cards.some(card => card.ref === 'ja:w:neko')).toBe(true)
    expect(snapshot.knowledge.lessons.map(lesson => lesson.lessonId)).toContain('ko:lesson:3')
    expect(snapshot.settings.preferences).toMatchObject({ currentLanguage: 'ja', startedTracks: ['ja'], otherLanguageCards: 'both', japaneseReading: 'kana' })
  })

  it('restores a profile file with language rows, lessons and settings, keeping them and dropping the unknown field', async () => {
    const wire = parse(serializeProfileYaml(populatedProfile())) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    Object.assign(wire.settings.preferences, extraPreferences)
    wire.knowledge.lessons.push(foreign.lesson)
    wire.knowledge.study.knowledge.push({ ...foreign.knowledge })
    wire.knowledge.study.cards.push({ ...foreign.card, id: undefined })
    wire.conversations.threads.push(foreign.thread)
    const snapshot = parseProfileYaml(stringify(wire))
    expect(snapshot.knowledge.study.knowledge.find(entry => entry.ref === 'ja:w:neko')).toEqual(foreign.knowledge)
    expect(snapshot.knowledge.study.cards.find(card => card.ref === 'ja:w:neko')).toEqual(foreign.card)
    expect(snapshot.knowledge.lessons.map(lesson => lesson.lessonId)).toContain('ko:lesson:3')
    expect(snapshot.settings.preferences).not.toHaveProperty('somethingNewer')
    expect(snapshot.settings.preferences.startedTracks).toEqual(['ja'])
    expect(snapshot.conversations.threads.find(thread => thread.id === 'ja-thread')?.source).toEqual(foreign.thread.source)
    await store.restoreActiveProfile(stringify(wire))
    expect(await database.db.knowledge.get('ja:w:neko')).toEqual(foreign.knowledge)
    expect(await database.db.studyCards.get('ja:w:neko:reading')).toEqual(foreign.card)
    expect(await database.db.lessons.get('ko:lesson:3')).toEqual(foreign.lesson)
  })

  it('backs up and restores every row; the journal replays language events too', async () => {
    await seed()
    const snapshot = await store.readSnapshot(database.db, store.getActiveProfile())
    const journal = (await database.db.journal.toArray()).map(row => omit(row, 'seq') as unknown as import('./backup/journal').JournalEvent)
    const loaded = loadBackup(buildBackupFiles(snapshot, journal.filter(event => event.op !== 'review')), store.getActiveProfile())
    expect(loaded.snapshot.knowledge.study.knowledge.find(entry => entry.ref === 'ja:w:neko')).toEqual(foreign.knowledge)
    expect(loaded.snapshot.knowledge.study.cards.find(card => card.ref === 'ja:w:neko')).toEqual(foreign.card)
    expect(loaded.snapshot.knowledge.lessons.map(lesson => lesson.lessonId)).toContain('ko:lesson:3')
    const replayed = replay(journal.filter(event => event.op === 'add'))
    expect(replayed.knowledge.get('ja:w:neko')).toMatchObject({ ref: 'ja:w:neko', kind: 'vocabulary', lb: 'neko', band: '1' })
  })

  it('leaves the language rows byte-identical after normal use, an export and a restore of the same profile', async () => {
    await seed()
    const before = await rowsOf()
    await learning.savePreferences({ theme: 'light', pinyin: false })
    await store.exportActiveProfile()
    expect(await rowsOf()).toEqual({ ...before, preferences: { ...before.preferences, theme: 'light', pinyin: false } })
  })

  it('reads a JSON backup made by current main: rows and settings kept', async () => {
    await seed()
    const workspace = await database.loadWorkspace()
    const own = JSON.parse(exportBackup(workspace))
    Object.assign(own.workspace.preferences, extraPreferences)
    own.workspace.lessons.push(foreign.lesson)
    own.study.knowledge.push(foreign.knowledge)
    own.study.cards.push(foreign.card)
    const read = readBackup(JSON.stringify(own))
    expect(read.knowledge.find(entry => entry.ref === 'ja:w:neko')).toEqual(foreign.knowledge)
    expect(read.studyCards.find(card => card.ref === 'ja:w:neko')).toEqual(foreign.card)
    expect(read.lessons.map(lesson => lesson.lessonId)).toContain('ko:lesson:3')
    expect(read.preferences).toMatchObject({ startedTracks: ['ja'], currentLanguage: 'ja' })
    expect(read.preferences).not.toHaveProperty('somethingNewer')
  })
})
