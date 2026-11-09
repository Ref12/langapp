import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from './database'
import { readBackup, restoreBackup } from './backup'
import { loadBackup } from './backup/files'
import { getActiveProfile, initializeProfiles, restoreActiveProfile, restoreActiveSnapshot } from './profiles/store'
import { parseProfileYaml } from './profiles/codec'
import { cloudFiles, expectedChinese, fixedDir, fixtureJson, fixtureText, isOtherLanguage, stableView } from './main-made-profile.helpers'
import { dueCards } from './study/knowledge'

// The second fixture set: files written by main with the export fix (ad5a8b32), which carry ja:/ko: knowledge rows, cards without kind/lb, form items and a Korean item.
const expected = () => expectedChinese(fixedDir)
const FORMS = { yaml: 'profile.yaml', json: 'backup.json' }

async function seedMainRows() {
  const tables = fixtureJson<Record<string, Record<string, unknown>[]>>('idb-rows.json', fixedDir)
  for (const [name, rows] of Object.entries(tables)) {
    if (name === 'aiConnections' || name === 'backupConfig') continue
    await (db as unknown as Record<string, { bulkPut(rows: unknown[]): Promise<unknown> }>)[name].bulkPut(rows)
  }
}
async function expectNoOtherLanguage() {
  const workspace = await loadWorkspace()
  expect(workspace.knowledge.some(row => isOtherLanguage(row.ref))).toBe(false)
  expect(workspace.studyCards.some(row => isOtherLanguage(row.ref))).toBe(false)
  expect(workspace.lessons.some(row => isOtherLanguage(row.lessonId))).toBe(false)
  expect(workspace.exerciseSessions.some(row => [...row.targetRefs, ...row.reviewRefs].some(isOtherLanguage))).toBe(false)
  expect((await dueCards(Date.now() + 1000)).some(card => isOtherLanguage(card.ref))).toBe(false)
  expect((await db.knowledge.toArray()).some(row => isOtherLanguage(row.ref))).toBe(false)
  expect(await stableView()).toEqual(expected())
}

describe('the files main writes since its export fix', () => {
  it('really carry the shapes the fix introduced', () => {
    const snapshot = fixtureText('cloud/state/snapshot.yaml', fixedDir)
    expect(snapshot).toMatch(/- ref: ja:w:ja-n5-\d+\n\s+kind: vocabulary/)
    expect(snapshot).toMatch(/- ref: ko:w:/)
    expect(snapshot).toMatch(/- ref: ja:w:ja-n5-\d+\n\s+domain: reading/)
    expect(fixtureText('profile.yaml', fixedDir)).toMatch(/ref: ja:f:くる:mashita/)
    const backup = fixtureJson<{ study: { knowledge: { ref: string }[]; cards: { ref: string }[] } }>('backup.json', fixedDir)
    expect(backup.study.knowledge.some(row => row.ref.startsWith('ko:'))).toBe(true)
    expect(backup.study.cards.some(row => row.ref.startsWith('ja:f:'))).toBe(true)
    expect(expected().knowledge.length).toBeGreaterThan(6)
  })

  for (const where of ['an empty profile', 'a database that already holds the main rows']) {
    describe('restored over ' + where, () => {
      beforeEach(async () => {
        await initializeProfiles()
        await db.delete(); await db.open(); await initializeWorkspace()
        if (where !== 'an empty profile') await seedMainRows()
      })
      it('profile YAML', async () => {
        expect(() => parseProfileYaml(fixtureText(FORMS.yaml, fixedDir))).not.toThrow()
        await restoreActiveProfile(fixtureText(FORMS.yaml, fixedDir))
        await expectNoOtherLanguage()
      })
      it('JSON backup', async () => {
        expect(() => readBackup(fixtureText(FORMS.json, fixedDir))).not.toThrow()
        await restoreBackup(fixtureText(FORMS.json, fixedDir))
        await expectNoOtherLanguage()
      })
      it('cloud files (knowledge.yaml, state/snapshot.yaml, journal)', async () => {
        const loaded = loadBackup(cloudFiles(fixedDir), getActiveProfile())
        await restoreActiveSnapshot(loaded.snapshot, loaded.journal)
        await expectNoOtherLanguage()
      })
    })
  }
})

describe('a Chinese-only file made by the fixed main', () => {
  beforeEach(async () => { await initializeProfiles(); await db.delete(); await db.open(); await initializeWorkspace() })
  it('restores in Stable exactly as the file Stable itself would write for that state', async () => {
    const dir = fixedDir + '/chinese-only'
    const view = (await import('./main-made-profile.helpers')).expectedChinese(dir, 'main-view.json')
    await restoreActiveProfile(fixtureText('profile.yaml', dir))
    const fromYaml = await stableView()
    expect(fromYaml).toEqual(view)
    // Stable's own export of that state, restored again, gives the same state (the file main wrote and the file Stable writes are interchangeable).
    const { exportActiveProfile } = await import('./profiles/store')
    const own = await exportActiveProfile()
    await db.delete(); await db.open(); await initializeWorkspace()
    await restoreActiveProfile(own)
    expect(await stableView()).toEqual(fromYaml)
    await db.delete(); await db.open(); await initializeWorkspace()
    await restoreBackup(fixtureText('backup.json', dir))
    expect(await stableView()).toEqual(view)
  })
})
