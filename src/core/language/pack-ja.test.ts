// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildJaPack, gapsMarkdown, REGISTRY_FILE, SHORT_TEXTS_FILE, EXPLANATIONS_FILE } from '../../../scripts/generate-pack-ja.mjs'
import { setBuildLanguageForTests } from '../storage-names'
import { loadCatalog, renderExample, resetCatalogCache, catalogBandList, catalogCounts, type BandData, type Catalog } from '../study/catalog'
import { unitLabelSchema, unitRef } from '../study/contracts'
import { loadPhraseIndex } from '../phrases'
import { shippedPhrases } from '../phrases/bank'
import { loadPracticeData, loadPracticeIndex } from '../practice-data'
import { getPack } from '.'
import { forms as buildForm } from '../forms'
import jaForms from '../../data/packs/ja/forms.generated.json'
import type { PackForm } from './pack-data'
import { grammarLabel } from '../../data/tracks'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const onDisk = (path: string) => readFileSync(root + path, 'utf8').replace(/\r\n/g, '\n')
const pack = buildJaPack(root)
const band = pack.band as BandData & { schemaVersion: 1 }

afterEach(() => { setBuildLanguageForTests(undefined); resetCatalogCache() })

describe('the Japanese pack generator', () => {
  it('is deterministic and its output equals the committed files', () => {
    const again = buildJaPack(root)
    expect([...again.files.keys()]).toEqual([...pack.files.keys()])
    for (const [path, text] of pack.files) {
      expect(again.files.get(path) === text, path + ' is deterministic').toBe(true)
      expect(onDisk(path) === text, path + ' equals the committed file').toBe(true)
    }
  })

  it('has a content-gaps report that equals the committed one', () => {
    expect(gapsMarkdown(pack)).toBe(onDisk('docs/audits/2026-11-10-japanese-lesson-content-gaps.md'))
  })

  it('keeps a label registry that agrees with the data, with valid unique labels', () => {
    const registry = JSON.parse(onDisk(REGISTRY_FILE)) as { vocabulary: Record<string, string>; grammar: Record<string, string> }
    for (const [kind, records] of [['vocabulary', band.vocabulary], ['grammar', band.grammar]] as const) {
      const labels = records.map(record => record.lb)
      expect(new Set(labels).size, kind + ' labels are unique').toBe(labels.length)
      for (const record of records) {
        expect(unitLabelSchema.safeParse(record.lb).success, record.lb).toBe(true)
        expect(registry[kind][record.id], record.id).toBe(record.lb)
      }
      expect(Object.keys(registry[kind]).sort()).toEqual(records.map(record => record.id).sort())
    }
  })

  it('does not read or carry Chinese data', () => {
    const text = [...pack.files.values()].join('')
    expect(text).not.toContain('"zh-hsk')
    expect(JSON.stringify(pack.phrases[0])).not.toContain('我是学生')
    const source = readFileSync(root + 'scripts/generate-pack-ja.mjs', 'utf8')
    expect(source).not.toMatch(/from '[^']*(?:core\/parallel|data\/parallel)/)
  })
})

describe('the Japanese build language', () => {
  let catalog: Catalog
  beforeAll(async () => { setBuildLanguageForTests('ja'); catalog = await loadCatalog(); setBuildLanguageForTests(undefined); resetCatalogCache() })
  const ja = () => { setBuildLanguageForTests('ja'); expect(getPack().id).toBe('ja') }

  it('loads 87 groups, 292 vocabulary and 115 grammar units, and counts them from the index', () => {
    ja()
    expect(catalogBandList()).toEqual(['1'])
    expect(catalogCounts).toMatchObject({ vocabulary: 292, grammar: 115, groups: 87 })
    expect(catalog.orderedGroups).toHaveLength(87)
    expect([...catalog.units.values()].filter(unit => unit.kind === 'vocabulary')).toHaveLength(292)
    expect([...catalog.units.values()].filter(unit => unit.kind === 'grammar')).toHaveLength(115)
  })

  it('resolves every unit of every group, none is empty, each has 2 or 3 examples', () => {
    for (const { group } of catalog.orderedGroups) {
      expect(group.units.length, group.id).toBeGreaterThan(0)
      for (const unit of group.units) expect(catalog.units.has(unitRef(unit.kind, unit.ref)), unit.ref).toBe(true)
      expect(group.examples.length, group.id).toBeGreaterThanOrEqual(2)
      expect(group.examples.length, group.id).toBeLessThanOrEqual(3)
    }
  })

  it('renders every example, grammar example and bank phrase to exactly its own text and reading', async () => {
    ja()
    const phrases = Object.values(await shippedPhrases('1')).flat()
    const unique = new Set(phrases)
    expect(unique.size).toBe(822)
    const source = new Map(pack.phrases.map(phrase => [phrase.id, phrase]))
    for (const phrase of unique) {
      const rendered = renderExample(catalog, { segments: phrase.tokens ?? [] })
      expect(rendered.text, 'phrase ' + phrase.id).toBe(phrase.zh)
      expect(rendered.pinyin, 'phrase ' + phrase.id).toBe(phrase.py)
      for (const ref of [...phrase.words, ...(phrase.grammar ?? [])]) expect(catalog.units.has(ref), ref).toBe(true)
      expect(source.get(phrase.id)).toBeDefined()
    }
    const byId = new Map([...unique].map(phrase => ['phrase-' + phrase.id, phrase]))
    for (const { group } of catalog.orderedGroups) for (const example of group.examples) {
      const bank = byId.get(example.id)!
      const rendered = renderExample(catalog, example)
      expect([rendered.text, rendered.pinyin], group.id).toEqual([bank.zh, bank.py])
    }
    for (const unit of catalog.units.values()) if (unit.kind === 'grammar') {
      const rendered = renderExample(catalog, unit.record.ex)
      expect(rendered.text, unit.ref).not.toBe('')
      expect(unit.record.ex.grammar, unit.ref).toContain(unit.record.lb)
    }
  })

  it('gives every pattern a short text and a plain explanation, and rows show the short text', () => {
    const explanations = JSON.parse(onDisk(EXPLANATIONS_FILE)).explanations as Record<string, string>
    const banned = /nonpast|predicate|copula|nominali[sz]|modifier|direct object|topic marker|subject marker|volitional|conjunctive|auxiliary|\bN\b|\bV\b/i
    const grammar = [...catalog.units.values()].filter(unit => unit.kind === 'grammar')
    expect(grammar).toHaveLength(115)
    expect(pack.missingExplanations).toEqual([])
    for (const unit of grammar) {
      if (unit.kind !== 'grammar') continue
      const { st, ds, pt, id } = unit.record
      expect(st, pt).toBeTruthy()
      expect(grammarLabel(pt, unit.record.lb, st), pt).toBe(st + ' (gr.)')
      expect(ds, pt).toBe(explanations[id])
      expect([...ds].length, ds).toBeLessThanOrEqual(60)
      const lowered = ds.replace("A's B", "a's b") // the brief's own wording for 'の'
      expect(lowered, ds).toBe(lowered.toLowerCase())
      expect(ds.endsWith('.'), ds).toBe(false)
      expect(ds, ds).not.toMatch(banned)
    }
    expect(Object.keys(explanations).sort()).toEqual(grammar.map(unit => unit.kind === 'grammar' ? unit.record.id : '').sort())
    expect(JSON.parse(onDisk(SHORT_TEXTS_FILE)).shortTexts).toBeTypeOf('object')
  })

  it('applies the phrase corrections', () => {
    const phrases = new Map(pack.phrases.map(phrase => [phrase.id, phrase]))
    expect(phrases.get(135)).toMatchObject({ zh: '今年は二千二十六年です。', words: expect.arrayContaining(['kotoshi--this-year']) })
    expect(phrases.get(135)!.words).not.toContain('kyou--today')
    expect(phrases.get(781)!.tokens![0]).toMatchObject({ word: 'haha--mother', text: 'お母さん', reading: 'おかあさん' })
    expect(phrases.get(412)!.tokens!.filter(token => token.grammar === 'num-counter--number' && token.text === '人')).toHaveLength(1)
    expect(phrases.get(412)!.words).not.toContain('hito--person')
    const hachihyaku = phrases.get(593)!.tokens!.filter(token => token.word === 'hyaku--hundred')
    expect(hachihyaku).toEqual([{ word: 'hyaku--hundred', text: '八百', reading: 'はっぴゃく' }])
    expect(pack.phrases.some(phrase => phrase.tokens!.some(token => token.word === 'hito--person' && token.text === '人'))).toBe(false)
    for (const phrase of pack.phrases) for (const token of phrase.tokens!) expect(['猫', '犬'], phrase.id + '').not.toContain(token.text)
  })

  it('has a phrase index and no practice dataset (the dataset is empty, not an error)', async () => {
    ja()
    expect((await loadPhraseIndex())?.total).toBe(822)
    const { data, problems } = await loadPracticeData()
    expect(problems).toEqual([])
    expect(data.counts).toEqual({ accepted: 0, exchanges: 0, grammarPoints: 0, nearMisses: 0, conversations: 0 })
    expect((await loadPracticeIndex()).totals.exchanges).toBe(0)
  })

  it('has an empty catalog and phrase bank for the Korean placeholder', async () => {
    setBuildLanguageForTests('ko')
    expect(catalogBandList()).toEqual([])
    expect((await loadCatalog()).orderedGroups).toEqual([])
    expect(await shippedPhrases('1')).toEqual({})
    expect(await loadPhraseIndex()).toBeUndefined()
    expect((await loadPracticeData()).data.counts.exchanges).toBe(0)
  })
})

describe('the Chinese build language', () => {
  it('still reads the v2 catalog, the shipped phrases and the practice dataset', async () => {
    expect(getPack().id).toBe('zh')
    expect(catalogCounts).toMatchObject({ vocabulary: 7122, grammar: 673, groups: 1491 })
    expect((await loadCatalog()).orderedGroups).toHaveLength(1491)
    expect(Object.keys(await shippedPhrases('1')).length).toBeGreaterThan(300)
    expect((await loadPracticeIndex()).totals.exchanges).toBeGreaterThan(0)
  })
})

type Seg = { word?: string; grammar?: string; punctuation?: string; text?: string; reading?: string; form?: string; span?: number }
const segmentsOf = () => pack.phrases.flatMap(phrase => (phrase.tokens as Seg[]).map(segment => ({ phrase: phrase.id as number, segment })))
const record = new Map(band.vocabulary.map(item => [item.lb, item]))
const table = new Map((jaForms.forms as PackForm[]).map(form => [form.id, form]))

describe('a conjugated word is one word in a named form', () => {
  it('has no span, and one segment per merged form with the whole surface and reading', () => {
    const merged = segmentsOf().filter(({ segment }) => segment.form)
    expect(segmentsOf().some(({ segment }) => 'span' in segment)).toBe(false)
    expect(merged).toHaveLength(536)
    for (const { phrase, segment } of merged) {
      expect(segment.word, 'phrase ' + phrase).toBeDefined()
      expect(segment.grammar).toBeUndefined()
      expect(segment.text && segment.reading, 'phrase ' + phrase).toBeTruthy()
      expect(table.get(segment.form!)?.joined.length, segment.form).toBeGreaterThan(0)
    }
    expect(merged.filter(({ segment }) => segment.text === '勉強します' && segment.reading === 'べんきょうします').length).toBeGreaterThan(0)
  })

  it('keeps a noun, a な-adjective and an い-adjective apart from です, and merges the other adjective forms', () => {
    const phrase = pack.phrases.find(item => item.zh === '私は学生です。')!
    expect((phrase.tokens as Seg[]).map(segment => segment.word ?? segment.grammar ?? segment.punctuation)).toEqual(['watashi--i', 'n-wa--topic', 'gakusei--student', 'n-desu--noun', '。'])
    const forms = (id: string) => table.get(id)!
    expect(forms('adj-polite').joined).toEqual([])
    expect(forms('adj-plain').joined).toEqual([])
    expect(forms('adj-neg-polite').joined).toEqual(['i-adj'])
    expect(forms('masu').joined).toEqual(['verb'])
    expect(forms('dict').joined).toEqual([])
    const apart = segmentsOf().filter(({ segment }) => segment.word && record.get(segment.word)?.cl === 'i-adj' && !segment.form).length
    expect(apart).toBeGreaterThan(0)
  })

  it('keeps the pattern a merged form realises in the phrase\'s grammar list, and the form table points at it', () => {
    const labels = new Set(band.grammar.map(item => item.lb))
    for (const phrase of pack.phrases) {
      for (const segment of phrase.tokens as Seg[]) {
        if (!segment.form) continue
        const pattern = Object.values(table.get(segment.form)!.patterns)
        for (const label of pattern) expect(labels.has(label), label).toBe(true)
        const wanted = pattern.filter(label => (phrase.grammar ?? []).includes(label))
        if (['masu', 'teimasu'].includes(segment.form)) expect(wanted.length, 'phrase ' + phrase.id).toBeGreaterThan(0)
      }
    }
  })

  it('names every form of the rules for a learner, with the ending shown separately', () => {
    const rules = JSON.parse(onDisk('src/data/forms/ja.json')) as { forms: Record<string, unknown> }
    expect([...table.keys()].sort()).toEqual(Object.keys(rules.forms).sort())
    for (const form of table.values()) {
      expect(form.name, form.id).toMatch(/^[a-zてA-Z '-]+$/)
      expect(form.name, form.id).not.toMatch(/[〜～ます]/)
      if (form.id !== 'dict') expect(form.ending, form.id).toMatch(/〜/)
    }
    expect(table.get('masu')).toMatchObject({ name: 'polite form', ending: '〜ます', kinds: ['verb'], patterns: { verb: 'v-masu--polite' } })
    expect(table.get('te')!.name).toBe('て form')
    expect(table.get('dict')).toMatchObject({ name: 'dictionary form', patterns: {} })
  })

  it('lists 行く, 来る, 見る and 会う with kanji, as the sentences write them, under the labels they had', () => {
    expect([...['iku--go', 'kuru--come', 'miru--see', 'au--meet']].map(label => [record.get(label)!.ch, record.get(label)!.pr])).toEqual([['行く', 'いく'], ['来る', 'くる'], ['見る', 'みる'], ['会う', 'あう']])
  })

  it('gives each word that inflects its conjugation class, and none to a word that does not', () => {
    const classes = new Set(band.vocabulary.map(item => item.cl).filter(Boolean))
    expect([...classes].sort()).toEqual(['godan-aru', 'godan-bu', 'godan-iku', 'godan-ku', 'godan-mu', 'godan-ru', 'godan-su', 'godan-tsu', 'godan-u', 'i-adj', 'i-adj-ii', 'ichidan', 'kuru', 'na-adj', 'suru', 'suru-compound'])
    expect(record.get('gakusei--student')!.cl).toBeUndefined()
    expect(record.get('taberu--eat')!.cl).toBe('ichidan')
  })

  it('can build every merged segment from the word\'s dictionary form and class (the written form of the sentence for the rest, see below)', () => {
    const verbPart: string[] = []
    const kanaOnly: string[] = []
    for (const { phrase, segment } of segmentsOf()) {
      if (!segment.form) continue
      const item = record.get(segment.word!)!
      const built = buildForm('ja', item.ch, item.cl!, segment.form, { reading: item.pr })
      expect(built, 'phrase ' + phrase + ' ' + segment.form).not.toBeNull()
      if (built!.surface === segment.text && built!.reading === segment.reading) continue
      if (item.ch === item.pr && built!.reading === segment.reading) { kanaOnly.push(item.ch); continue } // listed in kana, written with kanji in the sentence (行きます for いく): the headword overlay makes none
      expect(built!.surface.endsWith(segment.text!) && built!.reading!.endsWith(segment.reading!), 'phrase ' + phrase + ': ' + segment.text + ' vs ' + built!.surface).toBe(true)
      verbPart.push(item.ch) // the item is a phrase (雨が降る) or noun + する whose segment is only the verb part
    }
    expect([...new Set(verbPart)].sort()).toEqual(['運転する', '雨が降る'])
    expect(kanaOnly, 'a verb listed in kana but written with kanji in the sentences (the headword overlay, pack-headwords.json)').toEqual([])
    expect(pack.mismatches.differs).toEqual([])
  })

  it('builds the polite form of every verb in the catalog, with its reading', () => {
    const verbs = band.vocabulary.filter(item => item.cl && !['i-adj', 'i-adj-ii', 'na-adj'].includes(item.cl))
    expect(verbs).toHaveLength(55)
    for (const item of verbs) {
      const built = buildForm('ja', item.ch, item.cl!, 'masu', { reading: item.pr })
      expect(built?.surface, item.lb).toMatch(/ます$/)
      expect(built?.reading, item.lb).toMatch(/ます$/)
    }
    // the irregular classes: ある has no irregular masu, くる/する are built by their own class rows, 雨が降る and 電話をかける are phrases that end in a verb
    expect(buildForm('ja', 'くる', 'kuru', 'masu', { reading: 'くる' })?.reading).toBe('きます')
    expect(buildForm('ja', 'する', 'suru', 'masu')?.surface).toBe('します')
  })
})

describe('one item per meaning with a short gloss', () => {
  it('has a gloss of at most 40 characters in one style', () => {
    for (const item of band.vocabulary) {
      expect(item.ds.length, item.lb).toBeLessThanOrEqual(40)
      expect(item.ds, item.lb).not.toMatch(/[[\]]/)
    }
    const bracketed = band.vocabulary.filter(item => /\(/.test(item.ds)).map(item => item.lb).sort()
    expect(bracketed).toEqual(['aru--exist', 'atsui--hot', 'atsui--hot-2', 'iru--exist'].sort())
    for (const item of band.vocabulary.filter(item => item.cl && !['i-adj', 'i-adj-ii', 'na-adj'].includes(item.cl))) expect(item.ds, item.lb).toMatch(/^to /)
    expect(band.vocabulary.find(item => item.ch === '先生')!.ds).toBe('teacher')
    expect(band.vocabulary.find(item => item.ch === '水')!.ds).toBe('water')
    expect(band.vocabulary.find(item => item.ch === '牛乳')!.ds).toBe('milk')
    expect(band.vocabulary.find(item => item.ch === '働く')!.ds).toBe('to work')
  })
})

describe('pattern names a beginner can read', () => {
  it('follows the convention: English placeholders in angle brackets, Japanese as written, plus signs between the parts', () => {
    const byId = new Map(band.grammar.map(item => [item.id, item]))
    expect(byId.get('ja-n5-g023')!.pt).toBe('<verb> + ます')
    expect(byId.get('ja-n5-g001')!.pt).toBe('<noun> + です')
    expect(byId.get('ja-n5-g003')!.pt).toBe('<sentence> + か')
    expect(byId.get('ja-n5-g020')!.pt).toBe('<い-adjective> + です')
    for (const item of band.grammar) {
      expect(item.pt, item.id).not.toMatch(/[Ｎ＋／（）]|^N|動詞|形容詞/)
      expect(item.pt.length, item.id).toBeLessThanOrEqual(80)
      expect(item.pr, item.id).not.toMatch(/\p{Script=Han}/u)
      if (!/\p{Script=Han}/u.test(item.pt)) expect(item.pr, item.id).toBe(item.pt)
    }
  })
})

