import { db } from '../database'
import { applyMemoryAction, readMemoryGame, type MemoryAction, type MemoryGame } from './memory'

export async function updateMemory(expected: MemoryGame, action: MemoryAction): Promise<MemoryGame> {
  return db.transaction('rw', db.memoryGames, async () => {
    const value = await db.memoryGames.get('current')
    if (!value || value.gameId !== expected.gameId || value.revision !== expected.revision) {
      throw new Error('This Memory board changed in another tab. Try again on the current board.')
    }
    const next = applyMemoryAction(readMemoryGame(value), action)
    await db.memoryGames.put(next)
    return next
  })
}
