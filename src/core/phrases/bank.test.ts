import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { loadCatalog } from '../study/catalog'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { allowedForms, catalogBankPhrases, drillBankPhrases, heardLog, leastHeard, loadBank, recordHeard, shippedPhrases, usableFor } from './bank'

// A shipped band file as the offline pipeline writes it: by the word's catalog label.
vi.mock('../../data/phrases/hsk-1.json', () => ({ default: { schemaVersion: 1, band: '1', phrases: {
  'xue2-sheng5--student': [
    { zh: '我是学生。', py: 'wǒ shì xué sheng', en: 'I am a student.', words: ['wo3--me', 'shi4--identity', 'xue2-sheng5--student'], source: 'ai', checked: true },
    { zh: '你是学生吗？', py: 'nǐ shì xué sheng ma', en: 'Are you a student?', words: ['ni3--you', 'shi4--identity', 'xue2-sheng5--student'], source: 'ai', checked: false },
    { zh: '我喝茶，我是学生。', py: 'wǒ hē chá, wǒ shì xué sheng', en: 'I drink tea; I am a student.', words: ['wo3--me', 'he1--drink', 'cha2--tea', 'shi4--identity', 'xue2-sheng5--student'], source: 'ai', checked: true, lookahead: 4, readyAt: 10 },
  ],
} } }))

const student = 'vocabulary:xue2-sheng5--student'
const me = 'vocabulary:wo3--me'
const be = 'vocabulary:shi4--identity'
const you = 'vocabulary:ni3--you'

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })

describe('phrase bank', () => {
  it('takes every catalog example that fits for a word, not just the shortest', async () => {
    const catalog = await loadCatalog()
    const phrases = catalogBankPhrases(catalog, me)
    expect(phrases.length).toBeGreaterThan(1)
    expect(phrases.every(phrase => phrase.source === 'catalog' && phrase.checked && phrase.words.includes(me) && phrase.en)).toBe(true)
    expect(new Set(phrases.map(phrase => phrase.zh)).size).toBe(phrases.length)
  })

  it('reads the shipped band lazily and turns its labels into refs', async () => {
    const shipped = await shippedPhrases('1')
    expect(shipped[student].map(phrase => phrase.zh)).toEqual(['我是学生。', '你是学生吗？', '我喝茶，我是学生。'])
    expect(shipped[student][0].words).toEqual([me, be, student])
    expect(await shippedPhrases('6')).toEqual({})
  })

  it('uses a look-ahead phrase only once its last word is known', async () => {
    const catalog = await loadCatalog()
    const tea = 'vocabulary:cha2--tea', drink = 'vocabulary:he1--drink'
    const known = new Set([student, me, be])
    const zh = '我喝茶，我是学生。'
    const shipped = (await shippedPhrases('1'))[student].find(phrase => phrase.zh === zh)!
    expect(shipped).toMatchObject({ lookahead: 4, readyAt: 10 })
    expect((await loadBank(catalog, [student], known, [])).get(student)!.map(phrase => phrase.zh)).not.toContain(zh)
    expect((await loadBank(catalog, [student], new Set([...known, drink]), [])).get(student)!.map(phrase => phrase.zh)).not.toContain(zh)
    expect((await loadBank(catalog, [student], new Set([...known, drink, tea]), [])).get(student)!.map(phrase => phrase.zh)).toContain(zh)
  })

  it('is usable for a learner only when every word it uses is in the set or the knowledge set', () => {
    const phrase = { words: [me, be, student] }
    expect(usableFor(phrase, new Set([me, be, student]))).toBe(true)
    expect(usableFor(phrase, new Set([me, student]))).toBe(false)
    expect(usableFor({ words: [] }, new Set([me]))).toBe(false)
  })

  it('builds the bank from catalog, shipped and drill sentences, drops the unusable and the duplicates', async () => {
    const catalog = await loadCatalog()
    const allowed = new Set([student, me, be])
    const sets = [
      { content: { state: 'ready', sentences: { [student]: { zh: '我是学生。', py: 'x', en: 'dup of shipped', source: 'ai' } }, conversations: [] } },
      { content: { state: 'ready', sentences: { [student]: { zh: '我的学生。', py: 'wǒ de xué sheng', en: 'My student.', source: 'ai', checked: true } }, conversations: [] } },
      { content: { state: 'ready', sentences: { [student]: { zh: '我爱学生。', py: 'x', en: 'uses a word the learner lacks', source: 'ai' } }, conversations: [] } },
    ] as never
    const bank = await loadBank(catalog, [student], allowed, sets)
    const zh = bank.get(student)!.map(phrase => phrase.zh)
    expect(zh).toContain('我是学生。') // from the catalog or the shipped file, once
    expect(zh.filter(text => text === '我是学生。')).toHaveLength(1)
    expect(zh).not.toContain('你是学生吗？') // 你 is not in the knowledge set
    expect(zh).toContain('我的学生。') // a drill sentence using known words and function characters
    expect(zh).not.toContain('我爱学生。')
    const drill = bank.get(student)!.find(phrase => phrase.zh === '我的学生。')!
    expect(drill).toMatchObject({ source: 'drill', checked: true, words: expect.arrayContaining([me, student]) })
    // once 你 is known the shipped phrase is usable too
    const wider = await loadBank(catalog, [student], new Set([...allowed, you]), [])
    expect(wider.get(student)!.map(phrase => phrase.zh)).toContain('你是学生吗？')
  })

  it('validates drill sentences against the learner\'s words the way drill content is', async () => {
    const catalog = await loadCatalog()
    const forms = allowedForms(catalog, new Set([student, me]))
    expect(drillBankPhrases([{ content: { state: 'ready', sentences: { [student]: { zh: '我是学生', py: 'p', en: 'e', source: 'ai' } }, conversations: [] } }] as never, student, forms)).toHaveLength(1)
    expect(drillBankPhrases([{ content: { state: 'ready', sentences: { [student]: { zh: '我是学生', py: 'p', en: 'e', source: 'catalog' } }, conversations: [] } }] as never, student, forms)).toHaveLength(0)
  })

  it('prefers the least-heard phrases and logs what was heard, with when', async () => {
    const list = [{ zh: 'a' }, { zh: 'b' }, { zh: 'c' }, { zh: 'd' }]
    const heard = new Map([['a', { heard: 3, lastHeardAt: 30 }], ['b', { heard: 1, lastHeardAt: 20 }], ['c', { heard: 1, lastHeardAt: 10 }]])
    expect(leastHeard(list, heard).map(phrase => phrase.zh)).toEqual(['d', 'c', 'b', 'a'])
    await recordHeard(['b', 'b', 'd'], 100)
    await recordHeard(['b'], 200)
    expect([...(await heardLog()).values()].sort((x, y) => x.zh.localeCompare(y.zh))).toEqual([{ zh: 'b', heard: 2, lastHeardAt: 200 }, { zh: 'd', heard: 1, lastHeardAt: 100 }])
    expect(leastHeard(list, await heardLog()).map(phrase => phrase.zh).slice(0, 2)).toEqual(['a', 'c'])
  })

  it('carries the heard log in a backup, and an older backup without it still restores', async () => {
    await recordHeard(['你好。'], 5)
    const text = await exportWorkspaceBackup()
    expect(JSON.parse(text).phraseHeard).toEqual([{ zh: '你好。', heard: 1, lastHeardAt: 5 }])
    await db.phraseHeard.clear()
    await restoreBackup(text)
    expect(await db.phraseHeard.toArray()).toEqual([{ zh: '你好。', heard: 1, lastHeardAt: 5 }])
    const older = JSON.parse(text)
    delete older.phraseHeard
    await restoreBackup(JSON.stringify(older))
    expect(await db.phraseHeard.count()).toBe(0)
  })
})
