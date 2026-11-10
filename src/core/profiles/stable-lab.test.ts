import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { fakeGitHub } from '../backup/fake-github'
import { formItemId } from '../forms'
import { addPlainLanguageRows } from '../../test/language-rows'
import { loadBuild, snapshotStable, type Build } from '../../test/channels'
import { setBuildChannelForTests, storageNames } from '../storage-names'

const structured = vi.hoisted(() => ({ requestStructuredJSON: vi.fn() }))
vi.mock('../ai/structured', () => structured)
vi.mock('../study/local-exercises', async importOriginal => ({ ...await importOriginal<typeof import('../study/local-exercises')>(), localVocabularyExercises: () => [], fillLocalExercises: () => [] }))

const connection = {
  id: 'assistant' as const, revision: 'r1', updatedAt: 1, apiType: 'chat-completions' as const,
  baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'test-model', nativeTools: false, structuredOutput: true, storageAcknowledged: true as const,
}
const JA = 'ja:w:ja-n5-00679'
const KO = 'ko:w:ko-nikl-24021'
const proposal = (targets: string[]) => ({ exercises: [
  { id: 'c1', type: 'choice', targets: targets.slice(0, 1), direction: 'zh-to-en', question: '我是学生。', options: ['I am a student.', 'I study.'], answer: 0, explanation: 'Identity with 是.' },
  { id: 'c2', type: 'choice', targets: targets.slice(0, 2), direction: 'en-to-zh', question: 'I study.', options: ['我学习。', '我是学生。'], answer: 0, explanation: '学习 means study.' },
  { id: 't1', type: 'tiles', targets, translation: 'I am a student.', tiles: ['我', '是', '学生'], distractors: ['学习'], explanation: 'Subject, 是, noun.' },
  { id: 't2', type: 'tiles', targets: targets.slice(-1), translation: 'I study.', tiles: ['我', '学习'], distractors: [], explanation: 'Subject then verb.' },
] })

// A cache store for the stable build to have filled; Lab code never touches Cache Storage outside its worker, and must not here.
const caches = new Map<string, unknown>()
let stable: Build

async function wipe() {
  setBuildChannelForTests(undefined)
  for (const info of await indexedDB.databases()) if (info.name) await Dexie.delete(info.name)
  localStorage.clear(); sessionStorage.clear(); caches.clear()
}

/** Stable's data, made by main's own code with the channel set to 'stable'. */
async function seedStable(options: { second?: boolean } = {}) {
  stable = await loadBuild('stable')
  await stable.store.initializeProfiles()
  await stable.database.initializeWorkspace()
  await stable.knowledge.addToKnowledge(['vocabulary:cha2--tea', 'grammar:s-shi4-n--identity'])
  await addPlainLanguageRows(stable.database.db, [JA, KO, formItemId('ja', 'くる', 'masu')], 1_700_000_000_000, [JA])
  await stable.database.db.preferences.update('workspace', { name: 'Stable workspace', theme: 'light' })
  await stable.database.db.aiConnections.put(connection) // a setting Stable hides
  await stable.database.db.backupConfig.put({ id: 'github', owner: 'stable-owner', repo: 'stable-repo', token: 'stable-token', branch: 'main', lastCommit: 'abc' })
  localStorage.setItem(stable.names.local.backupConfigPrefix + 'default', JSON.stringify({ owner: 'stable-owner', repo: 'stable-repo', token: 'stable-token', branch: 'main' }))
  localStorage.setItem(stable.names.local.newItems, '15')
  localStorage.setItem(stable.names.local.handsfree, '{"pause":"long"}')
  sessionStorage.setItem(stable.names.session.mediaJobUrlPrefix + 'job1', 'https://x.test')
  await stable.state.saveCache('default', { target: 'stable-owner/stable-repo#main', remote: { head: 'h', tree: 't', files: {} }, lastSeq: 2, segments: [], snapshotCursor: 0, eventsSinceSnapshot: 2, state: { knowledge: [], cards: [], attempts: [], characters: [] } })
  await stable.state.saveAutoSetting('default', false)
  await stable.state.saveSentSeq('default', 2)
  if (options.second) {
    const other = await stable.store.createProfile('Reading', false)
    await stable.store.selectProfile(other.id)
  }
  caches.set(stable.names.cache.shell('abc'), {}); caches.set(stable.names.cache.runtime, {})
  stable.close()
  await Dexie.delete(storageNames('stable').db.backupState).catch(() => undefined) // the backup-state db is reopened lazily; keep what was saved
}

beforeEach(async () => { await wipe(); structured.requestStructuredJSON.mockReset() })
afterEach(async () => { setBuildChannelForTests(undefined) })

describe('Lab never touches Stable', () => {
  it('leaves every Stable database, key and cache identical through heavy Lab use', async () => {
    await seedStable({ second: true })
    const before = await snapshotStable(caches)
    expect(Object.keys(before.databases).length).toBeGreaterThanOrEqual(3)
    expect(before.localStorage[storageNames('stable').local.newItems]).toBe('15')

    const lab = await loadBuild('lab')
    await lab.store.initializeProfiles() // first visit
    await lab.database.initializeWorkspace()
    const offered = await lab.copy.readStableProfiles()
    expect(offered.map(profile => profile.name)).toEqual(expect.arrayContaining(['default', 'Reading']))
    const mine = offered.find(profile => profile.name === 'default')!
    await lab.importer.copyStableProfile(mine.id)
    // a Chinese lesson
    const { db } = lab.database
    await db.aiConnections.put(connection)
    const catalog = await (await import('../study/catalog')).loadCatalog()
    const group = lab.knowledge.nextGroup(catalog, new Set())!
    structured.requestStructuredJSON.mockImplementation(async () => proposal(group.units.map(unit => unit.ref)))
    const id = await lab.knowledge.startNewSession()
    await (await import('../study/generation')).whenGenerated(id)
    const session = (await db.exerciseSessions.get(id))!
    const first = session.exercises[session.cursor]
    await lab.knowledge.submitExerciseAnswer(id, session.cursor, first.type === 'choice' ? first.answer : first.type === 'tiles' ? first.tiles : [])
    // a Japanese lesson and a review
    await addPlainLanguageRows(db, [JA, KO], Date.now(), [KO])
    const reviewId = await lab.knowledge.startReviewSession(Date.now() + 86_400_000 * 30, true)
    await (await import('../study/generation')).whenGenerated(reviewId)
    // settings
    await db.preferences.update('workspace', { name: 'Lab workspace', theme: 'dark' })
    lab.daily.saveNewCount(10)
    localStorage.setItem(lab.names.local.handsfree, '{"pause":"short"}')
    sessionStorage.setItem(lab.names.session.mediaJobUrlPrefix + 'job2', 'https://lab.test')
    // a second profile, then back
    const second = await lab.store.createProfile('Lab second', false)
    await lab.store.selectProfile(second.id)
    await lab.store.selectProfile('default')
    // a backup to a fake destination, same account and profile id as Stable's
    const fake = fakeGitHub()
    await lab.service.saveBackupConfig({ owner: 'me', repo: 'backups', token: 'lab-token', branch: 'main' })
    const backend = new lab.github.GitHubBackend({ owner: 'me', repo: 'backups', token: 'lab-token' }, fake.fetcher, 0, lab.names)
    // Stable already backed up the same account, repository and profile id ('default'); Lab backs up the copied profile (ja:/ko: rows and a ja:f: form item) with the full job
    const stableBackend = new lab.github.GitHubBackend({ owner: 'me', repo: 'backups', token: 'stable-token' }, fake.fetcher, 0, storageNames('stable'))
    await stableBackend.publishDelta('default', new Map([['manifest.yaml', 'stable manifest\n'], ['journal/a.yaml', 'stable journal\n']]), new Set(), 'stable backup')
    const stableTree = () => new Map([...fake.trees.get(fake.commits.get(fake.headCommit())!.tree)!].filter(([path]) => path.startsWith('profiles/')))
    const stableFiles = stableTree()
    expect((await lab.database.db.knowledge.toArray()).some(row => row.ref.startsWith('ja:f:'))).toBe(true)
    const record = await lab.run.runBackupJob({ database: lab.database.db, profile: lab.store.getActiveProfile(), config: { owner: 'me', repo: 'backups', branch: 'main', token: 't' }, backend, trigger: 'manual' })
    expect(record.outcome).toBe('ok')
    expect(stableTree()).toEqual(stableFiles) // Stable's backup files: same paths, same blob ids
    expect([...fake.trees.get(fake.commits.get(fake.headCommit())!.tree)!.keys()].filter(path => path !== 'README.md' && !stableFiles.has(path)).every(path => path.startsWith('lab/profiles/default/'))).toBe(true)
    lab.close()

    expect(await snapshotStable(caches)).toEqual(before)
    // Lab wrote only under its own names
    const names = (await indexedDB.databases()).map(info => info.name!)
    expect(names.filter(name => name.startsWith('lab.')).length).toBeGreaterThanOrEqual(3)
    expect(Object.keys(localStorage).filter(key => key.startsWith('lab.')).length).toBeGreaterThan(0)
    // and a Stable-channel open still works, with its data
    const again = await loadBuild('stable')
    await again.store.initializeProfiles()
    expect(again.store.getActiveProfile().name).toBe('Reading')
    expect(again.database.db.name).toMatch(/^linguaweave-next-profile-/)
    expect(await again.database.db.preferences.get('workspace')).toBeDefined()
    again.close()
  })
})

describe('the copy', () => {
  it('brings every row, including ja:/ko: records and hidden settings, and no backup identity', async () => {
    await seedStable()
    const lab = await loadBuild('lab')
    await lab.store.initializeProfiles()
    await lab.database.initializeWorkspace()
    await lab.database.db.backupConfig.put({ id: 'github', owner: 'lab-owner', repo: 'lab-repo', token: 'lab-token', branch: 'main' })
    await lab.state.saveSentSeq('default', 99)
    const [info] = await lab.copy.readStableProfiles()
    expect(info.counts).toMatchObject({ knowledge: 5, japaneseKorean: 3 })
    expect(info.lastActivity).toBeGreaterThan(0)
    await lab.importer.copyStableProfile(info.id)
    const { db } = lab.database
    expect((await db.knowledge.toArray()).map(row => row.ref).sort()).toEqual(['grammar:s-shi4-n--identity', JA, KO, 'ja:f:くる:masu', 'vocabulary:cha2--tea'].sort())
    expect((await db.studyCards.toArray()).length).toBe(5)
    expect((await db.journal.toArray()).length).toBeGreaterThanOrEqual(4)
    expect((await db.preferences.get('workspace'))?.name).toBe('Stable workspace')
    expect((await db.aiConnections.get('assistant'))?.apiKey).toBe('k')
    // no backup identity: the Stable connection did not arrive, Lab's own is kept, and no stable cursor, cache or auto switch
    expect(await db.backupConfig.get('github')).toMatchObject({ owner: 'lab-owner', token: 'lab-token' })
    expect(await lab.state.loadSentSeq('default')).toBeUndefined()
    expect(await lab.state.loadCache('default')).toBeUndefined()
    expect(await lab.state.loadAutoSetting('default')).toBe(true)
    expect(await lab.service.loadBackupConfig()).toMatchObject({ owner: 'lab-owner' })
    lab.close()
  })

  it('starts Lab with no backup setup at all when Lab had none, even though Stable has one', async () => {
    await seedStable()
    const lab = await loadBuild('lab')
    await lab.store.initializeProfiles()
    await lab.database.initializeWorkspace()
    const [info] = await lab.copy.readStableProfiles()
    await lab.importer.copyStableProfile(info.id)
    expect(await lab.service.loadBackupConfig()).toBeUndefined()
    expect(await lab.database.db.backupConfig.count()).toBe(0)
    lab.close()
  })

  it('reports nothing to copy when Stable has never been opened, and creates nothing under Stable names', async () => {
    const lab = await loadBuild('lab')
    await lab.store.initializeProfiles()
    expect(await lab.copy.readStableProfiles()).toEqual([])
    expect((await indexedDB.databases()).filter(info => !info.name!.startsWith('lab.'))).toEqual([])
    lab.close()
  })
})

describe('the device settings', () => {
  it("makes Lab's settings keys equal Stable's, writes nothing under a Stable name, and leaves selection, backup config and the declined flag alone", async () => {
    await seedStable()
    const stableNames = storageNames('stable')
    localStorage.setItem(stableNames.local.reviewCount, '40') // Stable has these; Lab's differ
    localStorage.setItem(stableNames.local.mediaGlosses, 'on')
    const lab = await loadBuild('lab')
    await lab.store.initializeProfiles()
    await lab.database.initializeWorkspace()
    const { selectedProfile, backupConfigPrefix, ...copied } = lab.names.local
    localStorage.setItem(lab.names.local.reviewCount, '5')
    localStorage.setItem(lab.names.local.unwrittenSize, '9') // Stable has none: Lab's must go
    localStorage.setItem(lab.names.local.newItems, '99')
    localStorage.setItem(selectedProfile, 'lab-pick')
    localStorage.setItem(backupConfigPrefix + 'default', '{"owner":"lab"}')
    localStorage.setItem('lab.linguaweave-copy-offer-declined', '1')
    const protectedBefore = [selectedProfile, backupConfigPrefix + 'default', 'lab.linguaweave-copy-offer-declined'].map(key => [key, localStorage.getItem(key)])
    const stableBefore = Object.keys(localStorage).filter(key => !key.startsWith('lab.')).sort().map(key => [key, localStorage.getItem(key)])
    const [info] = await lab.copy.readStableProfiles()
    await lab.importer.copyStableProfile(info.id)
    for (const [name, labKey] of Object.entries(copied)) {
      const stableKey = (stableNames.local as Record<string, string>)[name]
      expect(localStorage.getItem(labKey), name).toBe(localStorage.getItem(stableKey))
    }
    expect(localStorage.getItem(lab.names.local.newItems)).toBe('15')
    expect(localStorage.getItem(lab.names.local.reviewCount)).toBe('40')
    expect(localStorage.getItem(lab.names.local.unwrittenSize)).toBeNull()
    expect(protectedBefore.map(([key]) => [key, localStorage.getItem(key as string)])).toEqual(protectedBefore)
    expect(Object.keys(localStorage).filter(key => !key.startsWith('lab.')).sort().map(key => [key, localStorage.getItem(key)])).toEqual(stableBefore)
    lab.close()
  })

  it('changes nothing when the copy is not confirmed', async () => {
    await seedStable()
    const lab = await loadBuild('lab')
    await lab.store.initializeProfiles()
    localStorage.setItem(lab.names.local.newItems, '99')
    await lab.copy.readStableProfiles() // looking is not copying
    expect(localStorage.getItem(lab.names.local.newItems)).toBe('99')
    lab.close()
  })
})

describe('the version guard', () => {
  it("leaves Stable's database at its old version, and a Stable-channel open still works, when Lab's schema is one version higher", async () => {
    await seedStable()
    const before = await snapshotStable(caches)
    const lab = await loadBuild('lab')
    await lab.store.initializeProfiles()
    await lab.database.initializeWorkspace()
    const LearningDatabase = lab.database.LearningDatabase
    const nextVersion = (Object.values(before.databases).find(entry => entry.version)!.version / 10) + 1 + 1000 // far above anything declared
    void nextVersion
    class Bumped extends LearningDatabase {
      constructor(name: string) { super(name); this.version(Math.round(this.verno) + 1).stores({}) }
    }
    const [info] = await lab.copy.readStableProfiles()
    await lab.importer.copyStableProfile(info.id, { openMigrated: name => new Bumped(name) })
    lab.close()
    const after = await snapshotStable(caches)
    expect(after).toEqual(before)
    const stableDb = Object.entries(after.databases).find(([name]) => name === storageNames('stable').db.learning('default'))!
    expect(stableDb[1].version).toBe(before.databases[stableDb[0]].version)
    const again = await loadBuild('stable')
    await again.store.initializeProfiles()
    expect(await again.database.db.knowledge.count()).toBe(5)
    expect(again.database.db.verno).toBeGreaterThan(0)
    again.close()
  })
})
