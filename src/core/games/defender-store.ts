import { db } from '../database'
import { readDefenderGame, type DefenderGame } from './defender'

export type DefenderRevision = Pick<DefenderGame, 'gameId' | 'revision'>
export async function saveDefenderGame(snapshot: DefenderGame, expected?: DefenderRevision): Promise<DefenderGame> {
  const game = readDefenderGame(snapshot)
  return db.transaction('rw', db.defenderGames, async () => {
    const current = await db.defenderGames.get('current')
    if (expected ? !current || current.gameId !== expected.gameId || current.revision !== expected.revision : current !== undefined) {
      throw new Error('Defender changed in another tab. Reload to use its latest saved run.')
    }
    const next = { ...game, revision: (current?.revision ?? -1) + 1 }
    await db.defenderGames.put(next)
    return next
  })
}
