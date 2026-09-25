import { z } from 'zod'
import { glosses } from '../questions'
import { isFree, MAX_LAYOUT_TILES, positionSchema, removalOrder, type Position } from './mahjong-geometry'
import { DEFAULT_LAYOUT_ID, getMahjongLayout, layoutIdSchema, layoutSnapshotSchema } from './mahjong-layouts'

export { isFree, removalOrder, type Position } from './mahjong-geometry'

export const faceSchema = z.enum(['character', 'pinyin', 'meaning'])
export type TileFace = z.infer<typeof faceSchema>
export const modeSchema = z.enum(['mixed', 'character-meaning', 'character-pinyin', 'pinyin-meaning'])
export type MahjongMode = z.infer<typeof modeSchema>
export const gameWordSchema = z.object({
  id: z.string().min(1), character: z.string().min(1).max(6),
  pinyin: z.string().min(1).max(24), meaning: z.string().min(1).max(32),
}).strict()
export type GameWord = z.infer<typeof gameWordSchema>
const tileSchema = positionSchema.extend({ word: gameWordSchema, face: faceSchema }).strict()
export type MahjongTile = z.infer<typeof tileSchema>
export const mahjongGameSchema = z.object({
  id: z.literal('current'), gameId: z.string().min(1), revision: z.number().int().nonnegative(),
  mode: modeSchema, layout: layoutIdSchema.optional(), layoutSnapshot: layoutSnapshotSchema.optional(),
  tiles: z.array(tileSchema).min(8).max(MAX_LAYOUT_TILES),
  removed: z.array(z.number().int().min(0).max(MAX_LAYOUT_TILES - 1)).max(MAX_LAYOUT_TILES),
  history: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])).max(MAX_LAYOUT_TILES / 2),
  mistakes: z.number().int().nonnegative(), hints: z.number().int().nonnegative(),
  shuffles: z.number().int().nonnegative(),
}).strict()
export type MahjongGame = z.infer<typeof mahjongGameSchema>
type Random = () => number

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function normalized(face: TileFace, text: string): string {
  const value = text.normalize('NFKC').toLowerCase().trim()
  return face === 'pinyin' ? value.replace(/\s/g, '') : value.replace(/\s+/g, ' ')
}

export function distinctWords(words: readonly GameWord[]): GameWord[] {
  const seen = { character: new Set<string>(), pinyin: new Set<string>(), meaning: new Set<string>() }
  const ids = new Set<string>()
  const meanings = new Set<string>()
  return words.filter(word => {
    const parts = glosses(word.meaning)
    if (!gameWordSchema.safeParse(word).success || parts.length === 0 || ids.has(word.id)
      || faceSchema.options.some(face => seen[face].has(normalized(face, word[face])))
      || parts.some(part => meanings.has(part))) return false
    faceSchema.options.forEach(face => seen[face].add(normalized(face, word[face])))
    ids.add(word.id)
    parts.forEach(part => meanings.add(part))
    return true
  })
}

export function layout(pairCount: number): Position[] {
  if (![4, 6, 10].includes(pairCount)) throw new Error('Unsupported Mahjong board size.')
  const columns = pairCount === 4 ? 3 : 4
  const rows = pairCount === 10 ? 4 : 2
  const positions: Position[] = []
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) positions.push({ id: positions.length, x, y, z: 0 })
  for (let y = 0; y < (pairCount === 4 ? 1 : 2); y++) for (let x = 1; x <= 2; x++) {
    positions.push({ id: positions.length, x, y: pairCount === 10 ? y + 1 : y, z: 1 })
  }
  return positions
}

export function courtyardLayout(): Position[] {
  return getMahjongLayout('courtyard').positions.map(position => ({ ...position }))
}

export function boardLayout(game: MahjongGame): Position[] {
  if (game.layoutSnapshot) {
    if (game.layoutSnapshot.id !== game.layout) throw new Error('Saved Mahjong layout ID does not match its geometry snapshot.')
    return game.layoutSnapshot.positions
  }
  return game.layout ? getMahjongLayout(game.layout).positions : layout(game.tiles.length / 2)
}

export function remainingTiles(game: MahjongGame): MahjongTile[] {
  const removed = new Set(game.removed)
  return game.tiles.filter(tile => !removed.has(tile.id))
}

export function matches(first: MahjongTile, second: MahjongTile): boolean {
  return first.id !== second.id && first.word.id === second.word.id && first.face !== second.face
}

export function availablePairs(game: MahjongGame): [MahjongTile, MahjongTile][] {
  const remaining = remainingTiles(game)
  const free = remaining.filter(tile => isFree(tile, remaining))
  return free.flatMap((first, i) => free.slice(i + 1).filter(second => matches(first, second)).map(second => [first, second] as [MahjongTile, MahjongTile]))
}

const representations: [TileFace, TileFace][] = [['character', 'meaning'], ['character', 'pinyin'], ['pinyin', 'meaning']]
export function createMahjong(words: readonly GameWord[], mode: MahjongMode = 'mixed', random: Random = Math.random, layoutId = DEFAULT_LAYOUT_ID): MahjongGame {
  const configuration = getMahjongLayout(layoutId)
  const pairCount = configuration.positions.length / 2
  const candidates = distinctWords(shuffle(words, random))
  if (candidates.length < 4) throw new Error('Add at least four distinct, short vocabulary words to your knowledge set before playing.')
  const vocabulary = candidates.slice(0, Math.min(10, pairCount))
  const wordPairs = shuffle(Array.from({ length: pairCount }, (_, i) => i % vocabulary.length), random)
  const tiles = configuration.solution.flatMap((positions, i) => {
    const wordIndex = wordPairs[i]
    // Each word uses exactly two faces, so any duplicate copies may be paired
    // without stranding an unequal number of representations.
    const faces = mode === 'mixed' ? representations[wordIndex % representations.length] : representations.find(pair => pair.join('-') === mode)!
    return shuffle(faces, random).map((face, index) => ({ ...positions[index], face, word: vocabulary[wordIndex] }))
  }).sort((a, b) => a.id - b.id)
  return {
    id: 'current', gameId: crypto.randomUUID(), revision: 0, mode, layout: configuration.id,
    layoutSnapshot: { id: configuration.id, name: configuration.name, positions: configuration.positions.map(position => ({ ...position })) },
    tiles, removed: [], history: [], mistakes: 0, hints: 0, shuffles: 0,
  }
}

export function removePair(game: MahjongGame, firstId: number, secondId: number): MahjongGame {
  const remaining = remainingTiles(game)
  const first = remaining.find(tile => tile.id === firstId), second = remaining.find(tile => tile.id === secondId)
  if (!first || !second || firstId === secondId || !isFree(first, remaining) || !isFree(second, remaining)) {
    throw new Error('Choose two different uncovered tiles with a free left or right edge.')
  }
  if (!matches(first, second)) return { ...game, revision: game.revision + 1, mistakes: game.mistakes + 1 }
  return { ...game, revision: game.revision + 1, removed: [...game.removed, firstId, secondId], history: [...game.history, [firstId, secondId]] }
}

export function undoPair(game: MahjongGame): MahjongGame {
  const pair = game.history.at(-1)
  if (!pair) throw new Error('There is no match to undo.')
  return { ...game, revision: game.revision + 1, removed: game.removed.filter(id => !pair.includes(id)), history: game.history.slice(0, -1) }
}

export function reshuffleMahjong(game: MahjongGame, random: Random = Math.random): MahjongGame {
  const remaining = remainingTiles(game)
  if (!remaining.length) throw new Error('This board is already complete.')
  const words = shuffle([...new Set(remaining.map(tile => tile.word.id))], random)
  const pairs: [MahjongTile, MahjongTile][] = []
  for (const id of words) {
    const tiles = remaining.filter(tile => tile.word.id === id)
    const faces = [...new Set(tiles.map(tile => tile.face))]
    const first = shuffle(tiles.filter(tile => tile.face === faces[0]), random)
    const second = shuffle(tiles.filter(tile => tile.face === faces[1]), random)
    if (faces.length !== 2 || first.length !== second.length) throw new Error('The saved board has an incomplete word pair. Start a new board.')
    first.forEach((tile, i) => pairs.push([tile, second[i]]))
  }
  const shuffled = shuffle(pairs, random)
  const replacements = new Map<number, MahjongTile>()
  // Duplicate matches may leave an impossible tower. Restack into a solvable
  // suffix of the original layout instead of repeatedly shuffling a dead end.
  removalOrder(boardLayout(game), () => .5).slice(-pairs.length).forEach((positions, i) => {
    const pair = shuffle(shuffled[i], random)
    positions.forEach((position, index) => replacements.set(pair[index].id, { ...pair[index], x: position.x, y: position.y, z: position.z }))
  })
  return { ...game, revision: game.revision + 1, tiles: game.tiles.map(tile => replacements.get(tile.id) ?? tile), history: [], shuffles: game.shuffles + 1 }
}

export function readMahjong(value: unknown): MahjongGame {
  const game = mahjongGameSchema.parse(value)
  const positions = boardLayout(game)
  const ids = new Set(game.tiles.map(tile => tile.id))
  const active = remainingTiles(game)
  if (ids.size !== positions.length || game.tiles.some(tile => !positions.some(p => p.id === tile.id) || !positions.some(p => p.x === tile.x && p.y === tile.y && p.z === tile.z))
    || new Set(active.map(tile => `${tile.x}:${tile.y}:${tile.z}`)).size !== active.length
    || new Set(game.removed).size !== game.removed.length || game.removed.some(id => !ids.has(id))) throw new Error('Invalid saved Mahjong layout.')
  const words = [...new Map(game.tiles.map(tile => [tile.word.id, tile.word])).values()]
  if (distinctWords(words).length !== words.length) throw new Error('Invalid saved Mahjong vocabulary.')
  for (const word of words) {
    const copies = game.tiles.filter(tile => tile.word.id === word.id)
    const faces = [...new Set(copies.map(tile => tile.face))]
    const current = active.filter(tile => tile.word.id === word.id)
    const balanced = (tiles: MahjongTile[]) => tiles.filter(tile => tile.face === faces[0]).length === tiles.filter(tile => tile.face === faces[1]).length
    if (faces.length !== 2 || !balanced(copies) || !balanced(current)
      || copies.some(tile => JSON.stringify(tile.word) !== JSON.stringify(word))) throw new Error('Invalid saved Mahjong pair.')
  }
  const history = game.history.flat()
  if (new Set(history).size !== history.length || history.some(id => !game.removed.includes(id))) throw new Error('Invalid saved Mahjong history.')
  let remaining = remainingTiles(game)
  for (const pair of [...game.history].reverse()) {
    const first = game.tiles.find(tile => tile.id === pair[0])!, second = game.tiles.find(tile => tile.id === pair[1])!
    remaining = [...remaining, first, second]
    if (new Set(remaining.map(tile => `${tile.x}:${tile.y}:${tile.z}`)).size !== remaining.length
      || !matches(first, second) || !isFree(first, remaining) || !isFree(second, remaining)) throw new Error('Invalid saved Mahjong move.')
  }
  return game
}
