import { z } from 'zod'
import { FORMS, STAGES, type Form, type Length, type Preset, type Stage } from './types'

/** Balanced: every stage once at Standard, so 5 items give about 20 exercises. */
export const DEFAULT_PRESET: Preset = {
  id: 'default', name: 'Default', blurb: 'A balanced mix of every stage.',
  forms: {
    introduce: ['intro'],
    recognise: ['choice', 'match', 'listen-pick', 'exchange-pick', 'which-correct'],
    recall: ['recall', 'pinyin', 'choice'],
    produce: ['tiles', 'translate-en-zh', 'gap'],
    use: ['translate-zh-en', 'listen-pick', 'gap', 'exchange-reply', 'conversation'],
  },
  rounds: { introduce: 1, recognise: 1, recall: 1, produce: 1, use: 1 },
  wordForms: ['recognise', 'produce'],
}

/** The four skill presets change which forms the stages use and how much of the session each stage gets (design section 2). */
export const SKILL_PRESETS: Preset[] = [
  { id: 'reading', name: 'Reading', blurb: 'Read and pick: choice, fill the gap, translate to English.',
    forms: { introduce: ['intro'], recognise: ['choice', 'match', 'gap', 'exchange-pick', 'which-correct'], recall: ['recall', 'choice'], produce: ['gap', 'tiles'], use: ['translate-zh-en', 'gap'] },
    rounds: { introduce: 1, recognise: 2, recall: 1, produce: 0, use: 1 }, wordForms: ['recognise'] },
  { id: 'writing', name: 'Writing', blurb: 'Produce Chinese: translate, dictation, word order, pinyin.',
    forms: { introduce: ['intro'], recognise: ['choice'], recall: ['pinyin'], produce: ['translate-en-zh', 'tiles', 'dictation'], use: ['dictation', 'translate-en-zh'] },
    rounds: { introduce: 1, recognise: 1, recall: 1, produce: 2, use: 0 }, wordForms: ['produce'] },
  { id: 'listening', name: 'Listening', blurb: 'Hear it: listen and pick, dictation.',
    forms: { introduce: ['intro'], recognise: ['listen-pick', 'which-tones'], recall: ['listen-pick', 'dictation'], produce: ['dictation'], use: ['listen-pick', 'dictation', 'conversation'] },
    rounds: { introduce: 1, recognise: 2, recall: 0, produce: 1, use: 1 } },
  { id: 'speaking', name: 'Speaking', blurb: 'Say it: repeat after me and spoken translation.',
    forms: { introduce: ['intro'], recognise: ['repeat'], recall: ['recall'], produce: ['translate-en-zh'], use: ['repeat', 'translate-en-zh'] },
    rounds: { introduce: 1, recognise: 1, recall: 1, produce: 2, use: 0 } },
]

export const BUILTIN_PRESETS: Preset[] = [DEFAULT_PRESET, ...SKILL_PRESETS]
/** Presets whose graded answers are given by voice: the answer mode is forced to speaking for their typed forms. */
export const SPOKEN_PRESETS: readonly string[] = ['speaking']

export const customPresetSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(40),
  forms: z.array(z.enum(FORMS)).max(FORMS.length),
  stages: z.array(z.enum(STAGES)).max(STAGES.length),
}).strict()
export type CustomPreset = z.infer<typeof customPresetSchema>

/**
 * The advanced builder's result as a preset: the ticked stages (one round each) using the ticked forms. A form joins a stage it suits (a stage never gets a form the
 * default preset does not use there, so "Dictation" ticked puts it in Produce and Use, never in Recognise); a ticked stage with no ticked form falls back to the default's.
 */
export function presetFromCustom(custom: CustomPreset): Preset {
  const forms: Partial<Record<Stage, readonly Form[]>> = {}
  const rounds: Partial<Record<Stage, number>> = {}
  for (const stage of STAGES) {
    if (!custom.stages.includes(stage)) { rounds[stage] = 0; continue }
    rounds[stage] = 1
    if (stage === 'introduce') { forms[stage] = ['intro']; continue }
    const suited = FORMS_BY_STAGE[stage].filter(form => custom.forms.includes(form))
    forms[stage] = suited.length ? suited : DEFAULT_PRESET.forms[stage]
  }
  return { id: custom.id, name: custom.name, blurb: 'Your own preset.', forms, rounds }
}

/** Every form a stage can use, for the builder's checkboxes. */
export const FORMS_BY_STAGE: Record<Stage, readonly Form[]> = {
  introduce: ['intro'],
  recognise: ['choice', 'match', 'listen-pick', 'repeat', 'exchange-pick', 'which-correct', 'form-pick'],
  recall: ['recall', 'pinyin', 'choice', 'listen-pick', 'dictation', 'which-tones'],
  produce: ['tiles', 'translate-en-zh', 'gap', 'dictation', 'conjugate'],
  use: ['translate-zh-en', 'listen-pick', 'gap', 'dictation', 'translate-en-zh', 'repeat', 'exchange-reply', 'conversation'],
}

/** Exercises per item per length at Standard is the sum of the rounds (4 for the default); Short halves the stages (whole ones only), Long doubles every round. */
export const LENGTH_FACTOR: Record<Length, number> = { short: 0.5, standard: 1, long: 2 }
export const LENGTH_MINUTES_PER_EXERCISE = 0.5

export const estimateMinutes = (exercises: number) => Math.max(1, Math.round(exercises * LENGTH_MINUTES_PER_EXERCISE))
