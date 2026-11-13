// The tone trainer's rules, with no UI: stages, the unlock rule, and the adaptive picker.
// Stage 1: single syllables, two tones to choose from (contrasting 1/4 first, then 2/3). Stage 2: singles, all four tones. Stage 3: two-syllable words, a tone per syllable.
import type { ToneManifest, ToneManifestItem } from './manifest'
import type { SpeakingProgress } from './speaking'

export const ROUND_SIZE = 20
/** A stage unlocks the next when this share of the last UNLOCK_WINDOW answers in it are right. */
export const UNLOCK_ACCURACY = 0.85
export const UNLOCK_WINDOW = 40
export const STAGES = [1, 2, 3] as const
export type TrainerStage = (typeof STAGES)[number]
export const STAGE_NAME: Record<TrainerStage, string> = { 1: 'Two tones', 2: 'Four tones', 3: 'Two syllables' }

/** One answer: the tones heard (1-4, 5 neutral), the tones chosen, the voice and the stage. */
export interface TrainerAnswer { stage: TrainerStage; item: string; voice: string; heard: number[]; chosen: number[]; correct: boolean; at: number }
/** What is kept per profile: the latest answers (for unlocks and the adaptive picker) and the tally of which tone was heard as which. */
export interface TrainerProgress {
  id: 'progress'
  answers: TrainerAnswer[]
  /** confusion[heard][chosen] counts, tones 1-5 written as keys "1".."5". */
  confusion: Record<string, Record<string, number>>
  /** Per voice: [answered, missed]. */
  voices: Record<string, [number, number]>
  stage: TrainerStage
  /** The speaking practice ("Say the tone"): its own answers and the learner's pitch range, kept apart from the listening stages above. */
  speaking?: SpeakingProgress
}
export const MAX_KEPT_ANSWERS = 300
export const emptyProgress = (): TrainerProgress => ({ id: 'progress', answers: [], confusion: {}, voices: {}, stage: 1 })

export function recordAnswer(progress: TrainerProgress, answer: TrainerAnswer): TrainerProgress {
  const confusion = structuredClone(progress.confusion)
  answer.heard.forEach((heard, index) => {
    const row = confusion[String(heard)] ?? (confusion[String(heard)] = {})
    const chosen = String(answer.chosen[index])
    row[chosen] = (row[chosen] ?? 0) + 1
  })
  const [asked, missed] = progress.voices[answer.voice] ?? [0, 0]
  return { ...progress, answers: [...progress.answers, answer].slice(-MAX_KEPT_ANSWERS), confusion, voices: { ...progress.voices, [answer.voice]: [asked + 1, missed + (answer.correct ? 0 : 1)] } }
}

/** Accuracy over the last UNLOCK_WINDOW answers of a stage; undefined until the window is full. */
export function stageAccuracy(answers: readonly TrainerAnswer[], stage: TrainerStage): number | undefined {
  const recent = answers.filter(a => a.stage === stage).slice(-UNLOCK_WINDOW)
  return recent.length < UNLOCK_WINDOW ? undefined : recent.filter(a => a.correct).length / recent.length
}
export const stageUnlocked = (answers: readonly TrainerAnswer[], stage: TrainerStage): boolean =>
  stage === 1 || (stageAccuracy(answers, (stage - 1) as TrainerStage) ?? 0) >= UNLOCK_ACCURACY
export const unlockedStages = (answers: readonly TrainerAnswer[]): TrainerStage[] => STAGES.filter(stage => stageUnlocked(answers, stage))

/** Stage 1 starts with contrasting pairs (1 vs 4), then 2 vs 3, then the rest; the pair is chosen by how often the learner mixes it up. */
export const STAGE1_PAIRS: readonly (readonly [number, number])[] = [[1, 4], [2, 3], [1, 2], [3, 4], [1, 3], [2, 4]]

/** How much the learner mixes two tones up: both directions of the confusion tally. */
export const confusionOf = (progress: Pick<TrainerProgress, 'confusion'>, a: number, b: number): number =>
  (progress.confusion[String(a)]?.[String(b)] ?? 0) + (progress.confusion[String(b)]?.[String(a)] ?? 0)

export interface RoundItem { item: ToneManifestItem; voice: string; options?: [number, number] }

/** Weighted choice with a seeded random in [0,1): the picker is pure for a rng. */
function weighted<T>(entries: readonly { value: T; weight: number }[], rng: () => number): T {
  const total = entries.reduce((sum, e) => sum + e.weight, 0)
  let at = rng() * total
  for (const e of entries) { at -= e.weight; if (at < 0) return e.value }
  return entries[entries.length - 1].value
}

/** Weight of a voice: voices the learner misses are served more (1 to 3 times as often). */
export function voiceWeight(progress: TrainerProgress, voice: string): number {
  const [asked, missed] = progress.voices[voice] ?? [0, 0]
  return 1 + 2 * ((missed + 1) / (asked + 2) )
}

/**
 * The items of one round. Each item is weighted by how much the learner confuses its tone with the other tones (a learner who mixes up 2 and 3 gets more of them);
 * stage 1 offers the pair of tones with the most confusion among the pairs unlocked by position (1 vs 4 first, then 2 vs 3, ...).
 */
export function pickRound(manifest: ToneManifest, stage: TrainerStage, progress: TrainerProgress, rng: () => number, size = ROUND_SIZE): RoundItem[] {
  const pool = manifest.items.filter(item => stage === 3 ? item.kind === 'pair' : item.kind === 'single')
  const out: RoundItem[] = []
  const recent = new Set<string>()
  for (let n = 0; n < size && pool.length; n++) {
    let options: [number, number] | undefined
    let candidates = pool
    if (stage === 1) {
      const seen = progress.answers.filter(a => a.stage === 1).length
      const open = STAGE1_PAIRS.slice(0, seen < UNLOCK_WINDOW / 2 ? 1 : seen < UNLOCK_WINDOW ? 2 : STAGE1_PAIRS.length)
      const pair = weighted(open.map(p => ({ value: p, weight: 1 + 3 * confusionOf(progress, p[0], p[1]) })), rng)
      options = [pair[0], pair[1]]
      candidates = pool.filter(item => options!.includes(item.tones[0]))
    }
    const entries = candidates.filter(item => !recent.has(item.id)).map(item => ({
      value: item,
      weight: 1 + item.tones.reduce((sum, tone) => sum + [1, 2, 3, 4, 5].reduce((s, other) => s + (other === tone ? 0 : confusionOf(progress, tone, other)), 0), 0),
    }))
    const item = weighted(entries.length ? entries : candidates.map(value => ({ value, weight: 1 })), rng)
    recent.add(item.id); if (recent.size > 6) recent.delete(recent.values().next().value as string)
    const voices = Object.keys(item.clips)
    out.push({ item, voice: weighted(voices.map(value => ({ value, weight: voiceWeight(progress, value) })), rng), options })
  }
  return out
}

/** The learner's confusions as rows (heard tone, chosen tone, count), most frequent first, wrong choices only. */
export function confusionRows(progress: Pick<TrainerProgress, 'confusion'>): { heard: number; chosen: number; count: number }[] {
  const rows: { heard: number; chosen: number; count: number }[] = []
  for (const [heard, row] of Object.entries(progress.confusion)) for (const [chosen, count] of Object.entries(row)) if (heard !== chosen && count > 0) rows.push({ heard: Number(heard), chosen: Number(chosen), count })
  return rows.sort((a, b) => b.count - a.count || a.heard - b.heard || a.chosen - b.chosen)
}

export const TONE_WORDS: Record<number, string> = { 1: 'high and flat', 2: 'rising', 3: 'low and dipping', 4: 'falling', 5: 'neutral' }
export const toneLabel = (tone: number): string => (tone === 5 ? 'Neutral' : 'Tone ' + tone) + ': ' + TONE_WORDS[tone]
