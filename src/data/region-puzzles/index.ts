import size5 from './5.json'
import size6 from './6.json'
import size7 from './7.json'
import size8 from './8.json'
import size9 from './9.json'
import { bankSchema } from '../../core/games/regions/schema.mjs'
import type { RegionPuzzle } from '../../core/games/regions/types'

// Full connectivity, uniqueness, grading and proof checks run offline.
export const regionPuzzleBanks = [size5, size6, size7, size8, size9]
  .map(bank => bankSchema.parse(bank))
export const regionPuzzles: RegionPuzzle[] = regionPuzzleBanks.flatMap(bank => bank.puzzles)

export type RegionPuzzleDefinition = Pick<RegionPuzzle, 'id' | 'size' | 'regions' | 'difficulty'>

// Hand the UI its own region array without the answer or hint trace.
export function toRegionPuzzleDefinition(puzzle: RegionPuzzle): RegionPuzzleDefinition {
  return {
    id: puzzle.id,
    size: puzzle.size,
    regions: [...puzzle.regions],
    difficulty: puzzle.difficulty,
  }
}
