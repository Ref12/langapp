import { db } from '../database'
import { applyPotionsAction, readPotionsGame, readPotionsProgress, recordPotionsLevel, type PotionsAction, type PotionsGame, type PotionsProgress } from './potions'

export async function loadPotionsProgress(): Promise<PotionsProgress> {
  return readPotionsProgress(await db.potionProgress.get('progress'))
}

export async function startPotionsLevel(game: PotionsGame): Promise<PotionsGame> {
  const next = readPotionsGame(game)
  await db.potionGames.put(next)
  return next
}

export async function updatePotions(expected: PotionsGame, action: PotionsAction): Promise<PotionsGame> {
  return db.transaction('rw', db.potionGames, db.potionProgress, async () => {
    const value = await db.potionGames.get('current')
    if (!value || value.gameId !== expected.gameId || value.revision !== expected.revision) {
      throw new Error('This Phrase Potions puzzle changed in another tab. Try again on the current puzzle.')
    }
    const next = applyPotionsAction(readPotionsGame(value), action)
    await db.potionGames.put(next)
    if (next.phase === 'complete') {
      const progress = readPotionsProgress(await db.potionProgress.get('progress'))
      await db.potionProgress.put(recordPotionsLevel(progress, next))
    }
    return next
  })
}
