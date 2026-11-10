import { phrasePinyin } from '../pinyin/phrase'
import { phraseReadingsOf } from '../pinyin/phrase-readings'
import { db } from '../database'
import { loadCatalog, renderExample, type Catalog, type ExampleSegment } from '../study/catalog'
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
      if (row?.text) items.push({ ref, kind: 'phrase', zh: row.text, py: phrasePinyin(row.text, phraseReadingsOf(cat)), en: row.translation ?? '' })
    } else if (isSourceRef(ref)) {
      const row = sourceRows.find(entry => entry?.id === ref.slice('source:'.length))
      if (row) items.push({ ref, kind: 'source', zh: row.word, py: row.pinyin, en: row.meanings.join('; ') })
    }
  }
  return items
}

const exampleIndexes = new WeakMap<Catalog, Map<string, { text: string; pinyin: string; translation: string; /** The vocabulary refs the example is made of. */ words: string[]; /** The grammar refs it demonstrates, where known. */ grammar: string[]; /** The segments it is made of (a pack that cuts sentences by their tokens reads them). */ tokens: ExampleSegment[] }[]>>()

/** Every authored example by the vocabulary refs and grammar labels it uses, built once per catalog. */
function exampleIndex(catalog: Catalog) {
  let index = exampleIndexes.get(catalog)
  if (index) return index
  index = new Map()
  const add = (ref: string, example: { segments: ExampleSegment[]; translation: string; grammar?: string[] }) => {
    try {
      const rendered = renderExample(catalog, example)
      const list = index!.get(ref) ?? []
      list.push({ ...rendered, translation: example.translation, words: example.segments.flatMap(segment => segment.word ? [`vocabulary:${segment.word}`] : []), grammar: (example.grammar ?? []).map(label => `grammar:${label}`), tokens: example.segments })
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

/** Function characters any sentence may use beside the learner's words (particles and pronouns every sentence needs), also what AI practice material may add. */
export const FUNCTION_CHARACTERS = '的了吗呢吧是不很也都和在有这那我你他她们个'
const isFunctionForm = (form: string) => form.length > 0 && Array.from(form).every(char => FUNCTION_CHARACTERS.includes(char))

/** The forms of the vocabulary refs that are not in `allowed` (the learner's words and the run's own); function characters count as allowed, a ref the catalog does not know as unknown. */
export function unknownForms(catalog: Catalog, words: readonly string[], allowed: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const ref of new Set(words)) {
    if (allowed.has(ref)) continue
    const unit = catalog.units.get(ref)
    const form = unit?.kind === 'vocabulary' ? unit.record.ch : ref.replace(/^vocabulary:/, '')
    if (!isFunctionForm(form)) out.push(form)
  }
  return out
}

/**
 * The catalog's own example sentence for an item. Without `allowed`: the shortest that uses it. With the learner's `allowed` set (knowledge set plus the run's own refs), in this order:
 * 1. the shortest authored example whose words are all allowed;
 * 2. for a grammar item, the shortest of `fallback` (usable bank phrases tagged with that grammar point, chosen by the caller);
 * 3. the authored example with the fewest unknown words, then the shortest, marked with the forms the learner doesn't know (`unknown`).
 * Free phrases are their own sentence when they have a translation.
 */
export function catalogSentence(catalog: Catalog, item: ItemInfo, allowed?: ReadonlySet<string>, fallback: readonly { zh: string; py: string; en: string; checked?: boolean }[] = []): Sentence | undefined {
  if (item.kind === 'phrase') return item.en ? { zh: item.zh, py: item.py, en: item.en, source: 'catalog' } : undefined
  if (item.kind === 'source') return undefined
  const examples = [...(exampleIndex(catalog).get(item.ref) ?? [])].sort((a, b) => a.text.length - b.text.length)
  const sentence = (best: (typeof examples)[number], unknown: string[]): Sentence => ({ zh: best.text, py: best.pinyin, en: best.translation, source: 'catalog', ...(unknown.length ? { unknown } : {}) })
  if (!allowed) return examples[0] ? sentence(examples[0], []) : undefined
  const scored = examples.map(example => ({ example, unknown: unknownForms(catalog, example.words, allowed) }))
  const known = scored.find(entry => !entry.unknown.length)
  if (known) return sentence(known.example, [])
  if (item.kind === 'grammar') {
    const phrase = [...fallback].sort((a, b) => a.zh.length - b.zh.length).find(candidate => candidate.en.trim())
    if (phrase) return { zh: phrase.zh, py: phrase.py, en: phrase.en, source: 'ai', ...(phrase.checked ? { checked: true } : {}) }
  }
  const fewest = scored.reduce<(typeof scored)[number] | undefined>((found, entry) => !found || entry.unknown.length < found.unknown.length ? entry : found, undefined)
  return fewest ? sentence(fewest.example, fewest.unknown) : undefined
}

/** A phrase longer than this many syllables is not offered in Hands-free. */
export const MAX_PHRASE_SYLLABLES = 12
/** Every authored example that uses a vocabulary word, with the words and grammar it is made of. */
export const catalogExamples = (catalog: Catalog, ref: string) => exampleIndex(catalog).get(ref) ?? []
