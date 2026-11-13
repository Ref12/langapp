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
  setBuildLanguageForTests('ja')
  resetCatalogCache()
  catalog = await loadCatalog()
  const all = new Map<string, BankPhrase>()
  for (const band of Object.keys(getPack().phrases.bands)) for (const list of Object.values(await shippedPhrases(band))) for (const phrase of list) all.set(String(phrase.id), phrase)
  bank = [...all.values()]
}, 60000)
afterAll(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

const LEFT_OUT = 'Right: 私は may be left out. The full sentence:'

describe('English to Japanese: the subject may be left out', () => {
  let item: TextItem
  beforeAll(() => { item = translate('私は学生です。') })
  it('a dropped subject is right, with the note and the full sentence', () => {
    expect(item.prompt).toBe('I am a student.')
    expect(item.optional).toEqual(['私は'])
    const result = typed(item, '学生です。')
    expect(result.verdict).toBe('correct')
    expect(result.note).toBe(LEFT_OUT)
    expect(result.written).toBe('私は学生です。')
    expect(typed(item, 'がくせいです').verdict).toBe('correct')
  })
  it('the sentence as written is right, and so is the subject written another way for I', () => {
    expect(typed(item, '私は学生です。').verdict).toBe('correct')
    for (const text of ['わたしは学生です', '僕は学生です', '私が学生です', '私も学生です']) expect(typed(item, text).verdict, text).toBe('correct')
  })
  it('a wrong subject is a difference, and the closest answer is shown', () => {
    for (const text of ['あなたは学生です', '彼は学生です', '私たちは学生です']) {
      const result = typed(item, text)
      expect(result.verdict, text).toBe('diff')
      expect(result.closest).toBe('私は学生です。')
    }
    expect(typed(item, '先生です').verdict).toBe('diff')
  })
  it('a sentence stored without a subject takes the one the English names', () => {
    const open = translate('勉強します。')
    expect(open.prompt).toBe('(You) study.')
    expect(open.optional).toBeUndefined()
    expect(typed(open, '勉強します').verdict).toBe('correct')
    expect(typed(open, 'あなたは勉強します').verdict).toBe('correct')
    expect(typed(open, '私は勉強します').verdict).toBe('diff')
    const first = translate('学生です。')
    expect(typed(first, 'あなたは学生です').verdict).toBe('correct')
    expect(typed(first, '私は学生です').verdict).toBe('diff')
    const we = translate('私は勉強します。')
    expect(typed(we, '勉強します').verdict).toBe('correct')
    expect(typed(we, '私たちは勉強します').verdict).toBe('diff')
  })
  it('the subject phrase is a pack table, not the grader: 私たちは is one subject phrase', () => {
    expect(getPack().optionalWords?.([{ text: '私たち', reading: 'わたしたち' }, { text: 'は', reading: 'は', grammar: true }, { text: '学生', reading: 'がくせい' }])).toEqual(['私たちは'])
    expect(getPack().optionalWords?.([{ text: '今', reading: 'いま' }, { text: 'は', reading: 'は', grammar: true }, { text: '学生', reading: 'がくせい' }])).toEqual([])
  })
  it('dictation keeps the sentence as written: the subject is audible', () => {
    const dictation = buildDictation(slot, find('私は勉強します。'), context())
    expect(dictation.optional).toBeUndefined()
    const result = getPack().gradeSentence({ text: '勉強します', accepted: dictation.accepted, spelled: dictation.spelled, forms: new Set(), optional: dictation.optional })
    expect(result.verdict).toBe('diff')
    expect(getPack().gradeSentence({ text: '私は勉強します', accepted: dictation.accepted, spelled: dictation.spelled, forms: new Set() }).verdict).toBe('correct')
  })
})

describe('Word order: the leading subject tiles are optional', () => {
  let tiles: TilesItem
  beforeAll(() => { tiles = buildTiles(slot, find('私は学生です。'), context())! })
  it('the stored order and the order without 私 は are right; one tile left out of the rest is not', () => {
    expect(tiles.tiles).toEqual(['私', 'は', '学生', 'です'])
    expect(built(tiles, ['私', 'は', '学生', 'です']).verdict).toBe('correct')
    const result = built(tiles, ['学生', 'です'])
    expect(result.verdict).toBe('correct')
    expect(result.note).toBe(LEFT_OUT)
    expect(built(tiles, ['は', '学生', 'です']).verdict).toBe('diff')
    expect(built(tiles, ['私', '学生', 'です']).verdict).toBe('diff')
    expect(built(tiles, ['です']).verdict).toBe('diff')
  })
})

describe('Japanese to English: a sentence with no subject leaves the English subject open', () => {
  it('勉強します is right with any pronoun and the agreement that follows', () => {
    for (const answer of ['I study.', 'You study.', 'He studies.', 'She studies.', 'It studies.', 'We study.', 'They study', 'she studies']) {
      const result = meaning('勉強します。', answer)
      expect(result.verdict, answer).toBe('correct')
    }
    expect(meaning('勉強します。', 'She studies.').note).toContain('No subject')
    for (const answer of ['She study.', 'I studies.', 'She works.', 'Study.']) expect(meaning('勉強します。', answer).verdict, answer).not.toBe('correct')
  })
  it('学生です and 友達がいます follow be and have', () => {
    expect(meaning('学生です。', 'She is a student.').verdict).toBe('correct')
    expect(meaning('学生です。', 'I am a student.').verdict).toBe('correct')
    expect(meaning('学生です。', 'I is a student.').verdict).not.toBe('correct')
    expect(meaning('友達がいます。', 'She has friends.').verdict).toBe('correct')
    expect(meaning('友達がいます。', 'We have friends.').verdict).toBe('correct')
  })
  it('a sentence with 私は keeps its subject: You study. is a difference', () => {
    expect(meaning('私は勉強します。', 'I study.').verdict).toBe('correct')
    expect(meaning('私は勉強します。', 'You study.').verdict).not.toBe('correct')
    expect(meaning('私は学生です。', 'You are a student.').verdict).not.toBe('correct')
    expect(meaning('私は勉強します。', 'You study.').note).toBeUndefined()
  })
})
