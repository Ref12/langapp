import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { jaMeta, zhMeta } from '../language/meta'
import type { PackForm } from '../language/pack-data'
import { activeDisplayForm, formOptionLabel, formRows, headwordFor } from './display'

const table = (JSON.parse(readFileSync(join(process.cwd(), 'src/data/packs/ja/forms.generated.json'), 'utf8')) as { forms: PackForm[] }).forms
const offer = jaMeta.displayForms!
const word = (ch: string, pr: string, cl?: string) => ({ ch, pr, ...(cl ? { cl } : {}) })
const study = word('勉強する', 'べんきょうする', 'suru-compound')
const eat = word('食べる', 'たべる', 'ichidan')
const go = word('行く', 'いく', 'godan-iku')
const come = word('来る', 'くる', 'kuru')
const doIt = word('する', 'する', 'suru')
const drink = word('飲む', 'のむ', 'godan-mu')

describe('the pack fields of the display form', () => {
  it('are Japanese only, and agree with the forms table', () => {
    expect(zhMeta.displayForms).toBeUndefined()
    expect(zhMeta.readingStyles).toBeUndefined()
    expect(offer.choices.map(choice => choice.id)).toEqual(['masu', 'dict'])
    expect(offer.default).toBe('masu')
    for (const choice of offer.choices) expect(choice.kinds, choice.id).toEqual(table.find(row => row.id === choice.id)!.joined)
    expect(jaMeta.readingStyles).toMatchObject({ choices: ['kana', 'romaji'], default: 'kana' })
  })
  it('resolve the stored choice against the pack', () => {
    expect(activeDisplayForm(jaMeta, undefined)).toBe('masu')
    expect(activeDisplayForm(jaMeta, 'dict')).toBe('dict')
    expect(activeDisplayForm(jaMeta, 'te')).toBe('masu')
    expect(activeDisplayForm(zhMeta, 'dict')).toBeUndefined()
  })
  it('label the options with the forms table names and a sample', () => {
    expect(formOptionLabel(offer, table, 'masu')).toBe('Polite form (勉強します)')
    expect(formOptionLabel(offer, table, 'dict')).toBe('Dictionary form (勉強する)')
  })
})

describe('headwordFor', () => {
  it('shows verbs in the polite form by default and in the dictionary form when chosen', () => {
    expect(headwordFor(offer, 'masu', study)).toMatchObject({ text: '勉強します', reading: 'べんきょうします' })
    expect(headwordFor(offer, 'masu', eat)).toMatchObject({ text: '食べます', reading: 'たべます' })
    expect(headwordFor(offer, 'masu', go)).toMatchObject({ text: '行きます', reading: 'いきます' })
    expect(headwordFor(offer, 'masu', come)).toMatchObject({ text: '来ます', reading: 'きます' })
    expect(headwordFor(offer, 'masu', doIt)).toMatchObject({ text: 'します', reading: 'します' })
    expect(headwordFor(offer, 'masu', drink)).toMatchObject({ text: '飲みます', reading: 'のみます' })
    expect(headwordFor(offer, 'dict', study)).toMatchObject({ text: '勉強する', reading: 'べんきょうする' })
  })
  it('shows everything else as stored', () => {
    expect(headwordFor(offer, 'masu', word('学生', 'がくせい'))).toMatchObject({ text: '学生', reading: 'がくせい' })
    expect(headwordFor(offer, 'masu', word('寒い', 'さむい', 'i-adj'))).toMatchObject({ text: '寒い', reading: 'さむい' })
    expect(headwordFor(offer, 'masu', word('きれい', 'きれい', 'na-adj'))).toMatchObject({ text: 'きれい', reading: 'きれい' })
    expect(headwordFor(offer, 'masu', word('食べる', 'たべる', 'no-such-class'))).toMatchObject({ text: '食べる', reading: 'たべる' })
    expect(headwordFor(undefined, 'masu', study)).toMatchObject({ text: '勉強する', reading: 'べんきょうする' })
    expect(headwordFor(offer, undefined, study)).toMatchObject({ text: '勉強する', reading: 'べんきょうする' })
  })
})

describe('formRows', () => {
  const rows = (record: ReturnType<typeof word>) => formRows(offer, table, record)
  const text = (record: ReturnType<typeof word>, id: string) => rows(record).find(row => row.id === id)
  it('lists the dictionary form first and then the table order', () => {
    const ids = rows(study).map(row => row.id)
    expect(ids[0]).toBe('dict')
    expect(ids).toEqual(['dict', ...table.filter(row => row.kinds.includes('verb') && row.id !== 'dict').map(row => row.id)])
    expect(rows(study)[0]).toMatchObject({ name: 'dictionary form', text: '勉強する', reading: 'べんきょうする' })
    expect(text(study, 'masu')).toMatchObject({ name: 'polite form', text: '勉強します', pattern: 'v-masu--polite' })
  })
  it('builds the forms of the checked words', () => {
    expect(text(go, 'te')).toMatchObject({ text: '行って', reading: 'いって' })
    expect(text(go, 'te')!.text).not.toBe('行いて')
    expect(text(come, 'masu')).toMatchObject({ text: '来ます', reading: 'きます' })
    expect(text(come, 'nai')).toMatchObject({ text: '来ない', reading: 'こない' })
    expect(text(doIt, 'te')!.text).toBe('して')
    expect(text(drink, 'te')!.text).toBe('飲んで')
    expect(text(eat, 'nai')!.text).toBe('食べない')
  })
  it('has no rows for a noun, and rows for an adjective from the same table', () => {
    expect(rows(word('学生', 'がくせい'))).toEqual([])
    expect(formRows(undefined, table, study)).toEqual([])
    expect(formRows(offer, undefined, study)).toEqual([])
    const adjective = rows(word('寒い', 'さむい', 'i-adj'))
    expect(adjective[0]).toMatchObject({ id: 'adj-plain', text: '寒い' })
    expect(adjective.find(row => row.id === 'adj-past')).toMatchObject({ text: '寒かった', reading: 'さむかった' })
    expect(adjective.some(row => row.id === 'masu')).toBe(false)
  })
})

describe('compound headwords and the する romaji split', () => {
  it('show the polite form for 授業を受ける, 電話をかける, 雨が降る and 運転する', () => {
    const words = JSON.parse(readFileSync('src/data/packs/ja/band-1.generated.json', 'utf8')).vocabulary as { ch: string; pr: string; cl?: string }[]
    const shown = ['授業を受ける', '電話をかける', '雨が降る', '運転する'].map(ch => headwordFor(offer, 'masu', words.find(word => word.ch === ch)!).text)
    expect(shown).toEqual(['授業を受けます', '電話をかけます', '雨が降ります', '運転します'])
  })
  it('cut a する compound for its romaji, in every form, from the class', () => {
    expect(headwordFor(offer, 'masu', { ch: '勉強する', pr: 'べんきょうする', cl: 'suru-compound' }).parts).toEqual(['べんきょう', 'します'])
    expect(headwordFor(offer, 'dict', { ch: '勉強する', pr: 'べんきょうする', cl: 'suru-compound' }).parts).toEqual(['べんきょう', 'する'])
    expect(headwordFor(offer, 'masu', { ch: '食べる', pr: 'たべる', cl: 'ichidan' }).parts).toBeUndefined()
    expect(formRows(offer, table, study).find(row => row.id === 'masu')?.parts).toEqual(['べんきょう', 'します'])
  })
})
