import index from '../../../data/packs/ko/index.generated.json'
import type { PackData } from '../pack-data'

/** The Korean pack's data (src/data/packs/ko, written by scripts/generate-pack-ko.mjs): one band of 87 lessons, its phrase bank, no practice dataset. */
export const koData: PackData = {
  catalog: { index, bands: { '1': () => import('../../../data/packs/ko/band-1.generated.json') }, readingJoiner: '' },
  phrases: { bands: { '1': () => import('../../../data/packs/ko/phrases-band-1.json') }, index: () => import('../../../data/packs/ko/phrases-index.json') },
  forms: () => import('../../../data/packs/ko/forms.generated.json'),
}
