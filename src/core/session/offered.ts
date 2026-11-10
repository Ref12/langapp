import { DATASET_FORMS, type Form, type Preset } from './types'

// Which exercise forms a build offers. The dataset forms need the pack's practice dataset; a pack without one (Japanese, Korean) never plans, lists or counts them.
// Chinese has a dataset, so every function here returns what it was given.

/** Whether the pack ships a practice dataset (pack.practice): the forms in DATASET_FORMS have material only then. */
export const hasDataset = (pack: { practice?: unknown }): boolean => !!pack.practice

/** Whether a form may be planned, listed in the preset builder or counted in this build. */
export const isFormOffered = (form: Form, pack: { practice?: unknown }): boolean => hasDataset(pack) || !DATASET_FORMS.includes(form)

/** The preset with the forms this build does not offer taken out of every stage (the same object when none is). */
export function offeredPreset(preset: Preset, pack: { practice?: unknown }): Preset {
  if (hasDataset(pack)) return preset
  const forms = Object.fromEntries(Object.entries(preset.forms).map(([stage, list]) => [stage, (list ?? []).filter(form => isFormOffered(form, pack))])) as Preset['forms']
  return { ...preset, forms }
}
