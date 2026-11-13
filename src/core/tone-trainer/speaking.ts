// "Say the tone": the speaking practice's rules, with no UI: stages, the unlock rule, the picker and what is kept per profile.
// Stage 1: single syllables. Stage 2: two-syllable words. A stage unlocks the next at the listening stages' bar (85% over 40 first attempts).
import { UNLOCK_ACCURACY, UNLOCK_WINDOW } from './engine'
import type { ToneManifest, ToneManifestItem } from './manifest'
import type { PitchRange } from './calibration'

export const SPEAK_STAGES = [1, 2] as const
export type SpeakStage = (typeof SPEAK_STAGES)[number]
export const SPEAK_STAGE_NAME: Record<SpeakStage, string> = { 1: 'Single syllables', 2: 'Two-syllable words' }
export const SPEAK_ROUND_SIZE = 10
export const MAX_KEPT_SPEAK_ANSWERS = 200

/** One first attempt: the tones asked, the tones heard (0 where a syllable had too little pitch), the model voice and the stage. */
export interface SpeakAnswer { stage: SpeakStage; item: string; voice: string; expected: number[]; heard: number[]; correct: boolean; at: number }
export interface SpeakingProgress {
  answers: SpeakAnswer[]
  /** The learner's 5th-95th percentile F0 in Hz (calibration), and when it was taken. */
  range?: PitchRange
  rangeAt?: number
}
export const emptySpeaking = (): SpeakingProgress => ({ answers: [] })

export function recordSpeakAnswer(speaking: SpeakingProgress | undefined, answer: SpeakAnswer): SpeakingProgress {
  const base = speaking ?? emptySpeaking()
  return { ...base, answers: [...base.answers, answer].slice(-MAX_KEPT_SPEAK_ANSWERS) }
}

export function speakAccuracy(answers: readonly SpeakAnswer[], stage: SpeakStage): number | undefined {
  const recent = answers.filter(a => a.stage === stage).slice(-UNLOCK_WINDOW)
  return recent.length < UNLOCK_WINDOW ? undefined : recent.filter(a => a.correct).length / recent.length
}
export const speakStageUnlocked = (answers: readonly SpeakAnswer[], stage: SpeakStage): boolean => stage === 1 || (speakAccuracy(answers, 1) ?? 0) >= UNLOCK_ACCURACY

export interface SpeakItem { item: ToneManifestItem; voice: string }

/** Items to say: singles or pairs with tones 1-4 only (the neutral tone is not asked for here), each tone weighted up by how often the learner missed it. */
export function pickSpeakRound(manifest: ToneManifest, stage: SpeakStage, speaking: SpeakingProgress | undefined, rng: () => number, size = SPEAK_ROUND_SIZE): SpeakItem[] {
  const pool = manifest.items.filter(item => (stage === 2 ? item.kind === 'pair' : item.kind === 'single') && item.tones.every(tone => tone >= 1 && tone <= 4))
  const missed = (tone: number) => (speaking?.answers ?? []).filter(a => a.expected.includes(tone) && !a.correct).length
  const out: SpeakItem[] = [], recent = new Set<string>()
  for (let n = 0; n < size && pool.length; n++) {
    const entries = pool.filter(item => !recent.has(item.id)).map(item => ({ item, weight: 1 + item.tones.reduce((sum, tone) => sum + missed(tone), 0) }))
    const list = entries.length ? entries : pool.map(item => ({ item, weight: 1 }))
    let at = rng() * list.reduce((sum, entry) => sum + entry.weight, 0), chosen = list[list.length - 1].item
    for (const entry of list) { at -= entry.weight; if (at < 0) { chosen = entry.item; break } }
    recent.add(chosen.id); if (recent.size > 6) recent.delete(recent.values().next().value as string)
    const voices = Object.keys(chosen.clips)
    out.push({ item: chosen, voice: voices[Math.min(voices.length - 1, Math.floor(rng() * voices.length))] })
  }
  return out
}
