import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { loadCatalog } from '../study/catalog'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { loadBank } from './bank'
import { addUserPhrase, buildUserPhrase, getUserPhrase, listUserPhrases, removeUserPhrase } from './user'
import type { UserPhrase } from './contracts'

vi.mock('../../data/phrases/hsk-1.json', () => ({ default: { schemaVersion: 2, band: '1', phrases: [
  { id: 2, zh: '你是学生吗？', py: 'nǐ shì xué sheng ma', en: 'Are you a student?', words: ['ni3--you', 'shi4--identity', 'xue2-sheng5--student'], source: 'ai', checked: true },
] } }))

const student = 'vocabulary:xue2-sheng5--student'
const ma = 'grammar:stmt-ma5--yes-no'
const row = (over: Partial<UserPhrase> = {}): UserPhrase => ({ zh: '你好。', py: 'nǐ hǎo', en: 'Hello.', words: [], grammar: [], source: 'user', addedAt: 7, ...over })

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })

describe('user phrases', () => {
  it('builds a phrase from the code split: words as refs, given romanization and meaning, matcher grammar', async () => {
    const catalog = await loadCatalog()
    const phrase = await buildUserPhrase(catalog, { text: '你是学生吗？', romanization: 'nǐ shì xué sheng ma?', meaning: 'Are you a student?' }, 5)
    expect(phrase).toMatchObject({ zh: '你是学生吗？', py: 'nǐ shì xué sheng ma?', en: 'Are you a student?', source: 'user', addedAt: 5, grammar: [ma] })
    expect(phrase.words).toContain(student)
    expect(phrase.words.every(ref => ref.startsWith('vocabulary:'))).toBe(true)
  })

  it('generates pinyin without a romanization, allows an empty meaning and no grammar', async () => {
    const phrase = await buildUserPhrase(await loadCatalog(), { text: '我是学生。' })
    expect(phrase.py).toMatch(/xu/)
    expect(phrase.en).toBe('')
    expect(phrase.grammar).toEqual([])
  })

  it('adding the same phrase twice is a no-op, and a phrase can be removed', async () => {
    expect(await addUserPhrase(row())).toBe(true)
    expect(await addUserPhrase(row({ en: 'changed', addedAt: 9 }))).toBe(false)
    expect(await listUserPhrases()).toEqual([row()])
    await removeUserPhrase('你好。')
    expect(await getUserPhrase('你好。')).toBeUndefined()
  })

  it('round-trips in a backup, and an older backup without the table restores empty', async () => {
    await addUserPhrase(row({ words: [student], grammar: [ma] }))
    const text = await exportWorkspaceBackup()
    expect(JSON.parse(text).userPhrases).toHaveLength(1)
    await db.userPhrases.clear()
    await restoreBackup(text)
    expect(await listUserPhrases()).toEqual([row({ words: [student], grammar: [ma] })])
    const older = JSON.parse(text)
    delete older.userPhrases
    await restoreBackup(JSON.stringify(older))
    expect(await db.userPhrases.count()).toBe(0)
  })

  it('loadBank puts a user phrase before an ai phrase with the same text, and gates it on its words and grammar', async () => {
    const catalog = await loadCatalog()
    const phrase = await buildUserPhrase(catalog, { text: '你是学生吗？', meaning: 'mine' })
    await addUserPhrase(phrase)
    const words = new Set(phrase.words)
    const missingGrammar = await loadBank(catalog, [student], words, [])
    expect(missingGrammar.get(student)!.map(entry => entry.zh)).not.toContain('你是学生吗？') // the matcher tagged 吗, which is not known yet; the ai copy has no tag but its own gating is by words only
    const bank = await loadBank(catalog, [student], new Set([...words, ma]), [])
    const found = bank.get(student)!.filter(entry => entry.zh === '你是学生吗？')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ source: 'user', en: 'mine', grammar: [ma] })
  })

  it('does not block a user phrase on characters the split could not map', async () => {
    const catalog = await loadCatalog()
    await addUserPhrase(row({ zh: '学生龘', words: [student] }))
    const bank = await loadBank(catalog, [student], new Set([student]), [])
    expect(bank.get(student)!.map(entry => entry.zh)).toContain('学生龘')
    expect((await loadBank(catalog, [student], new Set(), [])).get(student)!.map(entry => entry.zh)).not.toContain('学生龘')
  })
})
