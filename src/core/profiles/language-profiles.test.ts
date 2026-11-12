// @vitest-environment jsdom
// Profiles keep to their own language: an export records its language, a file of another language brings only settings, the one-time cleanup
// removes another language's rows from a Japanese or Korean profile, and the counts show only the build's own rows.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { db, initializeWorkspace, LearningDatabase, loadWorkspace, profileDatabaseName } from '../database'
import { resetBackupStateForTests } from '../backup/state'
import { setBuildLanguageForTests } from '../storage-names'
import { exportActiveProfile, importNewProfile, initializeProfiles, restoreActiveProfile, restoreActiveSnapshot } from './store'
import { parseProfileYaml } from './codec'
import { isOtherLanguageProfile, profileLanguage } from './profile-language'
import { learnerFixture } from './fixtures/learner'
import { markCleanupNoticed, removeForeignLanguageRows, unseenCleanupCount } from './language-cleanup'
import { countItems } from '../study/daily'

const KO_REF = 'vocabulary:haksaeng--student'
const KO_GRAMMAR = 'grammar:n-ieyo-n-yeyo--n'

async function seedChinese() {
  const fixture = learnerFixture()
  await restoreActiveSnapshot(fixture.snapshot, fixture.journal)
  return fixture
}
async function addKorean() {
  await db.knowledge.bulkAdd([
    { ref: KO_REF, kind: 'vocabulary', lb: 'haksaeng--student', band: '1', addedAt: 5, source: 'new' },
    { ref: KO_GRAMMAR, kind: 'grammar', lb: 'n-ieyo-n-yeyo--n', band: '1', addedAt: 6, source: 'new' },
  ] as never)
  await db.studyCards.bulkAdd([KO_REF, KO_GRAMMAR].map(ref => ({ id: ref + ':reading', ref, domain: 'reading', due: 1, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 'new', updatedAt: 1 })) as never)
  await db.skillPractice.add({ ref: KO_REF, skill: 'reading', count: 1, lastAt: 1, familiar: false } as never)
}

beforeEach(async () => {
  setBuildLanguageForTests(undefined)
  await resetBackupStateForTests()
  localStorage.clear()
  await initializeProfiles()
  await db.delete()
  await db.open()
  await initializeWorkspace()
})
afterEach(() => { setBuildLanguageForTests(undefined) })

describe('a profile file records its language', () => {
  it('names a Korean build as ko, and leaves the Chinese ones as they always were', async () => {
    await seedChinese()
    const chinese = await exportActiveProfile()
    expect(chinese).not.toMatch(/^language:/m)
    expect(parseProfileYaml(chinese).language).toBeUndefined()
    setBuildLanguageForTests('ko')
    const korean = await exportActiveProfile()
    expect(korean).toMatch(/^language: ko$/m)
    expect(parseProfileYaml(korean).language).toBe('ko')
    expect(profileLanguage(parseProfileYaml(korean))).toBe('ko')
  })

  it('counts a file without a language as Chinese', async () => {
    await seedChinese()
    const plain = parseProfileYaml(await exportActiveProfile())
    expect(profileLanguage(plain)).toBe('zh')
    expect(isOtherLanguageProfile(plain)).toBe(false)
    setBuildLanguageForTests('ko')
    expect(isOtherLanguageProfile(plain)).toBe(true)
    expect(isOtherLanguageProfile({ language: 'ko' })).toBe(false)
  })
})

describe('a Chinese file in a Korean profile', () => {
  it('restores only the settings: no Chinese or Korean learning rows are added or removed, and the connections come in', async () => {
    await seedChinese()
    const file = await exportActiveProfile()
    await db.delete(); await db.open(); await initializeWorkspace()
    setBuildLanguageForTests('ko')
    await addKorean()
    await db.preferences.update('workspace', { name: 'My Korean', theme: 'light' })
    const before = { knowledge: await db.knowledge.count(), cards: await db.studyCards.count(), sessions: await db.exerciseSessions.count(), words: await db.words.count() }
    await restoreActiveProfile(file)
    expect({ knowledge: await db.knowledge.count(), cards: await db.studyCards.count(), sessions: await db.exerciseSessions.count(), words: await db.words.count() }).toEqual(before)
    expect((await db.knowledge.toArray()).map(row => row.ref).sort()).toEqual([KO_GRAMMAR, KO_REF].sort())
    expect((await db.aiConnections.get('assistant'))?.apiKey).toBe('synthetic-ai-key')
    expect((await db.aiEndpoints.count())).toBe(1)
    expect((await db.speechConnections.get('assistant-speech'))?.apiKey).toBe('synthetic-speech-key')
    expect(await db.assistantThreads.count()).toBe(0)
    expect(await db.collections.count()).toBe(0)
    expect((await db.preferences.get('workspace'))?.name).toBe('My Korean') // the name and the language's own settings stay
  })

  it('imports as a new profile with the connections and none of the learning', async () => {
    await seedChinese()
    const file = await exportActiveProfile()
    setBuildLanguageForTests('ko')
    const created = await importNewProfile(file, 'From Chinese')
    const imported = new LearningDatabase(profileDatabaseName(created.id))
    try {
      expect(await imported.knowledge.count()).toBe(0)
      expect(await imported.studyCards.count()).toBe(0)
      expect(await imported.exerciseSessions.count()).toBe(0)
      expect(await imported.collections.count()).toBe(0)
      expect(await imported.assistantThreads.count()).toBe(0)
      expect(await imported.words.count()).toBe(0)
      expect((await imported.aiConnections.get('assistant'))?.apiKey).toBe('synthetic-ai-key')
      expect((await imported.speechConnections.get('assistant-speech'))?.apiKey).toBe('synthetic-speech-key')
    } finally { imported.close(); await Dexie.delete(imported.name) }
  })

  it('still replaces everything from a file of the same language', async () => {
    setBuildLanguageForTests('ko')
    await addKorean()
    const file = await exportActiveProfile()
    await db.knowledge.clear()
    await restoreActiveProfile(file)
    expect((await db.knowledge.toArray()).map(row => row.ref).sort()).toEqual([KO_GRAMMAR, KO_REF].sort())
  })
})

describe('the knowledge counts of a Korean profile holding Chinese rows', () => {
  it('show only the Korean ones', async () => {
    const fixture = await seedChinese()
    await addKorean()
    const chineseCount = fixture.snapshot.knowledge.study.knowledge.length
    expect(chineseCount).toBeGreaterThan(3)
    const zh = await loadWorkspace()
    expect(zh.knowledge.length).toBe(chineseCount + 2) // the Chinese build keeps its own: Korean refs are plain here, so they look Chinese-side
    setBuildLanguageForTests('ko')
    const ko = await loadWorkspace()
    expect(ko.knowledge.map(entry => entry.ref).sort()).toEqual([KO_GRAMMAR, KO_REF].sort())
    expect(countItems(ko.knowledge)).toMatchObject({ words: 1, grammar: 1 })
    expect(ko.studyCards.map(card => card.ref).sort()).toEqual([KO_GRAMMAR, KO_REF].sort())
  })
})

describe('the one-time cleanup', () => {
  it('removes the Chinese rows of a Korean profile once and leaves the Korean ones', async () => {
    const fixture = await seedChinese()
    await addKorean()
    const chineseRefs = new Set(fixture.snapshot.knowledge.study.knowledge.map(entry => entry.ref))
    setBuildLanguageForTests('ko')
    const removed = await removeForeignLanguageRows()
    expect(removed).toBeGreaterThan(0)
    expect((await db.knowledge.toArray()).some(row => chineseRefs.has(row.ref))).toBe(false)
    expect((await db.knowledge.toArray()).map(row => row.ref).sort()).toEqual([KO_GRAMMAR, KO_REF].sort())
    // cards of the Chinese learner's collection phrases (phrase: refs, kept by their text) are not attributable: they stay
    expect((await db.studyCards.toArray()).map(card => card.ref).filter(ref => !ref.startsWith('phrase:')).sort()).toEqual([KO_GRAMMAR, KO_REF].sort())
    expect((await db.skillPractice.toArray()).map(row => row.ref)).toEqual([KO_REF])
    expect((await db.journal.toArray()).every(event => !chineseRefs.has(String((event as { ref?: string }).ref)))).toBe(true)
    // left alone: not attributable by an item ref
    expect(await db.characterStates.count()).toBe(fixture.snapshot.knowledge.characterStates.length)
    expect(await db.assistantThreads.count()).toBe(fixture.snapshot.conversations.threads.length)
    // once per profile, and the notice is shown once
    expect(await unseenCleanupCount()).toBe(removed)
    await markCleanupNoticed()
    expect(await unseenCleanupCount()).toBe(0)
    await db.knowledge.add({ ref: 'vocabulary:ni3--you', kind: 'vocabulary', lb: 'ni3--you', band: '1', addedAt: 9, source: 'new' } as never)
    expect(await removeForeignLanguageRows()).toBe(0)
    expect(await db.knowledge.get('vocabulary:ni3--you')).toBeDefined()
  })

  it('removes nothing in a Chinese build, and writes no record there', async () => {
    const fixture = await seedChinese()
    await addKorean()
    const before = await db.knowledge.count()
    expect(await removeForeignLanguageRows()).toBe(0)
    expect(await db.knowledge.count()).toBe(before)
    expect(await db.profileState.get('foreign-cleanup')).toBeUndefined()
    expect(before).toBeGreaterThan(fixture.snapshot.knowledge.study.knowledge.length)
  })

  it('records nothing to show when a profile has no foreign rows', async () => {
    setBuildLanguageForTests('ko')
    await addKorean()
    expect(await removeForeignLanguageRows()).toBe(0)
    expect(await unseenCleanupCount()).toBe(0)
    expect(await db.profileState.get('foreign-cleanup')).toMatchObject({ removed: 0 })
  })
})
