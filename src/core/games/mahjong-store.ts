import { db } from '../database'
import { availablePairs, readMahjong, removePair, reshuffleMahjong, undoPair, type MahjongGame } from './mahjong'

export type MahjongAction = { type: 'match'; first: number; second: number } | { type: 'hint' | 'undo' | 'shuffle' }

export async function updateMahjong(expected: MahjongGame, action: MahjongAction): Promise<MahjongGame> {
  return db.transaction('rw', db.mahjongGames, async () => {
    const current = await db.mahjongGames.get('current')
    if (!current || current.gameId !== expected.gameId || current.revision !== expected.revision) {
      throw new Error('This board changed in another tab. Try again on the current board.')
    }
    const game = readMahjong(current)
    let next: MahjongGame
    if (action.type === 'match') next = removePair(game, action.first, action.second)
    else if (action.type === 'undo') next = undoPair(game)
    else if (action.type === 'shuffle') next = reshuffleMahjong(game)
    else {
      if (!availablePairs(game).length) throw new Error('No matching tiles are free. Reshuffle the board first.')
      next = { ...game, revision: game.revision + 1, hints: game.hints + 1 }
    }
    await db.mahjongGames.put(next)
    return next
  })
}
