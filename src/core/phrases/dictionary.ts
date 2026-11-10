import { catalogBandList, renderExample, type Catalog } from '../study/catalog'
import { makeMatcher } from '../dictionary-search'
import { phrasePinyin } from '../pinyin/phrase'
import { phraseReadingsOf } from '../pinyin/phrase-readings'
import { tidyPinyin } from '../drills/items'
import { catalogBankPhrases, shippedPhrases, userBankPhrase, usableFor } from './bank'
import type { BankPhrase, PhraseHeard, UserPhrase } from './contracts'
import { phraseKey } from './key'

// The Dictionary's Phrases section: every phrase of the bank (the catalog's examples, the shipped files, the learner's own) as one list with its state for the learner.
// Drill-set sentences belong to a practice set and are left out. The page only renders what this builds.

/** A phrase with the band it is filed under: the shipped file's band, the example's group band, or for a user phrase the highest band among its words (undefined when it has none). */
export interface PhraseEntry { phrase: BankPhrase; band?: string }

export const PHRASE_SCOPES = ['all', 'ready', 'pending', 'mine'] as const
export type PhraseScope = typeof PHRASE_SCOPES[number]
export const isPhraseScope = (value: string | undefined): value is PhraseScope => PHRASE_SCOPES.includes(value as PhraseScope)

export interface PhraseLink { ref: string; label: string; known: boolean }
export interface PhraseRow {
  phrase: BankPhrase
  band?: string
  /** The phrase's own pinyin, or the catalog reading when it has none. */
  pinyin: string
  words: PhraseLink[]
  grammar: PhraseLink[]
  sourceLabel: string
  /** usableFor against the knowledge set: the rule Hands-free uses. */
  ready: boolean
  missingWords: PhraseLink[]
  missingGrammar: PhraseLink[]
  /** "needs 喝, 水" for a pending phrase, else empty. */
  needs: string
  heard?: Pick<PhraseHeard, 'heard' | 'lastHeardAt'>
  /** The curriculum lesson by which every word and grammar tag is introduced: the shipped readyAt, else worked out from the catalog's group order. */
  lesson: number
}

const lessonIndexes = new WeakMap<Catalog, { index: Map<string, number>; groups: number }>()
/** The position of the first group (lesson) that lists each unit, as the phrase pipeline counts it; a word no group lists comes after every group, a grammar pattern no group lists counts as 0. */
function lessonIndex(catalog: Catalog) {
  let found = lessonIndexes.get(catalog)
  if (!found) {
    const index = new Map<string, number>()
    catalog.orderedGroups.forEach(({ group }, at) => { for (const unit of group.units) { const ref = `${unit.kind}:${unit.ref}`; if (!index.has(ref)) index.set(ref, at) } })
    found = { index, groups: catalog.orderedGroups.length }
    lessonIndexes.set(catalog, found)
  }
  return found
}

/** The lesson index by which every word and grammar tag of a phrase is introduced (the pipeline's readyAtOf). */
export function readyLesson(catalog: Catalog, phrase: Pick<BankPhrase, 'words' | 'grammar' | 'readyAt'>): number {
  if (phrase.readyAt !== undefined) return phrase.readyAt
  const { index, groups } = lessonIndex(catalog)
  return Math.max(0, ...phrase.words.map(ref => index.get(ref) ?? (catalog.units.has(ref) ? groups : 0)), ...(phrase.grammar ?? []).map(ref => index.get(ref) ?? 0))
}

const sourceOrder = (phrase: Pick<BankPhrase, 'source'>) => phrase.source === 'catalog' ? 0 : phrase.source === 'user' ? 2 : 1

const bandRank = (band: string | undefined) => Number.parseInt(band ?? '', 10) || 0

/** The refs' highest band: how a learner's own phrase is filed. */
export function userPhraseBand(catalog: Catalog, words: readonly string[]): string | undefined {
  let top: string | undefined
  for (const ref of words) {
    const band = catalog.units.get(ref)?.band
    if (band && (top === undefined || bandRank(band) > bandRank(top))) top = band
  }
  return top
}

/** The band of every authored example by its text: its group's band, or the grammar entry's own band for the example on a grammar entry. */
function exampleBands(catalog: Catalog): Map<string, string> {
  const bands = new Map<string, string>()
  const note = (example: Parameters<typeof renderExample>[1], band: string) => {
    try { const text = renderExample(catalog, example).text; if (!bands.has(text)) bands.set(text, band) } catch { /* an example that cannot be rendered is not offered */ }
  }
  for (const { band, group } of catalog.orderedGroups) for (const example of group.examples) note(example, band)
  for (const unit of catalog.units.values()) if (unit.kind === 'grammar') note(unit.record.ex, unit.band)
  return bands
}

export interface PhraseSources { catalog: PhraseEntry[]; shipped: PhraseEntry[] }

/** The authored examples that fit, once each, in curriculum order. */
export function catalogEntries(catalog: Catalog): PhraseEntry[] {
  const bands = exampleBands(catalog)
  const seen = new Set<string>()
  const out: PhraseEntry[] = []
  for (const unit of catalog.units.values()) {
    if (unit.kind !== 'vocabulary') continue
    for (const phrase of catalogBankPhrases(catalog, unit.ref)) {
      if (seen.has(phraseKey(phrase.zh))) continue
      seen.add(phraseKey(phrase.zh))
      out.push({ phrase, band: bands.get(phrase.zh) ?? userPhraseBand(catalog, phrase.words) })
    }
  }
  return out
}

const loaded = new WeakMap<Catalog, Promise<PhraseSources>>()
const ready = new WeakMap<Catalog, PhraseSources>()

/** The catalog's examples and every shipped band file (loaded here, the first time the Phrases section is used). Drill sentences are not part of it. */
export function loadPhraseSources(catalog: Catalog): Promise<PhraseSources> {
  let pending = loaded.get(catalog)
  if (!pending) {
    pending = (async () => {
      const shipped: PhraseEntry[] = []
      for (const band of catalogBandList()) {
        const seen = new Set<BankPhrase>()
        for (const list of Object.values(await shippedPhrases(band))) for (const phrase of list) if (!seen.has(phrase)) seen.add(phrase)
        for (const phrase of [...seen].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) if (phrase.source !== 'drill') shipped.push({ phrase, band })
      }
      const sources = { catalog: catalogEntries(catalog), shipped }
      ready.set(catalog, sources)
      return sources
    })()
    loaded.set(catalog, pending)
  }
  return pending
}

/** The sources when they have been loaded already, else undefined. Never starts a load. */
export const peekPhraseSources = (catalog: Catalog | undefined) => catalog ? ready.get(catalog) : undefined

/** One list without duplicates by Han characters (see phraseKey), the first source winning as in loadBank: catalog examples, then the learner's own, then the shipped bank. */
export function mergePhrases(catalog: Catalog, sources: PhraseSources, own: readonly UserPhrase[]): PhraseEntry[] {
  const seen = new Set<string>()
  const out: PhraseEntry[] = []
  const user = own.map(row => ({ phrase: userBankPhrase(row), band: userPhraseBand(catalog, row.words) }))
  for (const entry of [...sources.catalog, ...user, ...sources.shipped]) {
    if (seen.has(phraseKey(entry.phrase.zh))) continue
    seen.add(phraseKey(entry.phrase.zh))
    out.push(entry)
  }
  return out
}

const refLabel = (catalog: Catalog, ref: string) => {
  const unit = catalog.units.get(ref)
  return unit ? (unit.kind === 'vocabulary' ? unit.record.ch : unit.record.pt) : ref.slice(ref.indexOf(':') + 1)
}

export function sourceLabel(phrase: Pick<BankPhrase, 'source' | 'ref'>): string {
  if (phrase.source === 'catalog') return 'Lesson example'
  if (phrase.source === 'ai') return 'Generated'
  if (phrase.source === 'user') return 'Added by me'
  const ref = phrase.ref
  if (!ref) return phrase.source === 'book' ? 'Book' : phrase.source === 'media' ? 'Media' : phrase.source
  return [ref.title, ref.chapter !== undefined ? `ch. ${ref.chapter}` : '', ref.page !== undefined ? `p. ${ref.page}` : '', ref.timestamp !== undefined ? `@ ${ref.timestamp}` : ''].filter(Boolean).join(', ')
}

/** Each phrase with its state for a learner: ready by the Hands-free rule (usableFor), else what is missing. */
export function buildPhraseRows(catalog: Catalog, entries: readonly PhraseEntry[], known: ReadonlySet<string>, heard: ReadonlyMap<string, Pick<PhraseHeard, 'heard' | 'lastHeardAt'>> = new Map()): PhraseRow[] {
  const readings = phraseReadingsOf(catalog)
  const built = entries.map(({ phrase, band }) => {
    const link = (ref: string): PhraseLink => ({ ref, label: refLabel(catalog, ref), known: known.has(ref) })
    const words = phrase.words.map(link)
    const grammar = (phrase.grammar ?? []).map(link)
    const isReady = usableFor(phrase, known)
    const missingWords = words.filter(word => !word.known)
    // an authored example's grammar tags are not required to be known
    const missingGrammar = phrase.source === 'catalog' ? [] : grammar.filter(item => !item.known)
    const needs = isReady ? '' : missingWords.length + missingGrammar.length ? `needs ${[...missingWords, ...missingGrammar].map(item => item.label).join(', ')}` : 'no catalog words to check'
    return { phrase, band, pinyin: tidyPinyin(phrase.py.trim() || phrasePinyin(phrase.zh, readings)), words, grammar, sourceLabel: sourceLabel(phrase), ready: isReady, missingWords, missingGrammar, needs, heard: heard.get(phrase.zh), lesson: readyLesson(catalog, phrase) }
  })
  // earliest lesson first; on a tie lesson examples, then generated phrases (and book or media ones), then the learner's own; then the order they came in
  return built.map((row, at) => ({ row, at })).sort((a, b) => a.row.lesson - b.row.lesson || sourceOrder(a.row.phrase) - sourceOrder(b.row.phrase) || a.at - b.at).map(item => item.row)
}

export interface PhraseFilter { scope?: PhraseScope; band?: string; query?: string; formOf?: (ref: string) => string | undefined }

/** Rows matching band and search (formOf maps a vocabulary ref to its Chinese, to rank phrases that use the searched word as a word first), not yet by scope; search ranks like the vocabulary search (Chinese, toneless pinyin, English), best first. */
export function filterPhraseRows(rows: readonly PhraseRow[], { band = 'all', query = '', formOf }: Omit<PhraseFilter, 'scope'>): PhraseRow[] {
  const matcher = makeMatcher(query)
  const wanted = query.trim()
  const found: { row: PhraseRow; rank: number; at: number }[] = []
  rows.forEach((row, at) => {
    if (band !== 'all' && row.band !== band) return
    const rank = matcher.empty ? 0 : matcher.rank({ text: [row.phrase.zh], pr: row.pinyin, ds: row.phrase.en })
    if (rank === undefined) return
    // A phrase that uses the searched word as a word (its segmented refs) comes before one that only contains the characters inside other words.
    const asWord = !matcher.empty && !!formOf && row.phrase.words.some(ref => formOf(ref) === wanted)
    found.push({ row, rank: asWord ? -1 : rank, at })
  })
  return found.sort((a, b) => a.rank - b.rank || a.at - b.at).map(item => item.row)
}

export const inPhraseScope = (row: PhraseRow, scope: PhraseScope) => scope === 'all' || (scope === 'ready' ? row.ready : scope === 'pending' ? !row.ready : row.phrase.source === 'user')

export function phraseScopeCounts(rows: readonly PhraseRow[]): Record<PhraseScope, number> {
  return { all: rows.length, ready: rows.filter(row => row.ready).length, pending: rows.filter(row => !row.ready).length, mine: rows.filter(row => row.phrase.source === 'user').length }
}

/** How many phrases use a word (by its vocabulary ref). */
export const phraseCountFor = (entries: readonly PhraseEntry[], ref: string) => entries.filter(entry => entry.phrase.words.includes(ref)).length

/** The Phrases route with the word's Chinese in the search box; a query parameter, so the link can be shared and the back button returns to where it was clicked. */
export const phrasesRouteFor = (ch: string) => `dictionary/phrases/all?q=${encodeURIComponent(ch)}`
