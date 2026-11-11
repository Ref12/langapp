// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPack } from '../language'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { shippedPhrases } from '../phrases/bank'
import type { BankPhrase } from '../phrases/contracts'
import { isVocabulary } from '../study/local-exercises'
import { buildDictation, buildTiles, buildTranslate, type FormContext } from './bank-forms'
import { gradeSentenceMeaning } from './grade'
import type { TextItem, TilesItem } from './types'
let catalog: Catalog
let bank: BankPhrase[]
const slot = { id: 's', stage: 'produce' as const, refs: [], round: 0 }
const find = (zh: string, en?: string) => bank.find(phrase => phrase.zh === zh && (en === undefined || phrase.en === en))!
const context = (): FormContext => {
  const knownUnits = [...catalog.units.values()].filter(isVocabulary).filter(unit => bank.some(phrase => phrase.words.includes(unit.ref)))
  return { catalog, forms: new Set(), knownUnits, bank, seed: 3 }
}
const translate = (zh: string, en?: string) => buildTranslate(slot, 'translate-en-zh', find(zh, en), context()) as TextItem
/** The sentence typed from its English, as the question screen grades it. */
const typed = (item: TextItem, text: string) => getPack().gradeSentence({ text, accepted: item.accepted, spelled: item.spelled, forms: new Set(), optional: item.optional, english: item.prompt })
const built = (item: TilesItem, placed: string[]) => getPack().gradeSentence({ text: placed.join(''), placed, accepted: item.accepted, spelled: item.spelled, forms: new Set(), optional: item.optional, english: item.translation })
const meaning = (zh: string, answer: string, en?: string) => { const phrase = find(zh, en); return gradeSentenceMeaning(answer, [phrase.en], !!getPack().subjectOpen?.(phrase.zh)) }
beforeAll(async () => {
  setBuildLanguageForTests('ko')
  resetCatalogCache()
  catalog = await loadCatalog()
  const all = new Map<string, BankPhrase>()
  for (const band of Object.keys(getPack().phrases.bands)) for (const list of Object.values(await shippedPhrases(band))) for (const phrase of list) all.set(String(phrase.id), phrase)
  bank = [...all.values()]
}, 60000)
afterAll(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('English to Korean: the subject may be left out', () => {
  let item: TextItem
  beforeAll(() => { item = translate('저는 공부해요.') })
  it('a dropped subject is right, with the note and the full sentence', () => {
    expect(item.optional).toEqual(['저는'])
    const result = typed(item, '공부해요')
    expect(result.verdict).toBe('correct')
    expect(result.note).toBe('Right: 저는 may be left out. The full sentence:')
    expect(result.written).toBe('저는 공부해요.')
  })
  it('the subject written another way for I is right', () => {
    for (const text of ['저는 공부해요', '제가 공부해요', '나는 공부해요', '내가 공부해요', '저도 공부해요']) expect(typed(item, text).verdict, text).toBe('correct')
  })
  it('a wrong subject is a difference, and the closest answer is shown', () => {
    for (const text of ['당신은 공부해요', '우리는 공부해요', '그는 공부해요']) {
      const result = typed(item, text)
      expect(result.verdict, text).toBe('diff')
      expect(result.closest).toBe('저는 공부해요.')
    }
  })
  it('a sentence stored without a subject takes the one the English names', () => {
    const cold = translate('조금 추워요.', 'I feel a little cold.')
    expect(typed(cold, '조금 추워요').verdict).toBe('correct')
    expect(typed(cold, '저는 조금 추워요').verdict).toBe('correct')
    expect(typed(cold, '제가 조금 추워요').verdict).toBe('correct')
    expect(typed(cold, '우리는 조금 추워요').verdict).toBe('diff')
    const we = translate('우리는 다 학생이에요.')
    expect(we.optional).toEqual(['우리는'])
    expect(typed(we, '다 학생이에요').verdict).toBe('correct')
    expect(typed(we, '우리는 다 학생이에요').verdict).toBe('correct')
    expect(typed(we, '저희는 다 학생이에요').verdict).toBe('correct')
    expect(typed(we, '저는 다 학생이에요').verdict).toBe('diff')
  })
  it('the subject phrase is a pack table: 우리 and 당신 count, a first word that is not a pronoun does not', () => {
    expect(getPack().optionalWords?.([{ text: '당신', reading: '당신' }, { text: '은', reading: '은', grammar: true }, { text: '학생', reading: '학생' }])).toEqual(['당신은'])
    expect(getPack().optionalWords?.([{ text: '엄마', reading: '엄마' }, { text: '는', reading: '는', grammar: true }, { text: '학생', reading: '학생' }])).toEqual([])
  })
  it('dictation keeps the sentence as written', () => {
    const dictation = buildDictation(slot, find('저는 공부해요.'), context())
    expect(dictation.optional).toBeUndefined()
    expect(getPack().gradeSentence({ text: '공부해요', accepted: dictation.accepted, spelled: dictation.spelled, forms: new Set() }).verdict).toBe('diff')
  })
})

describe('Word order: the leading subject tiles are optional', () => {
  it('저 는 may be left out; a stray particle may not', () => {
    const tiles = buildTiles(slot, find('저는 학생이에요.'), context())!
    expect(tiles.tiles).toEqual(['저', '는', '학생', '이에요'])
    expect(built(tiles, ['저', '는', '학생', '이에요']).verdict).toBe('correct')
    expect(built(tiles, ['학생', '이에요']).verdict).toBe('correct')
    expect(built(tiles, ['는', '학생', '이에요']).verdict).toBe('diff')
    expect(built(tiles, ['저', '학생', '이에요']).verdict).toBe('diff')
  })
})

describe('Korean to English: a sentence with no subject leaves the English subject open', () => {
  it('집에 있어요 and 조금 추워요 take any pronoun', () => {
    for (const answer of ['They are at home.', 'She is at home.', 'I am at home.', 'He is at home', 'We are at home.', 'You are at home.']) expect(meaning('집에 있어요.', answer).verdict, answer).toBe('correct')
    for (const answer of ['I feel a little cold.', 'She feels a little cold.', 'They feel a little cold.']) expect(meaning('조금 추워요.', answer, 'I feel a little cold.').verdict, answer).toBe('correct')
    expect(meaning('집에 있어요.', 'She am at home.').verdict).not.toBe('correct')
  })
  it('a sentence with 저는 keeps its subject', () => {
    expect(meaning('저는 조금 추워요.', 'I feel a little cold.').verdict).toBe('correct')
    expect(meaning('저는 조금 추워요.', 'You feel a little cold.').verdict).not.toBe('correct')
    expect(meaning('우리는 다 학생이에요.', 'They are all students.').verdict).not.toBe('correct')
  })
})
