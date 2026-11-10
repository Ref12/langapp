// @vitest-environment jsdom
// The display form and the reading style are optional preferences: a learner who never sets them exports exactly as before, in the profile YAML and in the JSON backup.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { savePreferences } from '../learning'
import { setBuildLanguageForTests } from '../storage-names'
import { exportWorkspaceBackup } from '../backup'
import { resetBackupStateForTests } from '../backup/state'
import { getActiveProfile, initializeProfiles, readSnapshot } from './store'
import { parseProfileYaml, serializeProfileYaml } from './codec'

async function exportsOf() {
  return { yaml: serializeProfileYaml(await readSnapshot(db, getActiveProfile())), json: await exportWorkspaceBackup() }
}

describe('the display preferences', () => {
  beforeEach(async () => {
    setBuildLanguageForTests('ja')
    await resetBackupStateForTests()
    localStorage.clear()
    await initializeProfiles()
    await db.delete()
    await db.open()
    await initializeWorkspace()
  })
  afterEach(() => setBuildLanguageForTests(undefined))

  it('are absent from the exports until the learner sets them, and the other settings do not add them', async () => {
    const before = await exportsOf()
    expect(before.yaml).not.toMatch(/displayForm|readingStyle/)
    expect(before.json).not.toMatch(/displayForm|readingStyle/)
    await savePreferences({ name: 'Someone' })
    const after = await exportsOf()
    expect(after.yaml).not.toMatch(/displayForm|readingStyle/)
    expect(after.json).not.toMatch(/displayForm|readingStyle/)
    expect((await db.preferences.get('workspace'))).not.toHaveProperty('displayForm')
  })
  it('are written only when set, and survive an export and a read', async () => {
    await savePreferences({ displayForm: 'dict', readingStyle: 'romaji' })
    const written = await exportsOf()
    expect(written.yaml).toMatch(/displayForm: dict/)
    expect(parseProfileYaml(written.yaml).settings.preferences).toMatchObject({ displayForm: 'dict', readingStyle: 'romaji' })
    expect(written.json).toMatch(/"readingStyle": ?"romaji"/)
  })
  it('accept only what the pack offers, and no romaji is stored anywhere', async () => {
    await expect(savePreferences({ displayForm: 'te' })).rejects.toThrow()
    await expect(savePreferences({ readingStyle: 'pinyin' as never })).rejects.toThrow()
    await savePreferences({ readingStyle: 'romaji' })
    const written = await exportsOf()
    expect(written.yaml + written.json).not.toMatch(/gakusei|benkyou/)
  })
})
