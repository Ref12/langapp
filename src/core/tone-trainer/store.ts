import { db } from '../database'
import { recordSpeakAnswer, emptySpeaking, type SpeakAnswer } from './speaking'
import type { PitchRange } from './calibration'
import { emptyProgress, recordAnswer, type TrainerAnswer, type TrainerProgress, type TrainerStage } from './engine'

export async function loadTrainerProgress(): Promise<TrainerProgress> { return (await db.toneTrainer.get('progress')) ?? emptyProgress() }

/** Adds one answer to the profile's tally (a transaction, so two quick answers both count). */
export async function saveTrainerAnswer(answer: TrainerAnswer): Promise<TrainerProgress> {
  return db.transaction('rw', db.toneTrainer, async () => {
    const next = recordAnswer(await loadTrainerProgress(), answer)
    await db.toneTrainer.put(next)
    return next
  })
}
export async function saveTrainerStage(stage: TrainerStage): Promise<void> {
  await db.transaction('rw', db.toneTrainer, async () => { await db.toneTrainer.put({ ...(await loadTrainerProgress()), stage }) })
}

/** Adds one first attempt of the speaking practice (kept in the same row, apart from the listening answers). */
export async function saveSpeakAnswer(answer: SpeakAnswer): Promise<TrainerProgress> {
  return db.transaction('rw', db.toneTrainer, async () => {
    const progress = await loadTrainerProgress()
    const next = { ...progress, speaking: recordSpeakAnswer(progress.speaking, answer) }
    await db.toneTrainer.put(next)
    return next
  })
}
/** Keeps the learner's calibrated range with their progress. */
export async function saveSpeakRange(range: PitchRange): Promise<TrainerProgress> {
  return db.transaction('rw', db.toneTrainer, async () => {
    const progress = await loadTrainerProgress()
    const next = { ...progress, speaking: { ...(progress.speaking ?? emptySpeaking()), range, rangeAt: Date.now() } }
    await db.toneTrainer.put(next)
    return next
  })
}
