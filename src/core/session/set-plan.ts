import { getPack } from '../language'
import { headwordFor, type HeadwordRecord } from '../forms/display'
import type { Catalog } from '../study/catalog'
import type { ItemInfo } from '../drills/items'
import { loadPracticeData } from '../practice-data'
import { createDatasetSource, datasetAcceptance } from './dataset-source'
import { resolvePreset } from './custom-preset'
import { offeredPreset } from './offered'
import { planSession } from './plan'
import { loadSessionBank } from './sources'
import type { Length, SessionPlan } from './types'

/**
 * The plan of a practice set, as the Start screen and the run build it: the bank, the preset (without the forms this build does not offer), the pack's dataset (none: nothing is requested)
 * and the planner. `shown` is the form the learner chose to see verbs in (a pack that offers none: undefined).
 */
export async function planSetSession(input: { catalog: Catalog; items: ItemInfo[]; refs: readonly string[]; known: ReadonlySet<string>; engine: { preset: string; length: Length; seed: number }; shown?: string }): Promise<SessionPlan> {
  const { catalog, items, known, engine } = input
  const allowed = new Set([...known, ...input.refs])
  const bank = await loadSessionBank(catalog, items, allowed)
  const preset = offeredPreset(resolvePreset(engine.preset), getPack())
  // The shipped dataset (a pack without one has none: nothing is requested); an invalid band file is skipped, never fatal.
  const { data } = await loadPracticeData()
  const offer = getPack().displayForms
  return planSession({ ...(offer && input.shown !== undefined ? { shown: (record: HeadwordRecord) => headwordFor(offer, input.shown!, record) } : {}), intent: 'practice-set', items, length: engine.length, preset, seed: engine.seed, catalog, known, bank: bank.byItem, allBank: bank.all, ...datasetAcceptance(data), dataset: createDatasetSource({ data, catalog, seed: engine.seed, bank: bank.all }) })
}
