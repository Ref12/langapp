// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { shippedPhrases } from '../phrases/bank'
import type { BankPhrase } from '../phrases/contracts'
import { loadCatalog, type Catalog } from '../study/catalog'
import { createRng, isVocabulary } from '../study/local-exercises'
import { buildGap, buildTiles, phraseForms, formOf, type FormContext } from './bank-forms'
import { segmentWords } from './grade'

// The Chinese Word order distractors and Fill the gap are what the builders did before the pack answered: the old code, kept here verbatim, against the new output on real phrases.
let catalog: Catalog
let bank: BankPhrase[]
const slot = { id: 'zh-1', stage: 'produce' as const, refs: [], round: 0 }
const rngFor = (context: FormContext, id: string) => createRng(context.seed ^ [...id].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261))
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items]
  for (let index = out.length - 1; index > 0; index--) { const other = Math.floor(rng() * (index + 1)); [out[index], out[other]] = [out[other], out[index]] }
  return out
}
beforeAll(async () => {
  catalog = await loadCatalog()
  bank = Object.values(await shippedPhrases('1')).flat().slice(0, 150)
}, 60000)

describe('Chinese sentence forms are what they were', () => {
  it('Word order: the same wrong tiles', () => {
    const known = [...catalog.units.values()].filter(isVocabulary).slice(0, 80)
    const context: FormContext = { catalog, forms: new Set(), knownUnits: known, bank, seed: 7 }
    let checked = 0
    for (const phrase of bank) {
      const tiles = segmentWords(phrase.zh, phraseForms(context, phrase), phrase.tokens, label => formOf(catalog, 'vocabulary:' + label))
      if (tiles.length < 2 || tiles.length > 14 || tiles.some(tile => tile.length > 12)) continue
      const rng = rngFor(context, slot.id)
      const inside = new Set(tiles)
      const old = shuffle(known.filter(unit => !inside.has(unit.record.ch) && unit.record.ch.length <= 3).map(unit => unit.record.ch).filter(form => !inside.has(form)), rng).slice(0, tiles.length >= 4 ? 2 : 1)
      expect(buildTiles(slot, phrase, context)!.distractors, phrase.zh).toEqual(old)
      checked++
    }
    expect(checked).toBeGreaterThan(50)
  })
  it('Fill the gap: the same blank and the same options', () => {
    const known = [...catalog.units.values()].filter(isVocabulary).slice(0, 120)
    const context: FormContext = { catalog, forms: new Set(), knownUnits: known, bank, seed: 11 }
    let checked = 0
    for (const phrase of bank) for (const ref of phrase.words) {
      const target = formOf(catalog, ref)
      const rng = rngFor(context, slot.id)
      let old: { gapped: string; options: string[]; answer: number } | undefined
      if (target && phrase.zh.includes(target)) {
        const band = Number(catalog.units.get(ref)?.band ?? 1)
        const inPhrase = (form: string) => phrase.zh.includes(form) || form.includes(target) || target.includes(form)
        const pool = shuffle(known, rng).filter(unit => unit.ref !== ref && !inPhrase(unit.record.ch))
          .sort((a, b) => Math.abs(Number(a.band) - band) - Math.abs(Number(b.band) - band) || Math.abs(a.record.ch.length - target.length) - Math.abs(b.record.ch.length - target.length))
        const wrong: string[] = []
        for (const unit of pool) { if (wrong.length >= 3) break; if (!wrong.includes(unit.record.ch)) wrong.push(unit.record.ch) }
        if (wrong.length >= 2) { const options = shuffle([target, ...wrong], rng); old = { gapped: phrase.zh.replace(target, '＿＿'), options, answer: options.indexOf(target) } }
      }
      const built = buildGap(slot, phrase, ref, context)
      expect(built ? { gapped: built.gapped, options: built.options, answer: built.answer } : undefined, phrase.zh + ' ' + ref).toEqual(old)
      if (old) checked++
    }
    expect(checked).toBeGreaterThan(50)
  })
})
