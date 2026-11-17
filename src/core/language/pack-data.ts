// What a pack's data looks like to the loaders (types only). Each source hands out lazy loaders of its generated JSON files, so a band file is fetched only when used.

export type JsonLoader = () => Promise<{ default: unknown }>

export interface CatalogIndex { schemaVersion: number; bands: { band: string; alignment: string; vocabulary: number; grammar: number; groups: number }[] }
export type PracticeFileKind = 'accepted' | 'exchanges' | 'grammar' | 'conversations'

/** One module of a level: a run of consecutive units (`from` to `to`, 1-based inside the level) with a title that says what is learned in it. */
export interface ModuleRecord { id: string; title: string; from: number; to: number }
/** The modules of a pack (src/data/<pack>/modules.generated.json), by level; `band` is the catalog index's `alignment`. */
export interface ModuleFile { schemaVersion: number; bands: { band: string; modules: ModuleRecord[] }[] }

export interface CatalogSource {
  /** The small index the catalog reads for its band list and counts (read at once, so keep it small). */
  index: CatalogIndex
  /** The band files (BandData), by band. */
  bands: Record<string, JsonLoader>
  /** The modules of each level; absent when the pack has no units to group (Korean). Small, so it is read at once like the index. */
  modules?: ModuleFile
  /** What goes between the readings of an example's segments: ' ' for pinyin, '' for kana. */
  readingJoiner: ' ' | ''
}
/** The shipped phrase bank: band files (schema of phrases/contracts.ts shippedBandSchema) and the small count index. */
export interface PhraseBankSource { bands: Record<string, JsonLoader>; index: JsonLoader }
/** The practice dataset: four kinds of band files and the count index. */
export interface PracticeSource { files: Record<PracticeFileKind, Record<string, JsonLoader>>; index: JsonLoader }

/** One row of a pack's forms table (src/data/packs/<language>/forms.generated.json): a word form with a name a learner can read. */
export interface PackForm {
  id: string
  name: string
  /** The ending shown separately from the name, e.g. 〜ます. */
  ending?: string
  /** The kinds of word the form applies to (verb, i-adj, na-adj, noun). */
  kinds: string[]
  /** The kinds in which the word and the ending are one token; in the others the ending stays a separate word (学生 + です). */
  joined: string[]
  /** Kind -> label of the grammar unit that teaches the form (none for the dictionary form). */
  patterns: Record<string, string>
  /** Kind -> the words the form's ending divides into where the romaji is written (the words split off the end of its reading, in order); absent when the ending is one word. */
  apart?: Record<string, string[]>
}

export interface PackData {
  /** Hand-written romaji for readings the letter-for-letter rule gets wrong (a は said wa inside こんにちは); absent when the language has no romaji. */
  romaji?: Readonly<Record<string, string>>
  catalog: CatalogSource
  phrases: PhraseBankSource
  /** Absent when the language has no dataset: the dataset forms then get no material. */
  practice?: PracticeSource
  /** The word forms of the language (a file of { schemaVersion, forms: PackForm[] }); absent when the language has none. */
  forms?: JsonLoader
  /** The kanji reading table (kanji -> [on, kun]; src/data/packs/ja/kanji-readings.generated.json): only the Japanese pack has one, and it is loaded lazily with the catalog. */
  kanjiReadings?: JsonLoader
}
