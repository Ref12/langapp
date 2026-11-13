import { db } from '../database'
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
