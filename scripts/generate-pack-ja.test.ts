// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildJaPack, gapsMarkdown, joinsWord, REGISTRY_FILE, SEALED_FILE, sealText } from './generate-pack-ja.mjs'
import { glossWord, patternNameRule, patternSlug, readingOfName, shortGloss } from './pack-ja-names.mjs'
import { romaji } from './generate-pack-ja.mjs'

const dirs: string[] = []
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })
const put = (root: string, path: string, value: unknown) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)) }

/** A small Japanese course in a temporary folder (YAML is a superset of JSON): the entry 時間 is taught in lesson 1 as "time" and again in lesson 2 as "hour". */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pack-ja-'))
  dirs.push(root)
  put(root, 'curriculum/japanese/jlpt-n5/vocabulary.yaml', [
    { id: 'ja-n5-00001', target: '時間', reading: 'じかん', english: '1. time | 2. hour', part_of_speech: 'noun' },
    { id: 'ja-n5-00002', target: '二', reading: 'に', english: '1. two', part_of_speech: 'numeral' },
  ])
  put(root, 'curriculum/japanese/jlpt-n5/grammar.yaml', [{ id: 'ja-n5-g001', pattern: 'Nです', english: 'be a noun' }])
  put(root, 'curriculum/japanese/parallel/entries.yaml', { version: 1, language: 'ja', vocabulary: [], grammar: [] })
  const phrase = (id: number, text: string, reading: string, tokens: unknown[], words: string[]) => ({ id, text, reading, en: 'It is.', tokens, words, grammar: ['ja-n5-g001'], source: 'ai', checked: true })
  put(root, 'curriculum/japanese/parallel/zh-lessons.yaml', {
    version: 1, language: 'ja', last_phrase_id: 2,
    lessons: [
      { number: 1, lesson: 'l1', words: [{ entry: 'ja-n5-00001', gloss: 'time' }], grammar_intro: ['ja-n5-g001'], phrases: [phrase(1, '時間です。', 'じかんです。', [{ t: '時間', w: 'ja-n5-00001' }, { t: 'です', g: 'ja-n5-g001' }, { t: '。' }], ['ja-n5-00001'])] },
      { number: 2, lesson: 'l2', words: [{ entry: 'ja-n5-00002', gloss: 'two' }, { entry: 'ja-n5-00001', gloss: 'hour' }], grammar_intro: [], phrases: [phrase(2, '二時間です。', 'にじかんです。', [{ t: '二', w: 'ja-n5-00002' }, { t: '時間', w: 'ja-n5-00001' }, { t: 'です', g: 'ja-n5-g001' }, { t: '。' }], ['ja-n5-00002', 'ja-n5-00001'])] },
    ],
  })
  return root
}

describe('one item per meaning', () => {
  it('emits two items, with their own labels and ids, for an entry taught in two lessons with different glosses', () => {
    const root = fixture()
    const pack = buildJaPack(root)
    const items = pack.band.vocabulary.filter((record: { ch: string }) => record.ch === '時間')
    expect(items.map((record: { id: string; ds: string }) => [record.id, record.ds])).toEqual([['ja-n5-00001', 'time'], ['ja-n5-00001#2', 'hour']])
    expect(new Set(items.map((record: { lb: string }) => record.lb)).size).toBe(2)
    expect(pack.band.vocabulary).toHaveLength(3)
    // each lesson introduces its own meaning, and a phrase means the meaning of its lesson
    const unitsOf = (n: number) => pack.band.groups[n - 1].units.filter((unit: { kind: string }) => unit.kind === 'vocabulary').map((unit: { ref: string }) => unit.ref)
    expect(unitsOf(1)).toEqual([items[0].lb])
    expect(unitsOf(2)).toContain(items[1].lb)
    const byId = new Map(pack.phrases.map((item: { id: number }) => [item.id, item]))
    expect((byId.get(1) as { words: string[] }).words).toEqual([items[0].lb])
    expect((byId.get(2) as { words: string[] }).words).toContain(items[1].lb)
    expect((byId.get(2) as { words: string[] }).words).not.toContain(items[0].lb)
  })

  it('writes a hand-made gloss over the rule, and refuses a gloss that is too long', () => {
    const root = fixture()
    put(root, 'curriculum/japanese/authoring/pack-gloss-overrides.json', { glosses: { 'ja-n5-00001@2': 'hours (duration)' } })
    expect(buildJaPack(root).band.vocabulary.map((record: { ds: string }) => record.ds)).toContain('hours (duration)')
    put(root, 'curriculum/japanese/authoring/pack-gloss-overrides.json', { glosses: { 'ja-n5-00001': 'x'.repeat(41) } })
    expect(() => buildJaPack(root)).toThrow(/No good gloss/)
  })
})

describe('the label registry is append-only', () => {
  it('fails when a sealed label would change or disappear, and accepts new labels', () => {
    const root = fixture()
    const first = buildJaPack(root)
    put(root, REGISTRY_FILE, first.files.get(REGISTRY_FILE)!)
    put(root, SEALED_FILE, sealText(root))
    expect(() => buildJaPack(root)).not.toThrow()
    const registry = JSON.parse(first.files.get(REGISTRY_FILE)!)
    const changed = structuredClone(registry); changed.vocabulary['ja-n5-00002'] = 'ni--twice'
    put(root, REGISTRY_FILE, changed)
    expect(() => buildJaPack(root)).toThrow(/would change/)
    const gone = structuredClone(registry); delete gone.vocabulary['ja-n5-00002']
    put(root, REGISTRY_FILE, gone)
    expect(() => buildJaPack(root)).toThrow(/missing from the registry/)
    put(root, REGISTRY_FILE, registry)
    // a new entry is appended and sealing keeps the old pairs
    const sealed = JSON.parse(sealText(root))
    expect(sealed.vocabulary).toEqual(registry.vocabulary)
  })

  it('refuses to seal a label that differs from the sealed one', () => {
    const root = fixture()
    const first = buildJaPack(root)
    put(root, REGISTRY_FILE, first.files.get(REGISTRY_FILE)!)
    put(root, SEALED_FILE, sealText(root))
    const registry = JSON.parse(first.files.get(REGISTRY_FILE)!)
    registry.vocabulary['ja-n5-00002'] = 'ni--twice'
    put(root, REGISTRY_FILE, registry)
    expect(() => sealText(root)).toThrow(/would change/)
  })
})

describe('the content gaps report', () => {
  it('lists patterns, forms and words a lesson teaches but its phrases do not use', () => {
    const root = fixture()
    const pack = buildJaPack(root)
    const text = gapsMarkdown(pack)
    expect(text).toContain('## Totals')
    expect(pack.gaps).toHaveLength(2)
    expect(text).not.toContain('\r')
  })
})

describe('the rules of the names', () => {
  it('writes glosses in the Chinese data\'s style', () => {
    expect(shortGloss('1. teacher; instructor; master | 2. doctor')).toBe('teacher; instructor; master')
    expect(shortGloss('water (esp. cool or cold)')).toBe('water')
    expect(shortGloss('rest; take time off', { verb: true })).toBe('to rest; take time off')
    expect(shortGloss('to work; to labor; to labour', { verb: true })).toBe('to work; to labor; to labour')
    expect(shortGloss('a; b; c; d')).toBe('a; b; c')
    expect(shortGloss('x'.repeat(50))).toBeNull()
  })

  it('names patterns by the convention, and leaves what it cannot name to the overlay', () => {
    expect(patternNameRule('動詞ます')).toBe('<verb> + ます')
    expect(patternNameRule('Nです')).toBe('<noun> + です')
    expect(patternNameRule('文＋か')).toBe('<sentence> + か')
    expect(patternNameRule('い形容詞＋です')).toBe('<い-adjective> + です')
    expect(patternNameRule('NのN')).toBe('<noun> + の + <noun>')
    expect(patternNameRule('時間表現＋（は）＋主語＋動詞／主語＋時間表現＋動詞')).toBeNull()
    expect(readingOfName('<noun> + 前に', { 前: 'まえ' })).toBe('<noun> + まえに')
    expect(() => readingOfName('<noun> + 前に')).toThrow()
  })

  it('romanises whole words, not one character at a time', () => {
    expect(romaji('ちょっと')).toBe('chotto')
    expect(romaji('ましょう')).toBe('mashou')
    expect(patternSlug('<verb> + ましょう', romaji)).toBe('v-mashou')
    expect(patternSlug('ちょっと + <adjective>', romaji)).toBe('chotto-adj')
    expect(patternSlug('<noun> + は + <noun> + ではありません', romaji)).toBe('n-wa-n-dewaarimasen')
    expect(() => patternSlug('<noun> + 前', romaji)).toThrow()
    expect(glossWord("I'm sorry; excuse me")).toBe('sorry')
    expect(glossWord("it's okay")).toBe('okay')
  })

  it('joins a verb with every ending, and an い-adjective with all but です', () => {
    expect(joinsWord('verb', 'masu')).toBe(true)
    expect(joinsWord('verb', 'dict')).toBe(false)
    expect(joinsWord('i-adj', 'adj-neg-polite')).toBe(true)
    expect(joinsWord('i-adj', 'adj-polite')).toBe(false)
    expect(joinsWord('na-adj', 'adj-polite')).toBe(false)
    expect(joinsWord('noun', 'adj-sugi')).toBe(true)
  })
})
