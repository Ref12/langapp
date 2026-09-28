import type { MemoryGame } from './memory'
import { GAME_GROUP_COLORS } from './game-colors'

export const MEMORY_MATCH_COLORS = GAME_GROUP_COLORS

export function memoryMatchedColors(game: MemoryGame) {
  const words = [...new Set(game.matched.map(id => game.tiles[id].word.id))]
  return new Map(words.map((id, index) => [id, MEMORY_MATCH_COLORS[index]]))
}
