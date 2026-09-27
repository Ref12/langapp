import { z } from 'zod'
import { distinctWords, faceSchema, gameWordSchema, pairFaces, type GameWord } from './game-vocabulary'

export const memoryModeSchema = z.enum(['mixed', 'character-meaning', 'character-pinyin', 'pinyin-meaning', 'triplets'])
export type MemoryMode = z.infer<typeof memoryModeSchema>
export const memoryWordCountSchema = z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8)])
export type MemoryWordCount = z.infer<typeof memoryWordCountSchema>
const tileSchema = z.object({ id: z.number().int().min(0).max(23), word: gameWordSchema, face: faceSchema }).strict()
export type MemoryTile = z.infer<typeof tileSchema>
export const memoryGameSchema = z.object({
  version: z.literal(1),
  id: z.literal('current'),
  gameId: z.string().min(1),
  revision: z.number().int().nonnegative().safe(),
  mode: memoryModeSchema,
  wordCount: memoryWordCountSchema,
  tiles: z.array(tileSchema).min(4).max(24),
  phase: z.enum(['study', 'play', 'review', 'complete']),
  turned: z.array(z.number().int().min(0).max(23)).max(3),
  matched: z.array(z.number().int().min(0).max(23)).max(24),
  attempts: z.number().int().nonnegative().safe(),
}).strict()
export type MemoryGame = z.infer<typeof memoryGameSchema>
export type MemoryAction = { type: 'start' } | { type: 'continue' } | { type: 'reveal'; id: number }

export function memoryGroupSize(mode: MemoryMode): number { return mode === 'triplets' ? 3 : 2 }

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function memoryMatches(tiles: readonly MemoryTile[], mode: MemoryMode): boolean {
  return tiles.length === memoryGroupSize(mode)
    && new Set(tiles.map(tile => tile.id)).size === tiles.length
    && tiles.every(tile => tile.word.id === tiles[0].word.id)
    && new Set(tiles.map(tile => tile.face)).size === tiles.length
}

export function createMemoryGame(words: readonly GameWord[], mode: MemoryMode, wordCount: MemoryWordCount, random = Math.random): MemoryGame {
  memoryModeSchema.parse(mode)
  memoryWordCountSchema.parse(wordCount)
  const candidates = distinctWords(shuffle(words, random)).slice(0, wordCount)
  if (candidates.length !== wordCount) throw new Error(`Add ${wordCount} distinct short vocabulary words to your knowledge set, or choose a smaller board.`)
  const tiles = shuffle(candidates.flatMap((word, index) => {
    const faces = mode === 'triplets' ? faceSchema.options : pairFaces(mode, index)
    return faces.map(face => ({ word: { ...word }, face }))
  }), random).map((tile, id) => ({ ...tile, id }))
  return { version: 1, id: 'current', gameId: crypto.randomUUID(), revision: 0, mode, wordCount, tiles, phase: 'study', turned: [], matched: [], attempts: 0 }
}

export function readMemoryGame(value: unknown): MemoryGame {
  const game = memoryGameSchema.parse(value), size = memoryGroupSize(game.mode)
  const mode = game.mode
  const words = [...new Map(game.tiles.map(tile => [tile.word.id, tile.word])).values()]
  const ids = new Set(game.tiles.map(tile => tile.id))
  if (game.tiles.length !== game.wordCount * size || game.tiles.some((tile, index) => tile.id !== index)
    || words.length !== game.wordCount || distinctWords(words).length !== words.length
    || new Set(game.matched).size !== game.matched.length || new Set(game.turned).size !== game.turned.length
    || [...game.matched, ...game.turned].some(id => !ids.has(id)) || game.turned.some(id => game.matched.includes(id))) {
    throw new Error('The saved Memory board is inconsistent.')
  }
  for (const word of words) {
    const group = game.tiles.filter(tile => tile.word.id === word.id)
    const matched = group.filter(tile => game.matched.includes(tile.id)).length
    if (!memoryMatches(group, game.mode) || group.some(tile => JSON.stringify(tile.word) !== JSON.stringify(word))
      || (matched !== 0 && matched !== size)
      || (mode !== 'triplets' && mode !== 'mixed' && group.some(tile => !pairFaces(mode, 0).includes(tile.face)))) {
      throw new Error('The saved Memory board has an invalid matching group.')
    }
  }
  const complete = game.matched.length === game.tiles.length
  if ((game.phase === 'complete') !== complete || game.attempts < game.matched.length / size
    || (game.phase === 'study' && (game.attempts !== 0 || game.turned.length !== 0 || game.matched.length !== 0))
    || (game.phase === 'play' && game.turned.length >= size)
    || (game.phase === 'complete' && game.turned.length !== 0)
    || (game.phase === 'review' && (game.turned.length !== size || game.attempts <= game.matched.length / size
      || memoryMatches(game.turned.map(id => game.tiles[id]), game.mode)))) {
    throw new Error('The saved Memory turn is inconsistent.')
  }
  return game
}

export function applyMemoryAction(game: MemoryGame, action: MemoryAction): MemoryGame {
  if (action.type === 'start') {
    if (game.phase !== 'study') throw new Error('This Memory game has already started.')
    return { ...game, revision: game.revision + 1, phase: 'play' }
  }
  if (action.type === 'continue') {
    if (game.phase !== 'review') throw new Error('There is no mismatched turn to continue.')
    return { ...game, revision: game.revision + 1, phase: 'play', turned: [] }
  }
  if (game.phase !== 'play' || !Number.isInteger(action.id) || !game.tiles[action.id]
    || game.turned.includes(action.id) || game.matched.includes(action.id)) throw new Error('Choose a face-down tile during an active turn.')
  const turned = [...game.turned, action.id]
  const next = { ...game, revision: game.revision + 1, turned }
  if (turned.length < memoryGroupSize(game.mode)) return next
  next.attempts++
  if (!memoryMatches(turned.map(id => game.tiles[id]), game.mode)) return { ...next, phase: 'review' }
  const matched = [...game.matched, ...turned]
  return { ...next, matched, turned: [], phase: matched.length === game.tiles.length ? 'complete' : 'play' }
}
