import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from './database'
import { restoreBackup } from './backup'
import { loadBackup } from './backup/files'
import { getActiveProfile, initializeProfiles, restoreActiveProfile, restoreActiveSnapshot } from './profiles/store'
import { cloudFiles, expectedChinese, fixtureJson, fixtureText, isOtherLanguage, stableView } from './main-made-profile.helpers'

// A restore replaces the profile (Lab keeps its own copy): over a database that already holds main's ja/ko rows it must not fail, and the Chinese state must equal the backup's.
async function seedMainRows() {
  const tables = fixtureJson<Record<string, Record<string, unknown>[]>>('idb-rows.json')
  for (const [name, rows] of Object.entries(tables)) {
    if (name === 'aiConnections' || name === 'backupConfig') continue
    await (db as unknown as Record<string, { bulkPut(rows: unknown[]): Promise<unknown> }>)[name].bulkPut(rows)
  }
  await db.lessons.put({ lessonId: 'ko:lesson:2', startedAt: 5, completedAt: 6 })
}

beforeEach(async () => {
  await initializeProfiles()
  await db.delete(); await db.open(); await initializeWorkspace()
  await seedMainRows()
})

describe('restoring a main-made fixture over a database that already holds main rows', () => {
  it('starts with other-language rows present', async () => {
    expect((await db.knowledge.toArray()).some(row => isOtherLanguage(row.ref))).toBe(true)
    expect(await stableView()).toEqual(expectedChinese())
  })
  it('profile YAML', async () => {
    await restoreActiveProfile(fixtureText('profile.yaml'))
    expect(await stableView()).toEqual(expectedChinese())
  })
  it('JSON backup', async () => {
    await restoreBackup(fixtureText('backup.json'))
    expect(await stableView()).toEqual(expectedChinese())
  })
  it('cloud layout', async () => {
    const loaded = loadBackup(cloudFiles(), getActiveProfile())
    await restoreActiveSnapshot(loaded.snapshot, loaded.journal)
    expect(await stableView()).toEqual(expectedChinese())
  })
})
