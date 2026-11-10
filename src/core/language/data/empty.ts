import type { PackData } from '../pack-data'

/** A pack with no data: an empty catalog (no bands), no shipped phrases, no dataset. The placeholder packs and a build that left a language's data out use it. */
export const emptyData: PackData = {
  catalog: { index: { schemaVersion: 1, bands: [] }, bands: {}, readingJoiner: ' ' },
  phrases: { bands: {}, index: () => Promise.reject(new Error('This language has no phrase bank.')) },
}
