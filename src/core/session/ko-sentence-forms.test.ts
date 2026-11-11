// @vitest-environment node
// Word order, Fill the gap, Dictation and English to Korean in a Korean build: every form asks the pack (sentence-forms.ts, japanese-sentence.ts), as in ja-sentence-forms.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPack } from '../language'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, resetCatalogCache, type Catalog } from '../study/catalog'
import { shippedPhrases } from '../phrases/bank'
import type { BankPhrase } from '../phrases/contracts'
import { isVocabulary } from '../study/local-exercises'
import { buildDictation, buildGap, buildTiles, buildTranslate, type FormContext } from './bank-forms'
import { gradeMeaning, segmentWords } from './grade'
import type { GapItem, TextItem, TilesItem } from './types'
let catalog: Catalog
let bank: BankPhrase[]
const slot = { id: 's', stage: 'produce' as const, refs: [], round: 0 }
const find = (zh: string) => bank.find(phrase => phrase.zh === zh)!
const context = (readyAt: number): FormContext => {
  const knownUnits = [...catalog.units.values()].filter(isVocabulary).filter(unit => bank.some(phrase => (phrase.readyAt ?? 999) <= readyAt && phrase.words.includes(unit.ref)))
  return { catalog, forms: new Set(), knownUnits, bank, seed: 3 }
}
const grade = (item: TextItem | TilesItem, text: string, placed?: string[]) => getPack().gradeSentence({ text, placed, accepted: item.accepted, spelled: item.spelled, forms: new Set() })
beforeAll(async () => {
  setBuildLanguageForTests('ko')
  resetCatalogCache()
  catalog = await loadCatalog()
  const all = new Map<string, BankPhrase>()
  for (const band of Object.keys(getPack().phrases.bands)) for (const list of Object.values(await shippedPhrases(band))) for (const phrase of list) all.set(String(phrase.id), phrase)
  bank = [...all.values()]
}, 60000)
afterAll(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('Word order', () => {
  it('lesson 1: a particle is its own tile; the right order is right; a swapped particle is wrong, with the particle feedback; the wrong tile is the swapped particle', () => {
    const item = buildTiles(slot, find('저는 학생이에요.'), context(1))!
    expect(item.tiles).toEqual(['저', '는', '학생', '이에요'])
    expect(item.distractors).toEqual(['은'])
    expect(grade(item, '', ['저', '는', '학생', '이에요']).verdict).toBe('correct')
    const wrong = grade(item, '', ['저', '은', '학생', '이에요'])
    expect(wrong.verdict).toBe('diff')
    expect(wrong.messages.join(' ')).toContain('은 marks the topic after a consonant, but here the sentence needs 는, which marks the topic after a vowel.')
    expect(grade(item, '', ['학생', '는', '저', '이에요']).verdict).toBe('diff')
  })
  it('lesson 38: a word between spaces is a tile, a conjugated word is one tile, the topic particle is swapped', () => {
    const item = buildTiles(slot, find('저는 병원에 갈 거예요.'), context(40))!
    expect(item.tiles).toEqual(['저', '는', '병원', '에', '갈', '거예요'])
    expect(item.distractors).toEqual(['은'])
    expect(grade(item, '', item.tiles).verdict).toBe('correct')
    const order = grade(item, '', ['는', '저', '병원', '에', '갈', '거예요'])
    expect(order.verdict).toBe('diff')
    expect(order.messages).toEqual(['All the words are there, but the order is different.'])
  })
  it('a token of several words (공부하지 않아요) is cut at its spaces, so no tile holds a space', () => {
    const item = buildTiles(slot, find('저는 중국어를 공부하지 않아요.'), context(99))!
    expect(item.tiles).toEqual(['저', '는', '중국어', '를', '공부하지', '않아요'])
    expect(grade(item, '', item.tiles).verdict).toBe('correct')
  })
  it('the object particles are swapped too (을 for 를), and 에게 for 한테', () => {
    const item = buildTiles(slot, find('저는 중국어를 공부하지 않아요.'), context(99))!
    expect(grade(item, '', ['저', '는', '중국어', '을', '공부하지', '않아요']).messages.join(' ')).toContain('을 marks the object after a consonant, but here the sentence needs 를')
    expect(buildTiles(slot, find('엄마에게 만두를 만들어 줘요.'), context(99))!.distractors).toEqual(['한테'])
  })
  it('a sentence with the same word twice is right whichever of the two tiles is placed first', () => {
    const twice = bank.map(phrase => ({ phrase, item: buildTiles(slot, phrase, context(99)) })).filter(({ item }) => item && new Set(item.tiles).size < item.tiles.length)
    expect(twice.length).toBeGreaterThan(0)
    for (const { item } of twice) {
      const all = [...item!.tiles, ...item!.distractors]
      const dup = all.findIndex((tile, index) => all.indexOf(tile) !== index)
      const first = all.indexOf(all[dup])
      const place = (order: number[]) => order.map(index => all[index])
      const model = item!.tiles.map((_, index) => index)
      const swapped = model.map(index => index === first ? dup : index === dup ? first : index)
      expect(grade(item!, '', place(model)).verdict).toBe('correct')
      expect(grade(item!, '', place(swapped)).verdict).toBe('correct')
    }
  })
})

describe('Word order: why it is wrong', () => {
  const item = () => buildTiles(slot, find('저는 학생이에요.'), context(1))!
  const notes = (placed: string[]) => grade(item(), '', placed).messages.join(' ')
  it('the same tiles in another order get the order note, not a particle note', () => {
    expect(notes(['이에요', '학생', '는', '저'])).toBe('All the words are there, but the order is different.')
    expect(notes(['학생', '는', '저', '이에요'])).not.toMatch(/particle/)
  })
  it('a missing particle says a particle is missing, extra or in the wrong place', () => {
    expect(notes(['저', '학생', '이에요'])).toBe('A particle is missing, extra or in the wrong place.')
  })
})

describe('Fill the gap', () => {
  it('finds a conjugated verb through the sentence tokens and blanks it whole; the options are verbs in the same form', () => {
    const item = buildGap(slot, find('저는 공부해요.'), 'vocabulary:gongbuhada--study', context(99)) as GapItem
    expect(item).toBeDefined()
    expect(item.gapped).toBe('저는 ＿＿.')
    expect(item.options[item.answer]).toBe('공부해요')
    expect(item.options.length).toBeGreaterThanOrEqual(3)
    for (const option of item.options) expect(option, option).toMatch(/해요$/)
    expect(new Set(item.options).size).toBe(item.options.length)
  })
  it('a noun is among nouns: no polite expression, no word group with a space, on every seed', () => {
    for (let seed = 1; seed < 12; seed++) {
      const item = buildGap(slot, find('저는 학생이에요.'), 'vocabulary:haksaeng--student', { ...context(99), seed }) as GapItem
      expect(item.gapped).toBe('저는 ＿＿이에요.')
      expect(item.options[item.answer]).toBe('학생')
      for (const option of item.options) { expect(option, option).not.toMatch(/요$/); expect(option, option).not.toMatch(/\s/) }
    }
  })
  it('a verb with a helper (사고 싶어요) is blanked with its helper and the options carry it too', () => {
    const item = buildGap(slot, find('저는 싼 물건을 사고 싶어요.'), 'vocabulary:sada--buy', context(99)) as GapItem
    if (!item) return
    expect(item.gapped.replace('＿＿', item.options[item.answer])).toBe('저는 싼 물건을 사고 싶어요.')
    for (const option of item.options) expect(option, option).toMatch(/고 싶어요$/)
  })
  it('every blanked sentence reads back whole, whatever the word', () => {
    const faults: string[] = []
    let blanked = 0
    for (const phrase of bank) for (const word of phrase.words) {
      const item = buildGap(slot, phrase, word, context(99)) as GapItem | undefined
      if (!item) continue
      blanked++
      if (item.gapped.replace('＿＿', item.options[item.answer]) !== phrase.zh) faults.push(phrase.zh + ' / ' + item.gapped)
      if (new Set(item.options).size !== item.options.length) faults.push('repeated option: ' + phrase.zh)
    }
    expect(blanked).toBeGreaterThan(2000)
    expect(faults).toEqual([])
  })
})

describe('a typed Korean sentence', () => {
  let item: TextItem
  beforeAll(() => { item = buildDictation(slot, find('저는 공부해요.'), context(99)) })
  it('is right as written, and punctuation and width do not count', () => {
    for (const text of ['저는 공부해요.', '저는 공부해요', '  저는 공부해요! ', '저는 공부해요.']) { const result = grade(item, text); expect(result.verdict, text).toBe('correct'); expect(result.note, text).toBeUndefined() }
  })
  it('other spacing is right, as almost: the letters are right, mind the spacing', () => {
    for (const text of ['저는공부해요', '저 는 공부해요', '저는 공 부해요.']) {
      const result = grade(item, text)
      expect(result.verdict, text).toBe('correct')
      expect(result.note, text).toBe('Almost: the letters are right, mind the spacing. The sentence as written:')
      expect(result.written, text).toBe('저는 공부해요.')
    }
  })
  it('a wrong particle, a missing word and a wrong order are told apart', () => {
    const particle = grade(item, '저은 공부해요')
    expect(particle.verdict).toBe('diff')
    expect(particle.messages.join(' ')).toContain('needs 는')
    const missing = grade(item, '공부해요')
    expect(missing.verdict).toBe('diff')
    expect(missing.messages.join(' ')).toContain('missing')
    const order = grade(item, '공부해요 저는')
    expect(order.verdict).toBe('diff')
    expect(order.messages.length).toBeGreaterThan(0)
    expect(grade(item, '저는 일해요').verdict).toBe('diff')
  })
  it('Latin letters are not a Korean answer, and no kana rule applies', () => {
    expect(grade(item, 'jeoneun gongbuhaeyo').verdict).toBe('diff')
    expect(grade(item, '\u3057\u3066').verdict).toBe('diff')
  })
  it('dictation does not let the subject go: 저는 is part of what is heard', () => {
    expect(grade(item, '공부해요').verdict).toBe('diff')
  })
  it('English to Korean accepts the sentence without its leading 저는, saying so', () => {
    const built = buildTranslate(slot, 'translate-en-zh', find('저는 공부해요.'), context(99)) as TextItem
    expect(built.optional).toEqual(['저는'])
    const result = getPack().gradeSentence({ text: '공부해요', accepted: built.accepted, spelled: built.spelled, forms: new Set(), optional: built.optional })
    expect(result.verdict).toBe('correct')
    expect(result.note).toBe('Right: 저는 may be left out. The full sentence:')
    expect(result.written).toBe('저는 공부해요.')
    expect(grade(built, '저는 공부해요').verdict).toBe('correct')
    // a wrong word is still wrong without it
    expect(getPack().gradeSentence({ text: '일해요', accepted: built.accepted, spelled: built.spelled, forms: new Set(), optional: built.optional }).verdict).toBe('diff')
  })
  it('only a leading subject is optional: a sentence that starts otherwise offers nothing', () => {
    expect((buildTranslate(slot, 'translate-en-zh', find('엄마에게 만두를 만들어 줘요.'), context(99)) as TextItem).optional).toBeUndefined()
    expect((buildTranslate(slot, 'translate-en-zh', find('그 사람은 저의 남자친구예요.'), context(99)) as TextItem).optional).toBeUndefined()
  })
  it('the sentence is heard in ko-KR', () => {
    expect(getPack().speechLocale).toBe('ko-KR')
    expect(item.hearText).toBe('저는 공부해요.')
  })
})

describe('a typed meaning', () => {
  it('stays wrong for a Korean answer', () => {
    expect(gradeMeaning('학생', ['student']).verdict).toBe('wrong')
    expect(gradeMeaning('student', ['student']).verdict).toBe('correct')
  })
})

describe('every shipped Korean sentence', () => {
  it('has tiles that can be put in an order the marker calls right, and is right typed as written and typed without its spaces', () => {
    expect(bank).toHaveLength(905)
    const unbuildable: string[] = [], unmarkable: string[] = []
    for (const phrase of bank) {
      const ctx = context(99)
      const tiles = buildTiles(slot, phrase, ctx)
      if (!tiles) { const words = segmentWords(phrase.zh, new Set(), phrase.tokens, label => { const unit = catalog.units.get('vocabulary:' + label); return unit?.kind === 'vocabulary' ? unit.record.ch : undefined }); unbuildable.push(phrase.zh + (words.length < 2 ? ' (one word)' : ' (over 14 tiles)')) }
      else if (grade(tiles, '', tiles.tiles).verdict !== 'correct') unmarkable.push('tiles ' + phrase.zh)
      const typed = buildDictation(slot, phrase, ctx)
      const as = grade(typed, phrase.zh)
      if (as.verdict !== 'correct' || as.note) unmarkable.push('as written ' + phrase.zh)
      const joined = grade(typed, phrase.zh.replace(/\s/g, ''))
      if (joined.verdict !== 'correct') unmarkable.push('no spaces ' + phrase.zh)
    }
    expect(unmarkable).toEqual([])
    expect([...unbuildable].sort()).toEqual([...KNOWN_UNBUILDABLE].sort())
  })
})
/** Sentences that cannot be a Word order question, as in Chinese and Japanese: a sentence of one word has no order, and a written-out date has more than 14 tiles. They are still marked typed (above). */
const KNOWN_UNBUILDABLE: string[] = [
  '공부하세요. (one word)',
  '공부하세요? (one word)',
  '공부해요? (one word)',
  '내리세요. (one word)',
  '돌아가요. (one word)',
  '들었어요 (one word)',
  '쉬세요. (one word)',
  '아파요. (one word)',
  '안녕하세요. (one word)',
  '앉으세요. (one word)',
  '여보세요? (one word)',
  '오늘은 이천이십육년 구월 이십이일이에요. (over 14 tiles)',
  '일해요. (one word)',
  '좋아요. (one word)',
  '죄송해요! (one word)',
  '추워요? (one word)',
]
