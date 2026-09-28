import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { db, initializeWorkspace, LearningDatabase, profileDatabaseName } from '../database'
import { exportWorkspaceBackup, readBackup, restoreBackup } from '../backup'
import { createProfile, exportActiveProfile, restoreActiveProfile } from '../profiles/store'
import { parseProfileYaml } from '../profiles/codec'
import { resetProfileStorage } from '../../test/profile-storage'
import { rememberPracticePhrase } from './practice-history'
import { practiceHistoryEntrySchema } from './contracts'
import { createConversation, deleteThread } from './store'

const phrase = { type: 'speech', locale: 'zh-Hans', text: '你好，朋友。', romanization: 'nǐ hǎo, péng you.', meaning: 'Hello, friend.' } as const
beforeEach(async () => { await resetProfileStorage(); await initializeWorkspace() })
afterEach(() => vi.restoreAllMocks())

describe('recent phrase practice', () => {
  it('keeps one exact phrase, moves it to the top, and retains the most recently opened playlist', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10)
    await rememberPracticePhrase(phrase, 0.5, [3, 6])
    vi.mocked(Date.now).mockReturnValue(20)
    await rememberPracticePhrase({ ...phrase, text: '茶' }, 1)
    vi.mocked(Date.now).mockReturnValue(30)
    await rememberPracticePhrase(phrase, 0.25, [3, 6], [{ kind: 'chain', step: 1 }, { kind: 'chain', step: 0 }])
    const entries = await db.practiceHistory.orderBy('lastOpenedAt').reverse().toArray()
    expect(entries.map(entry => entry.text)).toEqual([phrase.text, '茶'])
    expect(entries[0]).toMatchObject({ phrase, rate: 0.25, lastOpenedAt: 30, chain: { ends: [3, 6] } })
    db.close()
    await db.open()
    expect(await db.practiceHistory.toArray()).toHaveLength(2)
  })

  it('survives deletion of the source conversation and roundtrips through JSON and profile YAML', async () => {
    const id = await createConversation()
    await rememberPracticePhrase(phrase, 0.75, [3, 6])
    await deleteThread(id)
    const saved = await db.practiceHistory.toArray()
    const backup = await exportWorkspaceBackup()
    expect(readBackup(backup).assistant?.practiceHistory).toEqual(saved)
    await db.practiceHistory.clear()
    await restoreBackup(backup)
    expect(await db.practiceHistory.toArray()).toEqual(saved)
    const yaml = await exportActiveProfile()
    expect(parseProfileYaml(yaml).conversations.practiceHistory).toEqual(saved)
    await db.practiceHistory.clear()
    await restoreActiveProfile(yaml)
    expect(await db.practiceHistory.toArray()).toEqual(saved)
    const oldBackup = JSON.parse(backup)
    delete oldBackup.assistant.practiceHistory
    await restoreBackup(JSON.stringify(oldBackup))
    expect(await db.practiceHistory.count()).toBe(0)
  })

  it('isolates fresh profiles and includes history when cloning a profile', async () => {
    await rememberPracticePhrase(phrase, 1)
    for (const clone of [false, true]) {
      const profile = await createProfile(clone ? 'Clone' : 'Fresh', clone)
      const other = new LearningDatabase(profileDatabaseName(profile.id))
      try {
        await other.open()
        expect(await other.practiceHistory.count()).toBe(clone ? 1 : 0)
      } finally { await other.delete() }
    }
    expect(await db.practiceHistory.count()).toBe(1)
  })

  it('rejects invalid or mismatched records and reports failed storage writes', async () => {
    expect(practiceHistoryEntrySchema.safeParse({ text: '茶', phrase, rate: 1, lastOpenedAt: 1 }).success).toBe(false)
    expect(practiceHistoryEntrySchema.safeParse({ text: phrase.text, phrase, rate: 1, lastOpenedAt: 1, chain: { text: '茶', ends: [1] } }).success).toBe(false)
    vi.spyOn(db.practiceHistory, 'put').mockRejectedValueOnce(new Error('Storage full'))
    await expect(rememberPracticePhrase(phrase, 1)).rejects.toThrow('Storage full')
    expect(await db.practiceHistory.count()).toBe(0)
  })
})
