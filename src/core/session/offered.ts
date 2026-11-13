import { DATASET_FORMS, TONE_FORMS, WORD_FORMS, type Form, type Preset } from './types'

// Which exercise forms a build offers. The dataset forms need the pack's practice dataset; the word forms (Conjugate, Which form is this?) need the pack's word-form entry (language/word-forms.ts).
// A pack without a dataset (Japanese, Korean) never plans, lists or counts the first; a pack without word forms (Chinese) never the second.

/** What a pack says about what it can offer. */
export interface Offering { practice?: unknown; wordForms?: { offered: boolean }; tones?: boolean }

/** Whether the pack ships a practice dataset (pack.practice): the forms in DATASET_FORMS have material only then. */
export const hasDataset = (pack: Offering): boolean => !!pack.practice
/** Whether the pack has word-form questions at all. */
export const hasWordForms = (pack: Offering): boolean => !!pack.wordForms?.offered

/** Whether a form may be planned, listed in the preset builder or counted in this build. */
export const isFormOffered = (form: Form, pack: Offering): boolean => (hasDataset(pack) || !DATASET_FORMS.includes(form)) && (hasWordForms(pack) || !WORD_FORMS.includes(form)) && (!!pack.tones || !TONE_FORMS.includes(form))

/** The preset with the forms this build does not offer taken out of every stage (the same object when none is). */
export function offeredPreset(preset: Preset, pack: Offering): Preset {
  const all = Object.values(preset.forms).flat()
  if (all.every(form => isFormOffered(form!, pack))) return preset
  const forms = Object.fromEntries(Object.entries(preset.forms).map(([stage, list]) => [stage, (list ?? []).filter(form => isFormOffered(form, pack))])) as Preset['forms']
  return { ...preset, forms }
}
