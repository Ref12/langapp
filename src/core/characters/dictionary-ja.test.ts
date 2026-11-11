import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPack } from '../language'
import { japaneseCharacterSearch } from '../language/dictionary'
import { kanaSound } from '../language/character-list-ja'
import { setBuildLanguageForTests } from '../storage-names'
import { newCharacters } from '../drills/write-queue'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { characterKnowledge, dictionaryCharacters, inCharacterGroup, type DictionaryCharacter } from './dictionary'

let catalog: Catalog
let list: DictionaryCharacter[]
beforeEach(async () => { setBuildLanguageForTests('ja'); resetCatalogCache(); catalog = await loadCatalog(); list = dictionaryCharacters(catalog) })
afterEach(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })
const ofGroup = (id: string) => list.filter(entry => entry.group === id)
const text = (id: string) => ofGroup(id).map(entry => entry.character).join('')

describe('the Japanese character list', () => {
  it('lists hiragana and katakana in table order: the basic set, then voiced, then small forms', () => {
    expect(ofGroup('hiragana')).toHaveLength(84)
    expect(ofGroup('katakana')).toHaveLength(84)
    expect(text('hiragana').slice(0, 46)).toBe('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん')
    expect(text('hiragana').slice(46, 72)).toBe('がぎぐげござじずぜぞだぢづでどばぱびぴぶぷべぺぼぽゔ')
    expect(text('hiragana').slice(72)).toBe('ぁぃぅぇぉっゃゅょゎゕゖ')
    expect(text('katakana').slice(0, 10)).toBe('アイウエオカキクケコ')
    expect(text('katakana').slice(72)).toBe('ァィゥェォッャュョヮヵヶ')
  })
  it('lists every character once, kana before kanji, and only characters with a stroke guide', () => {
    const characters = list.map(entry => entry.character)
    expect(new Set(characters).size).toBe(characters.length)
    expect(list.every(entry => entry.asset !== undefined)).toBe(true)
    const order = list.map(entry => entry.group)
    expect(order.indexOf('kanji')).toBeGreaterThan(order.lastIndexOf('katakana'))
    expect(order.indexOf('kanji-all')).toBeGreaterThan(order.lastIndexOf('kanji'))
    expect(ofGroup('kanji').length + ofGroup('kanji-all').length).toBe(list.length - 168)
  })
  it('lists the kanji of the lesson words by the lesson that first uses them, each with its words', () => {
    const kanji = ofGroup('kanji')
    expect(kanji.length).toBeGreaterThan(150)
    expect(kanji.slice(0, 5).map(entry => [entry.character, entry.lesson])).toEqual([['私', 1], ['学', 1], ['生', 1], ['勉', 1], ['強', 1]])
    const lessons = kanji.map(entry => entry.lesson!)
    expect(lessons).toEqual([...lessons].sort((a, b) => a - b))
    for (const entry of kanji) {
      expect(entry.words.length).toBeGreaterThan(0)
      expect(entry.words.every(word => word.record.ch.includes(entry.character))).toBe(true)
    }
    expect(kanji.find(entry => entry.character === '私')?.words.map(word => word.record.ch)).toContain('私')
  })
  it('gives a kana its sound and romaji, and a kanji its reading through its words', () => {
    expect(kanaSound('か')).toBe('か · ka')
    expect(kanaSound('シ')).toBe('し · shi')
    expect(kanaSound('っ')).toMatch(/^っ · small tsu/)
    expect(kanaSound('私')).toBeUndefined()
    expect(ofGroup('katakana')[0].reading).toBe('あ · a')
    expect(ofGroup('kanji').every(entry => entry.reading === undefined)).toBe(true)
  })
  it('puts the look-up kanji in a group of their own, which also holds the lesson kanji', () => {
    const pack = getPack().writing.characterList!
    expect(ofGroup('kanji-all').length).toBeGreaterThan(1500)
    expect(list.filter(entry => inCharacterGroup(entry, 'all', pack))).toHaveLength(168 + ofGroup('kanji').length)
    expect(list.filter(entry => inCharacterGroup(entry, 'kanji-all', pack))).toHaveLength(ofGroup('kanji').length + ofGroup('kanji-all').length)
    expect(list.filter(entry => inCharacterGroup(entry, 'hiragana', pack))).toHaveLength(84)
  })
  it('puts only kanji into the knowledge set of known words, never kana', () => {
    const word = [...catalog.units.values()].find(unit => unit.kind === 'vocabulary' && /^\p{Script=Han}+$/u.test(unit.record.ch))!
    const set = characterKnowledge(catalog, [{ ref: word.ref, kind: 'vocabulary', lb: word.record.lb, band: word.band, addedAt: 1, source: 'dictionary' }], [])
    expect([...set.all].every(character => /^\p{Script=Han}$/u.test(character))).toBe(true)
  })
  it('searches by character, kana and romaji', () => {
    const rank = (query: string, character: string) => { const row = list.find(entry => entry.character === character)!; return japaneseCharacterSearch(query).rank(row) }
    expect(rank('か', 'か')).toBe(0)
    expect(rank('か', 'カ')).toBe(0)
    expect(rank('ka', 'カ')).toBe(0)
    expect(rank('shi', 'し')).toBe(0)
    expect(rank('私', '私')).toBe(0)
    expect(rank('ka', 'き')).toBeUndefined()
  })
  it('keeps kana out of the writing a Practice session introduces', () => {
    const writing = getPack().writing
    expect(writing.hasGuide('あ')).toBe(true)
    expect(writing.introduces('あ')).toBe(false)
    expect(writing.introducedChars('たべる食')).toEqual(['食'])
    expect(newCharacters(['たべもの食物', 'ひらがな'], [])).toEqual(['食', '物'])
  })
})
