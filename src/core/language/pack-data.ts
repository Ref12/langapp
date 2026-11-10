// What a pack's data looks like to the loaders (types only). Each source hands out lazy loaders of its generated JSON files, so a band file is fetched only when used.

export type JsonLoader = () => Promise<{ default: unknown }>

export interface CatalogIndex { schemaVersion: number; bands: { band: string; alignment: string; vocabulary: number; grammar: number; groups: number }[] }
export type PracticeFileKind = 'accepted' | 'exchanges' | 'grammar' | 'conversations'

export interface CatalogSource {
  /** The small index the catalog reads for its band list and counts (read at once, so keep it small). */
  index: CatalogIndex
  /** The band files (BandData), by band. */
  bands: Record<string, JsonLoader>
  /** What goes between the readings of an example's segments: ' ' for pinyin, '' for kana. */
  readingJoiner: ' ' | ''
}
/** The shipped phrase bank: band files (schema of phrases/contracts.ts shippedBandSchema) and the small count index. */
export interface PhraseBankSource { bands: Record<string, JsonLoader>; index: JsonLoader }
/** The practice dataset: four kinds of band files and the count index. */
export interface PracticeSource { files: Record<PracticeFileKind, Record<string, JsonLoader>>; index: JsonLoader }

export interface PackData {
  catalog: CatalogSource
  phrases: PhraseBankSource
  /** Absent when the language has no dataset: the dataset forms then get no material. */
  practice?: PracticeSource
}
