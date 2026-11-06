import { db } from '../database'
import type { Catalog } from '../study/catalog'
import type { DrillSet } from '../drills/contracts'
import { FUNCTION_CHARACTERS } from '../drills/content'
import { catalogExamples, MAX_PHRASE_SYLLABLES } from '../drills/items'
import { createSegmenter } from '../study/exercises'
import { shippedBandSchema, type BankPhrase, type PhraseHeard } from './contracts'

const HAN = /\p{Script=Han}/u
const syllableCount = (zh: string) => Array.from(zh).filter(char => HAN.test(char)).length
const shippedLoaders: Record<string, () => Promise<{ default: unknown }>> = {
  '1': () => import('../../data/phrases/hsk-1.json'), '2': () => import('../../data/phrases/hsk-2.json'), '3': () => import('../../data/phrases/hsk-3.json'),
  '4': () => import('../../data/phrases/hsk-4.json'), '5': () => import('../../data/phrases/hsk-5.json'), '6': () => import('../../data/phrases/hsk-6.json'),
}
const shippedCache = new Map<string, Promise<Record<string, BankPhrase[]>>>()

const bandNumber = (band: string | undefined) => (band ? Number.parseInt(band, 10) || 0 : 0)
/** The shipped band files that can hold a phrase for a word of `from`: that band and the later ones up to the highest band the learner has words in. */
const shippedBands = (from: string, top: number) => Object.keys(shippedLoaders).filter(band => Number(band) >= bandNumber(from) && Number(band) <= Math.max(top, bandNumber(from)))

/** The shipped phrases of a band file by vocabulary ref (a phrase is listed under every word it uses), loaded on first use (a band file is only fetched when needed). */
export function shippedPhrases(band: string): Promise<Record<string, BankPhrase[]>> {
  let pending = shippedCache.get(band)
  if (!pending) {
    const load = shippedLoaders[band]
    pending = (load ? load() : Promise.resolve({ default: { schemaVersion: 2, band, phrases: [] } })).then(module => {
      const parsed = shippedBandSchema.safeParse(module.default)
      if (!parsed.success) return {}
      const byWord: Record<string, BankPhrase[]> = {}
      for (const phrase of parsed.data.phrases) {
        const entry: BankPhrase = {
          id: phrase.id, zh: phrase.zh, py: phrase.py, en: phrase.en, words: phrase.words.map(word => `vocabulary:${word}`),
          ...(phrase.grammar?.length ? { grammar: phrase.grammar.map(label => `grammar:${label}`) } : {}), source: phrase.source, ...(phrase.ref ? { ref: phrase.ref } : {}), checked: phrase.checked,
          ...(phrase.lookahead !== undefined ? { lookahead: phrase.lookahead } : {}), ...(phrase.readyAt !== undefined ? { readyAt: phrase.readyAt } : {}),
        }
        for (const word of entry.words) (byWord[word] ??= []).push(entry)
      }
      return byWord
    }).catch(() => ({}))
    shippedCache.set(band, pending)
  }
  return pending
}

/** Every authored example that uses the word and fits (translated, short enough), once each, shortest first. Not just the shortest. */
export function catalogBankPhrases(catalog: Catalog, ref: string): BankPhrase[] {
  const seen = new Set<string>()
  return catalogExamples(catalog, ref).filter(example => example.translation.trim() && syllableCount(example.text) <= MAX_PHRASE_SYLLABLES && !seen.has(example.text) && !!seen.add(example.text))
    .map((example, at) => ({ at, example })).sort((a, b) => syllableCount(a.example.text) - syllableCount(b.example.text) || a.at - b.at)
    .map(({ example }) => ({ zh: example.text, py: example.pinyin, en: example.translation.trim(), words: [...new Set(example.words)], ...(example.grammar.length ? { grammar: example.grammar } : {}), source: 'catalog' as const, checked: true }))
}

/** What a learner's own words are as forms: the vocabulary in `allowed`, with the function characters every sentence may use. */
export function allowedForms(catalog: Catalog, allowed: ReadonlySet<string>) {
  const formToRef = new Map<string, string>()
  for (const ref of allowed) { const unit = catalog.units.get(ref); if (unit?.kind === 'vocabulary' && !formToRef.has(unit.record.ch)) formToRef.set(unit.record.ch, ref) }
  return { formToRef, segmenter: createSegmenter([...formToRef.keys(), ...Array.from(FUNCTION_CHARACTERS)]) }
}

/** The sentences drill sets generated for a word, as phrases: validated against the learner's words the way drill content is (known words and function characters). */
export function drillBankPhrases(sets: readonly Pick<DrillSet, 'content'>[], ref: string, forms: ReturnType<typeof allowedForms>): BankPhrase[] {
  const out: BankPhrase[] = []
  for (const set of sets) {
    const sentence = set.content.sentences[ref]
    if (!sentence || sentence.source !== 'ai' || syllableCount(sentence.zh) > MAX_PHRASE_SYLLABLES || !forms.segmenter.covers(sentence.zh)) continue
    const words = [...new Set(forms.segmenter.segment(sentence.zh).flatMap(form => forms.formToRef.has(form) ? [forms.formToRef.get(form)!] : []))]
    out.push({ zh: sentence.zh, py: sentence.py, en: sentence.en, words: words.includes(ref) ? words : [ref, ...words], source: 'drill', checked: sentence.checked === true })
  }
  return out
}

/**
 * A phrase is usable for a learner only when every word it uses is in the set or in the knowledge set (`allowed`), and, for a phrase that is not a catalog example,
 * every grammar pattern it is tagged with too. (A catalog example's tags are the lesson's authored ones and are not required to be known.)
 */
export const usableFor = (phrase: Pick<BankPhrase, 'words'> & Partial<Pick<BankPhrase, 'grammar' | 'source'>>, allowed: ReadonlySet<string>) =>
  phrase.words.length > 0 && phrase.words.every(word => allowed.has(word)) && (phrase.source === 'catalog' || (phrase.grammar ?? []).every(ref => allowed.has(ref)))

/** Usable phrases per vocabulary word, from the catalog's examples, the shipped bank and the drill sentences, without duplicates (the first source wins). */
export async function loadBank(catalog: Catalog, refs: readonly string[], allowed: ReadonlySet<string>, sets: readonly Pick<DrillSet, 'content'>[]): Promise<Map<string, BankPhrase[]>> {
  const forms = allowedForms(catalog, allowed)
  const topBand = Math.max(0, ...[...allowed].map(ref => bandNumber(catalog.units.get(ref)?.band)))
  const bank = new Map<string, BankPhrase[]>()
  for (const ref of refs) {
    const unit = catalog.units.get(ref)
    if (unit?.kind !== 'vocabulary') continue
    // a phrase sits in the band of the word it uses that is introduced last, so a word's phrases can be in its own band's file or in a later one the learner has reached
    const shipped = (await Promise.all(shippedBands(unit.band, topBand).map(shippedPhrases))).flatMap(index => index[ref] ?? [])
    const seen = new Set<string>()
    const list: BankPhrase[] = []
    for (const phrase of [...catalogBankPhrases(catalog, ref), ...shipped, ...drillBankPhrases(sets, ref, forms)]) {
      if (seen.has(phrase.zh) || !usableFor(phrase, allowed)) continue
      seen.add(phrase.zh)
      list.push(phrase)
    }
    bank.set(ref, list)
  }
  return bank
}

/** The least-heard phrases first (never heard, then fewest times, then longest ago); ties keep the bank's order. */
export function leastHeard<T extends { zh: string }>(phrases: readonly T[], heard: ReadonlyMap<string, Pick<PhraseHeard, 'heard' | 'lastHeardAt'>>): T[] {
  return phrases.map((phrase, at) => ({ phrase, at, log: heard.get(phrase.zh) }))
    .sort((a, b) => (a.log?.heard ?? 0) - (b.log?.heard ?? 0) || (a.log?.lastHeardAt ?? 0) - (b.log?.lastHeardAt ?? 0) || a.at - b.at).map(entry => entry.phrase)
}

export async function heardLog(): Promise<Map<string, PhraseHeard>> {
  return new Map((await db.phraseHeard.toArray()).map(row => [row.zh, row]))
}

/** Records that these phrases were heard (once each per call). */
export async function recordHeard(phrases: readonly string[], now = Date.now()): Promise<void> {
  const unique = [...new Set(phrases)]
  if (!unique.length) return
  await db.transaction('rw', db.phraseHeard, async () => {
    const current = await db.phraseHeard.bulkGet(unique)
    await db.phraseHeard.bulkPut(unique.map((zh, at) => ({ zh, heard: (current[at]?.heard ?? 0) + 1, lastHeardAt: now })))
  })
}
