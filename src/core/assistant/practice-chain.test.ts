import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyPracticeEnds,
  addPracticeSelection,
  buildPracticeTracks,
  createPracticePlan,
  getPracticeChunks,
  getPracticePart,
  getPracticePlaylistItems,
  MAX_PRACTICE_CHUNKS,
  mergePracticeChunks,
  movePracticeItem,
  removePracticeSelection,
  splitPracticeChunk,
} from './practice-chain'
import { practiceChainSchema, type PracticePlan, type PracticePlaylistItem } from './practice-chain-contracts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stubWordSegmenter(value: unknown) {
  vi.stubGlobal('Intl', Object.create(Intl, { Segmenter: { value } }))
}

function whole(text: string, romanization?: string): PracticePlan {
  return applyPracticeEnds(createPracticePlan(text, romanization), [Array.from(text).length])
}

function final(plan: PracticePlan, direction: 'forward' | 'backward' = 'forward') {
  const tracks = buildPracticeTracks(plan, direction)
  return tracks[tracks.length - 1]
}

describe('practice chaining playlists', () => {
  it('builds literal forward prefixes and backward suffixes, never reversed words', () => {
    const plan = applyPracticeEnds(createPracticePlan('我喜欢学习汉语。'), [1, 3, 5, 8])
    const forward = buildPracticeTracks(plan, 'forward')
    const backward = buildPracticeTracks(plan, 'backward')
    expect(forward.map(track => track.text)).toEqual(['我', '我喜欢', '我喜欢学习', '我喜欢学习汉语。'])
    expect(backward.map(track => track.text)).toEqual(['汉语。', '学习汉语。', '喜欢学习汉语。', '我喜欢学习汉语。'])
    expect(forward[1].pinyin).toBe('wǒ xǐ huan')
    expect(backward[1].pinyin).toBe('xué xí hàn yǔ。')
    expect(forward.map(track => track.parts.map(part => part.added))).toEqual([
      [true], [false, true], [false, false, true], [false, false, false, true],
    ])
    expect(backward.map(track => track.parts.map(part => part.added))).toEqual([
      [true], [true, false], [true, false, false], [true, false, false, false],
    ])
    expect(final(plan)).toMatchObject({ text: '我喜欢学习汉语。', pinyin: 'wǒ xǐ huan xué xí hàn yǔ。' })
    expect(final(plan, 'backward').pinyin).toBe(final(plan).pinyin)
    for (const track of [...forward, ...backward]) {
      expect(track.parts.map(part => part.text).join('')).toBe(track.text)
      expect(track.parts.filter(part => part.added)).toHaveLength(1)
    }
  })

  it.each(['茶', '咖啡', '你好'])('handles one-character/one-word phrase %s', text => {
    const plan = createPracticePlan(text)
    expect(getPracticeChunks(plan)).toHaveLength(1)
    expect(buildPracticeTracks(plan, 'forward')).toHaveLength(1)
    expect(final(plan).text).toBe(text)
    expect(final(plan, 'backward').text).toBe(text)
  })

  it('suggests natural words and attaches punctuation without speaking standalone symbols', () => {
    const plan = createPracticePlan('“你好”，世界！')
    expect(getPracticeChunks(plan).map(chunk => chunk.text)).toEqual(['“你好”，', '世界！'])
    expect(final(plan).text).toBe('“你好”，世界！')
    expect(final(plan).pinyin).toBe('“nǐ hǎo”，shì jiè！')
  })

  it('attaches opening punctuation to the following word and closing punctuation to the previous one', () => {
    const plan = createPracticePlan('你好，“世界”！')
    expect(getPracticeChunks(plan).map(chunk => chunk.text)).toEqual(['你好，', '“世界”！'])
    expect(final(plan).text).toBe('你好，“世界”！')
  })

  it('keeps original whitespace, Latin runs, numerals, punctuation and supplementary Unicode', () => {
    const text = '  我有 2 个 USB 充电器！🙂\n'
    const plan = createPracticePlan(text)
    expect(plan.units.map(unit => unit.text).join('')).toBe(text)
    expect(plan.units).toHaveLength(Array.from(text).length)
    expect(plan.units.find(unit => unit.text === '🙂')).toEqual({ text: '🙂', pinyin: '🙂' })
    expect(final(plan).text).toBe(text)
    expect(final(plan, 'backward').text).toBe(text)
    expect(final(plan).pinyin).toBe('  wǒ yǒu 2 gè USB chōng diàn qì！🙂\n')
    expect(getPracticeChunks(plan).some(chunk => chunk.text.trim() === 'USB')).toBe(true)
    expect(plan.warnings.join(' ')).toMatch(/numerals.*kept as written/)
  })

  it('does not insert spaces within Latin words or numbers, including direct Han adjacency', () => {
    const plan = createPracticePlan('我用USB3充电。')
    expect(final(plan).pinyin).toBe('wǒ yòng USB3 chōng diàn。')
    const latin = createPracticePlan('Hello 2026!')
    expect(final(latin).pinyin).toBe('Hello 2026!')
  })

  it('keeps non-Mandarin scripts literal with an explicit limitation', () => {
    const plan = createPracticePlan('你好 한국어')
    expect(final(plan).pinyin).toBe('nǐ hǎo 한국어')
    expect(plan.warnings.join(' ')).toMatch(/Other scripts/)
  })
})

describe('custom playlist selections and order', () => {
  const chain = (step: number): PracticePlaylistItem => ({ kind: 'chain', step })
  const selection = (start: number, end: number): PracticePlaylistItem => ({ kind: 'selection', start, end })

  it('inserts before the selected row using exact contextual source readings, never isolated readings', () => {
    const original = applyPracticeEnds(whole('一个不是一样'), [2, 4, 6])
    const plan = addPracticeSelection(original, 0, 1, 1)
    expect(getPracticePlaylistItems(plan)).toEqual([chain(0), selection(0, 1), chain(1), chain(2)])
    expect(getPracticePart(plan, 0, 1)).toEqual({ text: '一', pinyin: 'yí', start: 0, end: 1 })
    expect(buildPracticeTracks(plan, 'forward').map(track => track.text)).toEqual(['一个', '一', '一个不是', '一个不是一样'])
    expect(buildPracticeTracks(plan, 'backward').map(track => track.text)).toEqual(['一样', '一', '不是一样', '一个不是一样'])
    expect(buildPracticeTracks(plan, 'forward')[1]).toEqual({
      item: selection(0, 1), text: '一', pinyin: 'yí',
      parts: [{ text: '一', pinyin: 'yí', start: 0, end: 1, added: true }],
    })
    const provided = addPracticeSelection(whole('行长', 'xíng cháng'), 1, 2, 0)
    expect(buildPracticeTracks(provided, 'forward')[0].pinyin).toBe('cháng')
    expect(original.items).toBeUndefined()
  })

  it('moves every chain/selection row up and down and removes only selected words', () => {
    const plan = addPracticeSelection(applyPracticeEnds(whole('你好世界'), [2, 4]), 1, 2, 1)
    const reordered = movePracticeItem(plan, 2, 0)
    expect(getPracticePlaylistItems(reordered)).toEqual([chain(1), chain(0), selection(1, 2)])
    expect(buildPracticeTracks(reordered, 'forward').map(track => track.text)).toEqual(['你好世界', '你好', '好'])
    expect(buildPracticeTracks(reordered, 'backward').map(track => track.text)).toEqual(['你好世界', '世界', '好'])
    expect(movePracticeItem(reordered, 0, 2)).toEqual(plan)
    expect(movePracticeItem(movePracticeItem(plan, 1, 0), 0, 1)).toEqual(plan)
    expect(removePracticeSelection(reordered, 2).items).toEqual([chain(1), chain(0)])
    expect(() => removePracticeSelection(reordered, 0)).toThrow(/cannot be removed/)
  })

  it('copies all mutable plan arrays, items, and unit objects and supports old plans', () => {
    const original = whole('你好世界')
    const snapshot = structuredClone(original)
    const plan = addPracticeSelection(original, 0, 2, 1)
    const moved = movePracticeItem(plan, 0, 0)
    expect(moved).toEqual(plan)
    for (const key of ['units', 'ends', 'warnings', 'items'] as const) expect(moved[key]).not.toBe(plan[key])
    expect(moved.units[0]).not.toBe(plan.units[0])
    expect(moved.items![0]).not.toBe(plan.items![0])
    const items = getPracticePlaylistItems(moved)
    items[0] = chain(99)
    expect(moved.items).toEqual([chain(0), selection(0, 2)])
    expect(original).toEqual(snapshot)
    expect(getPracticePlaylistItems(original)).toEqual([chain(0)])
    expect(splitPracticeChunk(original, 0, 2).items).toBeUndefined()
  })

  it.each([-1, 0.5, NaN, Infinity, 2])('rejects invalid playlist index %s', index => {
    const plan = whole('你好')
    expect(() => addPracticeSelection(plan, 0, 1, index)).toThrow(/index/)
    expect(() => movePracticeItem(plan, index, 0)).toThrow(/index/)
    expect(() => movePracticeItem(plan, 0, index)).toThrow(/index/)
    expect(() => removePracticeSelection(plan, index)).toThrow(/index/)
  })

  it.each([
    [-1, 1], [0.5, 1], [0, 1.5], [0, 9], [1, 1], [2, 1], [NaN, 1], [0, Infinity],
    [2, 3],
  ])('rejects invalid or nonspoken selection %s:%s', (start, end) => {
    const plan = whole('你好！')
    expect(() => getPracticePart(plan, start, end)).toThrow()
    expect(() => addPracticeSelection(plan, start, end, 0)).toThrow()
    expect(practiceChainSchema.safeParse({ text: '你好！', ends: [3], items: [chain(0), selection(start, end)] }).success).toBe(false)
  })

  it.each([
    ['cafe\u0301茶', 4], ['茶👩‍💻好', 2], ['茶👩‍💻好', 3],
    ['茶👍🏽好', 2], ['茶🇨🇳好', 2], ['茶\r\n好', 2],
    ['茶🏴\u{e0067}\u{e0062}\u{e007f}好', 2],
    ['茶2️⃣好', 2],
  ])('rejects unsafe selection start and end boundaries: %s / %s', (text, offset) => {
    const plan = whole(text)
    expect(() => addPracticeSelection(plan, 0, offset, 0)).toThrow(/safe Unicode/)
    expect(() => addPracticeSelection(plan, offset, plan.units.length, 0)).toThrow(/safe Unicode/)
  })

  it('keeps code-point offsets and exact whitespace, combining marks, and emoji', () => {
    const plan = addPracticeSelection(whole('𠮷 cafe\u0301🙂茶'), 1, 9, 0)
    expect(buildPracticeTracks(plan, 'forward')[0].text).toBe(' cafe\u0301🙂茶')
    expect(getPracticePart(plan, 2, 7).text).toBe('cafe\u0301')
  })

  it.each([
    [], [chain(0)], [chain(0), chain(0)], [chain(0), chain(2)], [chain(0), chain(0.5)],
    [chain(0), chain(1), selection(0, 1), selection(0, 1)],
    [chain(0), { kind: 'chain', step: 1, extra: true }],
    [chain(0), { kind: 'unknown', step: 1 }],
  ].map(items => ({ items })))('rejects malformed explicit playlist %#', ({ items }) => {
    expect(practiceChainSchema.safeParse({ text: '你好', ends: [1, 2], items }).success).toBe(false)
    const plan = { ...applyPracticeEnds(whole('你好'), [1, 2]), items: items as PracticePlaylistItem[] }
    expect(() => buildPracticeTracks(plan, 'forward')).toThrow()
  })

  it('rejects duplicate ranges and enforces the combined 80-row limit during insertion and edits', () => {
    let plan = whole('好'.repeat(80))
    for (let index = 0; index < 79; index++) plan = addPracticeSelection(plan, index, index + 1, 0)
    expect(buildPracticeTracks(plan, 'forward')).toHaveLength(80)
    expect(() => addPracticeSelection(plan, 0, 1, 0)).toThrow(/Duplicate/)
    expect(() => addPracticeSelection(plan, 79, 80, 0)).toThrow()
    expect(() => splitPracticeChunk(plan, 0, 1)).toThrow(/At most 80/)
    expect(() => applyPracticeEnds(plan, [1, 80])).toThrow(/At most 80/)
    expect(splitPracticeChunk(removePracticeSelection(plan, 0), 0, 1).items).toHaveLength(80)
  })

  it('reconciles surviving chain identities and words in relative order and inserts new steps after the last chain', () => {
    const original = applyPracticeEnds(whole('你好世界茶水'), [2, 4, 6])
    const plan = { ...original, items: [selection(0, 1), chain(2), chain(0), selection(2, 4), chain(1), selection(5, 6)] }
    const merged = mergePracticeChunks(plan, 0)
    expect(merged.items).toEqual([selection(0, 1), chain(0), selection(2, 4), chain(1), selection(5, 6)])
    const split = splitPracticeChunk(merged, 0, 2)
    expect(split.items).toEqual([selection(0, 1), chain(0), selection(2, 4), chain(1), chain(2), selection(5, 6)])
    expect(buildPracticeTracks(split, 'backward').filter(track => track.item.kind === 'selection').map(track => track.text)).toEqual(['你', '世界', '水'])
    expect(plan.items).toEqual([selection(0, 1), chain(2), chain(0), selection(2, 4), chain(1), selection(5, 6)])
  })
})

describe('contextual and provided pinyin', () => {
  it('uses full-phrase polyphone readings and preserves them after editing', () => {
    const text = '重庆银行行长喜欢音乐。'
    const plan = whole(text)
    expect(plan.units.map(unit => unit.pinyin)).toEqual([
      'chóng', 'qìng', 'yín', 'háng', 'háng', 'zhǎng', 'xǐ', 'huan', 'yīn', 'yuè', '。',
    ])
    const split = splitPracticeChunk(plan, 0, 3)
    expect(getPracticeChunks(split)[1].pinyin).toBe('háng háng zhǎng xǐ huan yīn yuè。')
    expect(mergePracticeChunks(split, 0)).toEqual(plan)
    expect(plan.warnings.join(' ')).toMatch(/full phrase/)
  })

  it('retains contextual 一/不 tone changes instead of deriving isolated characters', () => {
    expect(final(whole('一个不是一样')).pinyin).toBe('yí gè bú shì yí yàng')
  })

  it.each([
    ['你好，世界！', 'Ní hǎo, shì jiè!', ['Ní', 'hǎo', '，', 'shì', 'jiè', '！']],
    ['我喜欢咖啡。', 'Wǒ xǐhuān kāfēi.', ['Wǒ', 'xǐ', 'huān', 'kā', 'fēi', '。']],
    ['西安', "Xī'ān", ['Xī', 'ān']],
    ['你好', 'ni3 hao3', ['ni3', 'hao3']],
    ['女绿', 'nv3 lu:4', ['nv3', 'lu:4']],
    ['女绿', 'nǚ lǜ', ['nǚ', 'lǜ']],
    ['行长', 'xíng cháng', ['xíng', 'cháng']],
    ['我有2个USB。', 'Wǒ yǒu 2 gè USB.', ['Wǒ', 'yǒu', '2', 'gè', 'U', 'S', 'B', '。']],
  ])('safely aligns provided pinyin for %s: %s', (text, romanization, expected) => {
    const plan = whole(text, romanization)
    expect(plan.units.map(unit => unit.pinyin)).toEqual(expected)
    expect(plan.warnings.join(' ')).not.toMatch(/could not be safely aligned|derived locally/)
    const split = splitPracticeChunk(plan, 0, 1)
    expect(split.units).toEqual(plan.units)
    expect(final(split).pinyin).toBe(final(plan).pinyin)
    expect(mergePracticeChunks(split, 0)).toEqual(plan)
  })

  it.each(['hello world', 'nǐ', 'nǐ hǎo ma', 'nǐ fake', 'nǐ3 hǎo', 'nǐ hǎo6', '', 'x'.repeat(24001)])(
    'rejects unusable romanization without guessing or losing source text (%#)',
    romanization => {
      const plan = createPracticePlan('你好', romanization)
      expect(final(plan).pinyin).toBe('nǐ hǎo')
      expect(plan.warnings.join(' ')).toMatch(/provided romanization could not be safely aligned/)
    },
  )

  it('does not consume omitted or spoken-out mixed numerals as Han syllables', () => {
    const plan = createPracticePlan('我有2个USB', 'wǒ yǒu èr gè')
    expect(final(plan).pinyin).toBe('wǒ yǒu 2 gè USB')
    expect(plan.warnings.join(' ')).toMatch(/could not be safely aligned/)
  })

  it('normalizes decomposed pinyin accents, but never normalizes the original text', () => {
    const text = '女 cafe\u0301'
    const plan = createPracticePlan(text, 'nǚ cafe\u0301')
    expect(final(plan).text).toBe(text)
    expect(plan.units.map(unit => unit.text)).toEqual(Array.from(text))
    expect(createPracticePlan('女', 'nu\u0308\u030c').units[0].pinyin).toBe('nǚ')
  })

  it('warns about unknown Han, including outside the BMP, without inventing a reading', () => {
    const plan = createPracticePlan('𠮷龘𰻞', 'jí dá biáng')
    expect(plan.units).toEqual([
      { text: '𠮷', pinyin: '' }, { text: '龘', pinyin: 'dá' }, { text: '𰻞', pinyin: '' },
    ])
    expect(final(plan).pinyin).toBe('□ dá □')
    expect(final(plan).text).toBe('𠮷龘𰻞')
    expect(plan.warnings.join(' ')).toMatch(/No local pinyin reading.*𠮷.*𰻞/)
    expect(plan.warnings.join(' ')).toMatch(/not guessed/)
  })
})

describe('safe editable and persisted boundaries', () => {
  it('uses relative interior code-point offsets, copying rather than mutating plans', () => {
    const plan = applyPracticeEnds(whole('你好世界'), [2, 4])
    const snapshot = structuredClone(plan)
    const split = splitPracticeChunk(plan, 1, 1)
    expect(split.ends).toEqual([2, 3, 4])
    expect(getPracticeChunks(split).map(chunk => [chunk.text, chunk.start, chunk.end])).toEqual([
      ['你好', 0, 2], ['世', 2, 3], ['界', 3, 4],
    ])
    expect(plan).toEqual(snapshot)
    expect(split.units).not.toBe(plan.units)
    expect(split.units[0]).not.toBe(plan.units[0])
    expect(mergePracticeChunks(split, 1)).toEqual(plan)
  })

  it('counts supplementary characters once and never splits a surrogate pair', () => {
    const plan = whole('茶𠮷好')
    expect(plan.units.map(unit => unit.text)).toEqual(['茶', '𠮷', '好'])
    const split = splitPracticeChunk(plan, 0, 2)
    expect(split.ends).toEqual([2, 3])
    expect(getPracticeChunks(split).map(chunk => chunk.text)).toEqual(['茶𠮷', '好'])
    expect(final(split).text).toBe('茶𠮷好')
    expect(() => applyPracticeEnds(plan, [4])).toThrow(/code-point count|boundaries/)
  })

  it.each([0, -1, 2, 0.5, NaN, Infinity])('rejects invalid relative split offset %s', offset => {
    expect(() => splitPracticeChunk(whole('你好'), 0, offset)).toThrow(/interior/)
  })

  it.each([-1, 1, 0.5, NaN])('rejects invalid chunk or merge boundary %s', index => {
    const plan = whole('你好')
    expect(() => splitPracticeChunk(plan, index, 1)).toThrow(/existing chunk/)
    expect(() => mergePracticeChunks(plan, index)).toThrow(/existing boundary/)
  })

  it('cannot merge a final boundary or leave punctuation-only/whitespace-only chunks', () => {
    expect(() => mergePracticeChunks(whole('你好'), 0)).toThrow(/existing boundary/)
    expect(() => splitPracticeChunk(whole('你好！'), 0, 2)).toThrow(/not only punctuation/)
    expect(() => splitPracticeChunk(whole('  你好'), 0, 2)).toThrow(/not only punctuation/)
    expect(() => applyPracticeEnds(whole('你好，世界'), [2, 3, 5])).toThrow(/not only punctuation/)
  })

  it.each([
    ['cafe\u0301茶', 4],
    ['茶👩‍💻好', 2],
    ['茶👩‍💻好', 3],
    ['茶👍🏽好', 2],
    ['茶🇨🇳好', 2],
    ['茶\r\n好', 2],
  ])('rejects detached combining marks and joined Unicode at %s / %s', (text, end) => {
    expect(() => applyPracticeEnds(whole(text), [end, Array.from(text).length])).toThrow(/safe Unicode/)
  })

  it('accepts saved exact source offsets, including combining and supplementary characters', () => {
    const text = 'cafe\u0301茶𠮷'
    const plan = whole(text)
    const saved = [5, 7]
    const result = applyPracticeEnds(plan, saved)
    saved[0] = 1
    expect(result.ends).toEqual([5, 7])
    expect(final(result).text).toBe(text)
    expect(practiceChainSchema.parse({ text, ends: result.ends })).toEqual({ text, ends: [5, 7] })
  })

  it.each([[], [1], [0, 2], [2, 2], [2, 1], [-1, 2], [1.5, 2], [1, 3], [NaN, 2], [Infinity]].map(ends => ({ ends })))(
    'rejects malformed saved ends $ends', ({ ends }) => {
      const plan = whole('你好')
      expect(() => applyPracticeEnds(plan, ends)).toThrow()
      expect(practiceChainSchema.safeParse({ text: '你好', ends }).success).toBe(false)
    },
  )

  it('makes saved data strict and dictionary-free while rejecting punctuation-only text', () => {
    expect(practiceChainSchema.safeParse({ text: '你好', ends: [2], pinyin: 'nǐ hǎo' }).success).toBe(false)
    expect(practiceChainSchema.safeParse({ text: '？！🙂 ', ends: [4] }).success).toBe(false)
    expect(practiceChainSchema.safeParse({ text: '𠮷好', ends: [1, 2] }).success).toBe(true)
  })

  it.each(['', '   ', '！？', '🙂', '\ud800好', '好\udfff', '好'.repeat(3001)])(
    'rejects empty, nonspoken, invalid Unicode or oversized text (%#)', text => {
      expect(() => createPracticePlan(text)).toThrow()
    },
  )

  it('bounds the existing phrase contract by UTF-16 length, not just code-point count', () => {
    expect(() => createPracticePlan('𠮷'.repeat(1501))).toThrow()
    expect(final(createPracticePlan('好'.repeat(3000))).text).toHaveLength(3000)
  })

  it('caps long suggestions by merging, retains all text, and refuses an 81st manual chunk', () => {
    const text = '你好，'.repeat(MAX_PRACTICE_CHUNKS + 5)
    const plan = createPracticePlan(text)
    expect(plan.ends).toHaveLength(MAX_PRACTICE_CHUNKS)
    expect(final(plan).text).toBe(text)
    expect(final(plan, 'backward').text).toBe(text)
    expect(plan.warnings.join(' ')).toMatch(/merged.*80-chunk/)
    expect(() => splitPracticeChunk(plan, 0, 1)).toThrow(/At most 80/)
    const tooMany = Array.from({ length: MAX_PRACTICE_CHUNKS + 1 }, (_, i) => i + 1)
    expect(practiceChainSchema.safeParse({ text: '好'.repeat(tooMany.length), ends: tooMany }).success).toBe(false)
    const merged = mergePracticeChunks(plan, 0)
    expect(splitPracticeChunk(merged, 0, 1).ends).toHaveLength(MAX_PRACTICE_CHUNKS)
  })

  it('rejects corrupted runtime units and invalid directions visibly', () => {
    const plan = whole('你好')
    expect(() => getPracticeChunks({ ...plan, units: [{ text: '你好', pinyin: 'nǐ hǎo' }] })).toThrow(/exactly one/)
    expect(() => buildPracticeTracks(plan, 'reverse' as 'forward')).toThrow(/direction/)
  })

  it('falls back to library segmentation when native word segmentation is unavailable', () => {
    stubWordSegmenter(undefined)
    const plan = createPracticePlan('你好USB2026，世界！')
    expect(final(plan).text).toBe('你好USB2026，世界！')
    expect(getPracticeChunks(plan).some(chunk => chunk.text.includes('USB2026'))).toBe(true)
  })

  it('falls back conservatively if native segmentation throws or changes source text', () => {
    stubWordSegmenter(class {
      segment() { throw new Error('Unavailable') }
    })
    const failed = createPracticePlan('我喜欢学习汉语。')
    expect(final(failed).text).toBe('我喜欢学习汉语。')
    expect(failed.warnings.join(' ')).toMatch(/segmentation was unavailable/)
    stubWordSegmenter(class {
      segment() { return [{ segment: 'rewritten' }] }
    })
    const changed = createPracticePlan('我喜欢学习汉语。')
    expect(final(changed).text).toBe('我喜欢学习汉语。')
    expect(changed.warnings.join(' ')).toMatch(/segmentation was unavailable/)
  })

  it.each([
    '你好，\r\n  世界！',
    '“茶” （咖啡） [你好] 《中文》',
    '我有3.14元和USB-C。',
    '𠮷，茶👩‍💻咖啡👍🏽好🇨🇳！',
    'cafe\u0301，茶2️⃣水\u200d好',
    ' \n茶\u200d好，🙂',
  ])('keeps every code point and pinyin invariant under all suggested merges: %s', text => {
    let plan = createPracticePlan(text)
    const original = final(plan)
    expect(practiceChainSchema.safeParse({ text, ends: plan.ends }).success).toBe(true)
    while (plan.ends.length > 1) {
      plan = mergePracticeChunks(plan, 0)
      expect(final(plan).text).toBe(text)
      expect(final(plan).pinyin).toBe(original.pinyin)
      expect(final(plan, 'backward').pinyin).toBe(original.pinyin)
    }
  })
})
