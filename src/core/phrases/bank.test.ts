import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, initializeWorkspace } from '../database'
import { loadCatalog } from '../study/catalog'
import { exportWorkspaceBackup, restoreBackup } from '../backup'
import { allowedForms, catalogBankPhrases, drillBankPhrases, heardLog, leastHeard, loadBank, recordHeard, shippedPhrases, usableFor } from './bank'

// Shipped band files as the generator writes them: one flat list of phrases per band, each listing every word (and grammar pattern) it uses.
vi.mock('../../data/phrases/hsk-1.json', () => ({ default: { schemaVersion: 2, band: '1', phrases: [
  { id: 1, zh: '我是学生。', py: 'wǒ shì xué sheng', en: 'I am a student.', words: ['wo3--me', 'shi4--identity', 'xue2-sheng5--student'], grammar: ['s-shi4-n--identity'], source: 'ai', checked: true },
  { id: 2, zh: '你是学生吗？', py: 'nǐ shì xué sheng ma', en: 'Are you a student?', words: ['ni3--you', 'shi4--identity', 'xue2-sheng5--student'], source: 'ai', checked: false },
  { id: 3, zh: '我喝茶，我是学生。', py: 'wǒ hē chá, wǒ shì xué sheng', en: 'I drink tea; I am a student.', words: ['wo3--me', 'he1--drink', 'cha2--tea', 'shi4--identity', 'xue2-sheng5--student'], source: 'ai', checked: true, lookahead: 4, readyAt: 10 },
  { id: 5, zh: '学生，你好。', py: 'xué sheng, nǐ hǎo', en: 'Hello, student.', words: ['xue2-sheng5--student', 'ni3--you'], grammar: ['stmt-ma5--yes-no'], source: 'book', ref: { title: 'Reader', chapter: 2 }, checked: false },
] } }))
// Bands without a fixture are empty, so the test never depends on the shipped data.
vi.mock('../../data/phrases/hsk-3.json', () => ({ default: { schemaVersion: 2, band: '3', phrases: [] } }))
vi.mock('../../data/phrases/hsk-4.json', () => ({ default: { schemaVersion: 2, band: '4', phrases: [] } }))
vi.mock('../../data/phrases/hsk-5.json', () => ({ default: { schemaVersion: 2, band: '5', phrases: [] } }))
vi.mock('../../data/phrases/hsk-6.json', () => ({ default: { schemaVersion: 2, band: '6', phrases: [] } }))
vi.mock('../../data/phrases/hsk-2.json', () => ({ default: { schemaVersion: 2, band: '2', phrases: [
  { id: 1, zh: '啊，我是学生。', py: 'a, wǒ shì xué sheng', en: 'Ah, I am a student.', words: ['a5--particle', 'wo3--me', 'shi4--identity', 'xue2-sheng5--student'], source: 'ai', checked: true },
] } }))

const student = 'vocabulary:xue2-sheng5--student'
const me = 'vocabulary:wo3--me'
const be = 'vocabulary:shi4--identity'
const you = 'vocabulary:ni3--you'
const particle = 'vocabulary:a5--particle'

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })

describe('phrase bank', () => {
  it('takes every catalog example that fits for a word, not just the shortest', async () => {
    const catalog = await loadCatalog()
    const phrases = catalogBankPhrases(catalog, me)
    expect(phrases.length).toBeGreaterThan(1)
    expect(phrases.every(phrase => phrase.source === 'catalog' && phrase.checked && phrase.words.includes(me) && phrase.en)).toBe(true)
    expect(new Set(phrases.map(phrase => phrase.zh)).size).toBe(phrases.length)
  })

  it('reads the shipped band lazily as a flat list and turns its labels into refs; a phrase is listed under each word it uses', async () => {
    const shipped = await shippedPhrases('1')
    expect(shipped[student].map(phrase => phrase.zh)).toEqual(['我是学生。', '你是学生吗？', '我喝茶，我是学生。', '学生，你好。'])
    expect(shipped[student][0]).toMatchObject({ id: 1, words: [me, be, student], grammar: ['grammar:s-shi4-n--identity'] })
    expect(shipped[me][0]).toBe(shipped[student][0]) // the same phrase, once
    expect(shipped[student][3]).toMatchObject({ source: 'book', ref: { title: 'Reader', chapter: 2 } })
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

  it('requires the known grammar too for a phrase that is not a catalog example, and leaves catalog examples gated on words', () => {
    const grammar = 'grammar:s-shi4-n--identity'
    const phrase = { words: [me, be, student], grammar: [grammar], source: 'ai' as const }
    expect(usableFor(phrase, new Set([me, be, student]))).toBe(false)
    expect(usableFor(phrase, new Set([me, be, student, grammar]))).toBe(true)
    expect(usableFor({ ...phrase, source: 'book' }, new Set([me, be, student]))).toBe(false)
    expect(usableFor({ ...phrase, source: 'catalog' }, new Set([me, be, student]))).toBe(true)
    expect(usableFor({ words: [me], source: 'ai' }, new Set([me]))).toBe(true) // no grammar tags, nothing more to know
  })

  it('finds a word\'s phrases in later band files too, once the learner has words from that band', async () => {
    const catalog = await loadCatalog()
    const known = new Set([student, me, be, 'grammar:s-shi4-n--identity'])
    expect((await loadBank(catalog, [student], known, [])).get(student)!.map(phrase => phrase.zh)).not.toContain('啊，我是学生。')
    expect((await loadBank(catalog, [student], new Set([...known, particle]), [])).get(student)!.map(phrase => phrase.zh)).toContain('啊，我是学生。')
  })

  it('uses a book phrase once its words and grammar are known', async () => {
    const catalog = await loadCatalog()
    const base = new Set([student, you])
    const zh = '学生，你好。'
    expect((await loadBank(catalog, [student], base, [])).get(student)!.map(phrase => phrase.zh)).not.toContain(zh)
    expect((await loadBank(catalog, [student], new Set([...base, 'grammar:stmt-ma5--yes-no']), [])).get(student)!.map(phrase => phrase.zh)).toContain(zh)
  })

  it('builds the bank from catalog, shipped and drill sentences, drops the unusable and the duplicates', async () => {
    const catalog = await loadCatalog()
    const allowed = new Set([student, me, be, 'grammar:s-shi4-n--identity'])
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

  it('drops a bank phrase that differs from a lesson example only by punctuation, in step with the list', async () => {
    const catalog = await loadCatalog()
    const lesson = catalogBankPhrases(catalog, student)[0]
    const variant = lesson.zh.replace(/[\u3002\uff1f\uff01]+$/u, '') + '\uff01'
    const allowed = new Set(lesson.words)
    const sets = [{ content: { state: 'ready', sentences: { [student]: { zh: variant, py: 'x', en: 'same sentence', source: 'ai', checked: true } }, conversations: [] } }] as never
    const bank = (await loadBank(catalog, [student], allowed, sets)).get(student)!
    expect(bank.filter(phrase => phrase.zh === lesson.zh || phrase.zh === variant).map(phrase => phrase.zh)).toEqual([lesson.zh])
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
