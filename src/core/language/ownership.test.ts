import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isChineseRef } from './ownership'
import { jaPack, koPack, zhPack } from './packs'

const labelsOf = (file: string): string[] => {
  const band = JSON.parse(readFileSync(join(process.cwd(), file), 'utf8')) as { vocabulary: { lb: string }[]; grammar: { lb: string }[] }
  return [...band.vocabulary, ...band.grammar].map(record => record.lb)
}
const chinese = [1, 2, 3, 4, 5, 6].flatMap(band => labelsOf('src/data/v2/hsk-' + band + '.generated.json'))

describe('whose a ref is', () => {
  it('recognises every shipped Chinese label as Chinese, and no Japanese or Korean one', () => {
    expect(chinese.length).toBeGreaterThan(7000)
    expect(chinese.filter(label => !isChineseRef('vocabulary:' + label))).toEqual([])
    expect(chinese.filter(label => !isChineseRef('grammar:' + label))).toEqual([])
    for (const language of ['ja', 'ko']) {
      const labels = labelsOf('src/data/packs/' + language + '/band-1.generated.json')
      expect(labels.length).toBeGreaterThan(300)
      expect(labels.filter(label => isChineseRef('vocabulary:' + label) || isChineseRef('grammar:' + label))).toEqual([])
    }
  })

  it('has the Korean and Japanese packs own their plain refs and not the Chinese ones, and the Chinese pack own everything unmarked', () => {
    expect(koPack.ownsRef('vocabulary:haksaeng--student')).toBe(true)
    expect(koPack.ownsRef('vocabulary:ni3--you')).toBe(false)
    expect(koPack.ownsRef('grammar:s-vp--verbal')).toBe(false)
    expect(jaPack.ownsRef('grammar:n1-wa-n2-ni-n3-o-agemasu-kuremasu--give')).toBe(true)
    expect(koPack.ownsRef('source:s1x3')).toBe(false) // Korean has no media area: a source word came from another build
    expect(koPack.foreignRef('source:s1x3')).toBe(true)
    expect(zhPack.ownsRef('source:s1x3')).toBe(true)
    expect(koPack.ownsRef('ko:w:haksaeng--student')).toBe(false)
    expect(zhPack.ownsRef('vocabulary:ni3--you')).toBe(true)
    expect(zhPack.ownsRef('ja:w:watashi--i')).toBe(false)
  })

  it('has only Japanese and Korean call a row foreign, and never a row of their own language', () => {
    expect(koPack.foreignRef('vocabulary:ni3--you')).toBe(true)
    expect(koPack.foreignRef('ja:w:watashi--i')).toBe(true)
    expect(jaPack.foreignRef('ko:g:n-ieyo-n-yeyo--n')).toBe(true)
    expect(koPack.foreignRef('ko:w:haksaeng--student')).toBe(false)
    expect(koPack.foreignRef('vocabulary:haksaeng--student')).toBe(false)
    expect(zhPack.foreignRef('ja:w:watashi--i')).toBe(false)
    expect(zhPack.foreignRef('vocabulary:ni3--you')).toBe(false)
  })
})
