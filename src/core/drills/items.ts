import { pinyin as toPinyin } from 'pinyin-pro'
import { db } from '../database'
import { loadCatalog, renderExample, type Catalog } from '../study/catalog'
import { isPhraseRef, isSourceRef } from '../study/contracts'
import type { Sentence } from './contracts'

/** One drillable item as the drills see it: Chinese form, pinyin and English gloss, wherever it comes from. */
export interface ItemInfo {
  ref: string
  kind: 'vocabulary' | 'grammar' | 'phrase' | 'source'
  zh: string
  py: string
  en: string
}

/** Resolves refs to display data: curriculum units from the catalog, phrases from study-set items, source words from saved entries. */
export async function loadItems(refs: readonly string[], catalog?: Catalog): Promise<ItemInfo[]> {
  const cat = catalog ?? await loadCatalog()
  const phrases = refs.filter(isPhraseRef)
  const phraseRows = phrases.length ? (await db.collectionItems.where('ref').anyOf(phrases).toArray()) : []
  const sources = refs.filter(isSourceRef)
  const sourceRows = sources.length ? await db.sourceEntries.bulkGet(sources.map(ref => ref.slice('source:'.length))) : []
  const items: ItemInfo[] = []
  for (const ref of refs) {
    const unit = cat.units.get(ref)
    if (unit?.kind === 'vocabulary') items.push({ ref, kind: 'vocabulary', zh: unit.record.ch, py: unit.record.pr, en: unit.record.ds })
    else if (unit) {
      items.push({ ref, kind: 'grammar', zh: unit.record.pt, py: unit.record.pr, en: unit.record.ds })
    } else if (isPhraseRef(ref)) {
      const row = phraseRows.find(item => item.ref === ref)
      if (row?.text) items.push({ ref, kind: 'phrase', zh: row.text, py: toPinyin(row.text, { toneType: 'symbol' }), en: row.translation ?? '' })
    } else if (isSourceRef(ref)) {
      const row = sourceRows.find(entry => entry?.id === ref.slice('source:'.length))
      if (row) items.push({ ref, kind: 'source', zh: row.word, py: row.pinyin, en: row.meanings.join('; ') })
    }
  }
  return items
}

const exampleIndexes = new WeakMap<Catalog, Map<string, { text: string; pinyin: string; translation: string; /** The vocabulary refs the example is made of. */ words: string[] }[]>>()

/** Every authored example by the vocabulary refs and grammar labels it uses, built once per catalog. */
function exampleIndex(catalog: Catalog) {
  let index = exampleIndexes.get(catalog)
  if (index) return index
  index = new Map()
  const add = (ref: string, example: { segments: { word?: string; punctuation?: string }[]; translation: string }) => {
    try {
      const rendered = renderExample(catalog, example)
      const list = index!.get(ref) ?? []
      list.push({ ...rendered, translation: example.translation, words: example.segments.flatMap(segment => segment.word ? [`vocabulary:${segment.word}`] : []) })
      index!.set(ref, list)
    } catch { /* an example that cannot be rendered is not offered */ }
  }
  for (const { group } of catalog.orderedGroups) {
    for (const example of group.examples) {
      for (const segment of example.segments) if (segment.word) add(`vocabulary:${segment.word}`, example)
      for (const label of example.grammar) add(`grammar:${label}`, example)
    }
  }
  for (const unit of catalog.units.values()) {
    if (unit.kind !== 'grammar') continue
    add(unit.ref, unit.record.ex)
    for (const segment of unit.record.ex.segments) if (segment.word) add(`vocabulary:${segment.word}`, unit.record.ex)
  }
  exampleIndexes.set(catalog, index)
  return index
}

/** Pinyin sentences join punctuation to the syllable before it: "wǒ shì xué sheng 。" reads "wǒ shì xué sheng。". */
export const tidyPinyin = (text: string) => text.replace(/\s+([。，、！？；：．,.!?;:)）」』”’])/gu, '$1').replace(/([(（「『“‘])\s+/gu, '$1')

/** The catalog's own example sentence for an item: the shortest that uses it. Free phrases are their own sentence when they have a translation. */
export function catalogSentence(catalog: Catalog, item: ItemInfo): Sentence | undefined {
  if (item.kind === 'phrase') return item.en ? { zh: item.zh, py: item.py, en: item.en, source: 'catalog' } : undefined
  if (item.kind === 'source') return undefined
  const best = [...(exampleIndex(catalog).get(item.ref) ?? [])].sort((a, b) => a.text.length - b.text.length)[0]
  return best ? { zh: best.text, py: best.pinyin, en: best.translation, source: 'catalog' } : undefined
}

/** A lesson phrase longer than this many syllables is not offered in Hands-free. */
export const MAX_PHRASE_SYLLABLES = 12
/**
 * The phrase a lesson shows for a vocabulary word: its shortest authored example (as catalogSentence picks) among those made only of words in `allowed`
 * (the set's own words and the knowledge set), none when there is no such example or it is longer than MAX_PHRASE_SYLLABLES syllables.
 */
export function lessonPhrase(catalog: Catalog, ref: string, allowed: ReadonlySet<string>): { zh: string; en: string } | undefined {
  const best = [...(exampleIndex(catalog).get(ref) ?? [])].filter(example => example.translation.trim() && example.words.every(word => allowed.has(word))).sort((a, b) => a.text.length - b.text.length)[0]
  if (!best || Array.from(best.text).filter(char => /\p{Script=Han}/u.test(char)).length > MAX_PHRASE_SYLLABLES) return undefined
  return { zh: best.text, en: best.translation.trim() }
}
