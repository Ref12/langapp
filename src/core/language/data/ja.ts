import index from '../../../data/packs/ja/index.generated.json'
import romajiOverrides from '../../../../curriculum/japanese/authoring/romaji-overrides.json'
import type { PackData } from '../pack-data'

/** The Japanese pack's data (src/data/packs/ja, written by scripts/generate-pack-ja.mjs): one band of 87 lessons, its phrase bank, no practice dataset. */
export const jaData: PackData = {
  catalog: { index, bands: { '1': () => import('../../../data/packs/ja/band-1.generated.json') }, readingJoiner: '' },
  phrases: { bands: { '1': () => import('../../../data/packs/ja/phrases-band-1.json') }, index: () => import('../../../data/packs/ja/phrases-index.json') },
  romaji: romajiOverrides.overrides,
  forms: () => import('../../../data/packs/ja/forms.generated.json'),
  kanjiReadings: () => import('../../../data/packs/ja/kanji-readings.generated.json'),
}
