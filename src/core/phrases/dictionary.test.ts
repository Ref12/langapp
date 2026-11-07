import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCatalog } from '../study/catalog'
import type { UserPhrase } from './contracts'
import { catalogEntries } from './dictionary'
import { phraseKey } from './key'
import { readyLesson, buildPhraseRows, filterPhraseRows, inPhraseScope, loadPhraseSources, mergePhrases, peekPhraseSources, phraseCountFor, phrasesRouteFor, phraseScopeCounts, sourceLabel, userPhraseBand } from './dictionary'

vi.mock('../../data/phrases/hsk-1.json', () => ({ default: { schemaVersion: 2, band: '1', phrases: [
  { id: 1, zh: '我是好学生。', py: 'wǒ shì hǎo xué sheng', en: 'I am a good student.', words: ['wo3--me', 'shi4--identity', 'xue2-sheng5--student'], grammar: ['s-shi4-n--identity'], source: 'ai', checked: true },
  { id: 2, zh: '你是好学生吗？', py: 'nǐ shì hǎo xué sheng ma', en: 'Are you a good student?', words: ['ni3--you', 'shi4--identity', 'xue2-sheng5--student'], source: 'ai', checked: false },
  { id: 3, zh: '我爱爸爸，也爱妈妈。', py: 'wǒ ài bà ba, yě ài mā ma', en: 'I love dad and mom, too (generated).', words: ['wo3--me', 'ai4--love', 'ba4-ba5--dad', 'ye3--also', 'ma1-ma5--mom'], source: 'ai', checked: true },
  { id: 4, zh: '学生，你好。', py: 'xué sheng, nǐ hǎo', en: 'Hello, student.', words: ['xue2-sheng5--student', 'ni3--you'], source: 'book', ref: { title: 'Reader', chapter: 2 }, checked: false },
  { id: 5, zh: '我在练习。', py: 'wǒ zài liàn xí', en: 'I practise.', words: ['wo3--me'], source: 'drill', checked: false },
] } }))
vi.mock('../../data/phrases/hsk-2.json', () => ({ default: { schemaVersion: 2, band: '2', phrases: [
  { id: 1, zh: '啊，我是好学生。', py: 'a, wǒ shì xué sheng', en: 'Ah, I am a student.', words: ['a5--particle', 'wo3--me', 'shi4--identity', 'xue2-sheng5--student'], source: 'ai', checked: true },
] } }))

const v = (name: string) => `vocabulary:${name}`
const me = v('wo3--me'), be = v('shi4--identity'), student = v('xue2-sheng5--student'), you = v('ni3--you')
const identity = 'grammar:s-shi4-n--identity'
const own = (zh: string, words: string[], extra: Partial<UserPhrase> = {}): UserPhrase => ({ zh, py: '', en: '', words, grammar: [], source: 'user', addedAt: 1, ...extra })

async function rows(known: string[], user: UserPhrase[] = []) {
  const catalog = await loadCatalog()
  const sources = await loadPhraseSources(catalog)
  return { catalog, rows: buildPhraseRows(catalog, mergePhrases(catalog, sources, user), new Set(known)) }
}
const byZh = <T extends { phrase: { zh: string } }>(list: T[], zh: string): T => list.find(row => row.phrase.zh === zh)!

describe('phrase dictionary list', () => {
  beforeEach(() => undefined)

  it('loads the sources once, leaves drill sentences out and lists nothing before it is loaded', async () => {
    const catalog = await loadCatalog()
    const { rows: all } = await rows([])
    expect(peekPhraseSources(catalog)).toBeDefined()
    expect(all.some(row => row.phrase.source === 'drill' || row.phrase.zh === '我在练习。')).toBe(false)
    expect(all.some(row => row.phrase.source === 'catalog')).toBe(true)
    expect(byZh(all, '啊，我是好学生。').band).toBe('2')
  })

  it('applies the Hands-free rule: every word known, and every grammar tag too, except for a catalog example', async () => {
    const { rows: none } = await rows([me, be, student])
    expect(byZh(none, '我是好学生。').ready).toBe(false) // grammar tag not known
    expect(byZh(none, '你是好学生吗？').ready).toBe(false) // you not known
    const { rows: more } = await rows([me, be, student, you, identity])
    expect(byZh(more, '我是好学生。').ready).toBe(true)
    expect(byZh(more, '你是好学生吗？').ready).toBe(true)
    // the catalog example's own grammar tags are not required
    const example = more.find(row => row.phrase.source === 'catalog' && (row.phrase.grammar?.length ?? 0) > 0)!
    const { rows: wordsOnly } = await rows(example.phrase.words)
    expect(byZh(wordsOnly, example.phrase.zh).ready).toBe(true)
    expect(byZh(wordsOnly, example.phrase.zh).needs).toBe('')
  })

  it('says what is missing: words by their form, then grammar labels', async () => {
    const { catalog, rows: list } = await rows([me])
    expect(byZh(list, '我是好学生。').needs).toBe('needs 是, 学生, ' + (catalog.units.get(identity) as { record: { pt: string } }).record.pt)
    const { rows: grammarOnly } = await rows([me, be, student])
    expect(byZh(grammarOnly, '我是好学生。').needs).toBe('needs ' + (catalog.units.get(identity) as { record: { pt: string } }).record.pt)
    expect(byZh(grammarOnly, '我是好学生。').missingWords).toEqual([])
    expect(byZh(grammarOnly, '我是好学生。').missingGrammar.map(item => item.ref)).toEqual([identity])
    const { rows: noWords } = await rows([], [own('嗯', [])])
    expect(byZh(noWords, '嗯')).toMatchObject({ ready: false, needs: 'no catalog words to check' })
  })

  it('removes duplicates by Chinese text, the first source winning (catalog, then the learner, then the shipped bank)', async () => {
    const { rows: list } = await rows([], [own('我是好学生。', [me], { en: 'mine' }), own('你你', [you])])
    expect(list.filter(row => row.phrase.zh === '我是好学生。')).toHaveLength(1)
    expect(byZh(list, '我是好学生。').phrase).toMatchObject({ source: 'user', en: 'mine' })
    expect(list.filter(row => row.phrase.zh === '我爱爸爸，也爱妈妈。')).toHaveLength(1)
    expect(byZh(list, '我爱爸爸，也爱妈妈。').phrase.source).toBe('catalog')
    expect(new Set(list.map(row => row.phrase.zh)).size).toBe(list.length)
  })

  it('files phrases by band: the file, the example group, the highest word of a learner phrase', async () => {
    const { catalog, rows: list } = await rows([], [own('我爱你', [me, v('ai4--love')]), own('茶', [v('cha2--tea')]), own('啊', [])])
    expect(byZh(list, '你是好学生吗？').band).toBe('1')
    expect(byZh(list, '我爱爸爸，也爱妈妈。').band).toBe('1')
    expect(byZh(list, '他不但爱喝茶，而且爱喝咖啡。').band).toBe('3')
    expect(userPhraseBand(catalog, [me, v('bu4-dan4--not-only')])).toBe(catalog.units.get(v('bu4-dan4--not-only'))!.band)
    expect(byZh(list, '啊').band).toBeUndefined()
    const high = Math.max(...[me, v('ai4--love')].map(ref => Number(catalog.units.get(ref)!.band)))
    expect(byZh(list, '我爱你').band).toBe(String(high))
    expect(filterPhraseRows(list, { band: '3' }).every(row => row.band === '3')).toBe(true)
    expect(filterPhraseRows(list, { band: '3' }).map(row => row.phrase.zh)).toContain('他不但爱喝茶，而且爱喝咖啡。')
  })

  it('searches Chinese, toneless pinyin and English, and by word', async () => {
    const { rows: list } = await rows([])
    const zhs = (query: string, word?: string) => filterPhraseRows(list, { query, word }).map(row => row.phrase.zh)
    expect(zhs('学生')).toContain('我是好学生。')
    expect(zhs('wo shi hao xue')).toContain('我是好学生。')
    expect(zhs('woshihaoxuesheng')).toContain('我是好学生。')
    expect(zhs('wǒ shì hǎo')).toContain('我是好学生。')
    expect(zhs('shi xue')).not.toContain('你你')
    expect(zhs('are you a good student')).toContain('你是好学生吗？')
    expect(zhs('student')).toContain('学生，你好。')
    expect(zhs('zzzzqq')).toEqual([])
    const withWord = zhs('', student)
    expect(withWord).toContain('我是好学生。')
    expect(withWord.every(zh => list.find(row => row.phrase.zh === zh)!.phrase.words.includes(student))).toBe(true)
    expect(phraseCountFor(list.map(row => ({ phrase: row.phrase, band: row.band })), student)).toBeGreaterThan(2)
  })

  it('lists a sentence once when only its punctuation differs, the lesson example winning', async () => {
    const catalog = await loadCatalog()
    const sources = await loadPhraseSources(catalog)
    const lesson = catalogEntries(catalog)[0].phrase
    const variant = lesson.zh.replace(/[\u3002\uff1f\uff01]+$/u, '') + ' \uff01'
    expect(variant).not.toBe(lesson.zh)
    const generated = { phrase: { ...sources.shipped[0].phrase, zh: variant, words: lesson.words }, band: sources.shipped[0].band }
    const entries = mergePhrases(catalog, { catalog: sources.catalog, shipped: [generated, ...sources.shipped] }, [own(variant, lesson.words)])
    const same = entries.filter(entry => phraseKey(entry.phrase.zh) === phraseKey(lesson.zh))
    expect(same).toHaveLength(1)
    expect(same[0].phrase.zh).toBe(lesson.zh)
    expect(same[0].phrase.source).toBe('catalog')
    expect(phraseKey('\u73b0\u5728\u592a\u665a\u4e86\uff01')).toBe(phraseKey('\u73b0\u5728 \u592a\u665a\u4e86\u3002'))
  })

  it('counts and scopes: ready, pending and added by me, with the heard log and the sources', async () => {
    const catalog = await loadCatalog()
    const sources = await loadPhraseSources(catalog)
    const entries = mergePhrases(catalog, sources, [own('你你', [you])])
    const list = buildPhraseRows(catalog, entries, new Set([me, be, student, you, identity]), new Map([['我是好学生。', { heard: 3, lastHeardAt: 5 }]]))
    const counts = phraseScopeCounts(list)
    expect(counts.all).toBe(list.length)
    expect(counts.ready + counts.pending).toBe(counts.all)
    expect(counts.mine).toBe(1)
    expect(list.filter(row => inPhraseScope(row, 'ready'))).toHaveLength(counts.ready)
    expect(list.filter(row => inPhraseScope(row, 'mine')).map(row => row.phrase.zh)).toEqual(['你你'])
    expect(byZh(list, '我是好学生。').heard).toEqual({ heard: 3, lastHeardAt: 5 })
    expect(byZh(list, '你是好学生吗？').heard).toBeUndefined()
    expect(sourceLabel({ source: 'catalog' })).toBe('Lesson example')
    expect(sourceLabel({ source: 'ai' })).toBe('Generated')
    expect(sourceLabel({ source: 'user' })).toBe('Added by me')
    expect(byZh(list, '学生，你好。').sourceLabel).toBe('Reader, ch. 2')
    expect(byZh(list, '你你').pinyin).toMatch(/^nǐ/) // no stored pinyin: the catalog reading
    expect(entries.map(entry => entry.phrase.zh)).not.toContain('我在练习。')
    expect(phrasesRouteFor(student)).toBe('dictionary/phrases/all?word=' + encodeURIComponent(student))
  })

  it('orders every scope by the lesson where a phrase becomes ready, then lesson examples, generated, then the learner own', async () => {
    const catalog = await loadCatalog()
    const { rows: list } = await rows([], [own('我是学生们', [me, be, student]), own('你你', [you]), own('茶', [v('cha2--tea')])])
    const lessons = list.map(row => row.lesson)
    expect(lessons).toEqual([...lessons].sort((a, b) => a - b))
    const rank = (source: string) => source === 'catalog' ? 0 : source === 'user' ? 2 : 1
    for (let at = 1; at < list.length; at++) if (list[at].lesson === list[at - 1].lesson) expect(rank(list[at].phrase.source)).toBeGreaterThanOrEqual(rank(list[at - 1].phrase.source))
    // the lesson is the highest group position among words and grammar tags (a shipped phrase keeps its readyAt)
    const groupOf = (ref: string) => catalog.orderedGroups.findIndex(({ group }) => group.units.some(unit => `${unit.kind}:${unit.ref}` === ref))
    expect(byZh(list, '我是学生们').lesson).toBe(Math.max(groupOf(me), groupOf(be), groupOf(student)))
    expect(readyLesson(catalog, { words: [me], readyAt: 99 })).toBe(99)
    expect(readyLesson(catalog, { words: [me, student], grammar: [identity] })).toBe(Math.max(groupOf(student), groupOf(identity), groupOf(me)))
    // a tie: same words, three sources
    const tie = list.filter(row => row.lesson === byZh(list, '你你').lesson)
    expect(tie.map(row => rank(row.phrase.source))).toEqual([...tie.map(row => rank(row.phrase.source))].sort((a, b) => a - b))
    // a word-filtered view keeps the order, and the earliest phrase leads the unfiltered list
    const filtered = filterPhraseRows(list, { word: student })
    expect(filtered.map(row => row.lesson)).toEqual([...filtered.map(row => row.lesson)].sort((a, b) => a - b))
    expect(list[0].lesson).toBeLessThanOrEqual(Math.min(...list.map(row => row.lesson)))
    expect(filterPhraseRows(list, {}).map(row => row.phrase.zh)).toEqual(list.map(row => row.phrase.zh))
  })
})
