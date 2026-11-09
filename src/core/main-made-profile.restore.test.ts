import { beforeEach, describe, expect, it } from 'vitest'
import { db, initializeWorkspace } from './database'
import { readBackup, restoreBackup } from './backup'
import { loadBackup } from './backup/files'
import { getActiveProfile, initializeProfiles, restoreActiveProfile, restoreActiveSnapshot } from './profiles/store'
import { parseProfileYaml } from './profiles/codec'
import { cloudFiles, expectedChinese, fixtureText, stableView } from './main-made-profile.helpers'

// The fixtures are a profile as main (langapp/main-for-rebase) left it: Chinese lessons done and a review due, a started Japanese track with a finished lesson,
// currentLanguage ja, Japanese reading kana, other-language cards on, automatic backup on. Each form main can export must restore in Stable, and the Chinese state
// must be exactly what main showed.

beforeEach(async () => {
  await initializeProfiles()
  await db.delete()
  await db.open()
  await initializeWorkspace()
})

describe('a profile main made, restored in Stable', () => {
  it('has a Chinese state worth checking', () => {
    const expected = expectedChinese()
    expect(expected.knowledge.length).toBeGreaterThan(6)
    expect(expected.exerciseSessions.length).toBe(2)
    expect(expected.due).toEqual(['vocabulary:cha2--tea', 'vocabulary:wo3--me'])
  })

  it('restores the profile YAML file', async () => {
    expect(() => parseProfileYaml(fixtureText('profile.yaml'))).not.toThrow()
    await restoreActiveProfile(fixtureText('profile.yaml'))
    expect(await stableView()).toEqual(expectedChinese())
  })

  it('restores the JSON backup', async () => {
    expect(() => readBackup(fixtureText('backup.json'))).not.toThrow()
    await restoreBackup(fixtureText('backup.json'))
    expect(await stableView()).toEqual(expectedChinese())
  })

  it('restores the cloud backup layout with its journal segments', async () => {
    const files = cloudFiles()
    expect([...files.keys()].some(path => path.startsWith('journal/'))).toBe(true)
    const loaded = loadBackup(files, getActiveProfile())
    await restoreActiveSnapshot(loaded.snapshot, loaded.journal)
    expect(await stableView()).toEqual(expectedChinese())
  })
})
