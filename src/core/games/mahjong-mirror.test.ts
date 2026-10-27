import { expect, it } from 'vitest'
import { createMahjong, isFree, remainingTiles, reshuffleMahjong, type GameWord, type MahjongGame } from './mahjong'
import { getMahjongLayout } from './mahjong-layouts'

const words: GameWord[] = ['tea', 'rain', 'water', 'book', 'cat', 'dog', 'sun', 'moon', 'person', 'fire'].map(id => ({ id, character: id, pinyin: id, meaning: id }))
function seeded(seed: number) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 } }

/** Depth-first clear following matching free pairs: proves the deal is solvable. */
function solvable(game: MahjongGame): boolean {
  const seen = new Set<string>()
  const clear = (removed: number[]): boolean => {
    const rest = game.tiles.filter(tile => !removed.includes(tile.id))
    if (!rest.length) return true
    const key = [...removed].sort((a, b) => a - b).join()
    if (seen.has(key)) return false
    const free = rest.filter(tile => isFree(tile, rest))
    for (const a of free) for (const b of free) {
      if (a.id < b.id && a.word.id === b.word.id && a.face !== b.face && clear([...removed, a.id, b.id])) return true
    }
    seen.add(key)
    return false
  }
  return clear(game.removed)
}
/** Fraction of same-word pairs that sit on mirrored positions (same layer, mirrored about the centre). */
function mirrorFraction(game: MahjongGame): number {
  const xs = game.tiles.map(t => t.x), ys = game.tiles.map(t => t.y)
  const cx = Math.min(...xs) + Math.max(...xs), cy = Math.min(...ys) + Math.max(...ys)
  const groups = new Map<string, typeof game.tiles>()
  for (const tile of game.tiles) groups.set(tile.word.id, [...(groups.get(tile.word.id) ?? []), tile])
  let mirrors = 0, total = 0
  for (const group of groups.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i], b = group[j]
    if (a.face === b.face) continue
    total++
    if (a.z === b.z && ((a.y === b.y && a.x + b.x === cx) || (a.x === b.x && a.y + b.y === cy))) mirrors++
  }
  return mirrors / total
}

it('pairs far fewer mirror images than the old fixed pairing and every game stays solvable', () => {
  const layout = getMahjongLayout('courtyard')
  // Measured on the previous generator (fixed parse-time pairing, z-sorted): 14 of its 24 pairs were mirror images.
  const oldFraction = 14 / 24
  let sum = 0
  const pairings = new Set<string>()
  for (let seed = 1; seed <= 20; seed++) {
    const game = createMahjong(words, 'mixed', seeded(seed))
    expect(solvable(game)).toBe(true)
    expect(solvable(reshuffleMahjong(game, seeded(seed + 50)))).toBe(true)
    sum += mirrorFraction(game) / 20
    pairings.add(game.tiles.map(t => t.word.id).join())
  }
  console.log('MIRROR old', oldFraction, 'new', sum)
  expect(sum).toBeLessThan(oldFraction / 2)
  expect(pairings.size).toBe(20)
  expect(remainingTiles(createMahjong(words, 'mixed', seeded(1)))).toHaveLength(layout.positions.length)
})
