import { describe, expect, it } from 'vitest'
import { availablePairs, boardLayout, courtyardLayout, createMahjong, distinctWords, isFree, layout, matches, readMahjong, remainingTiles, removalOrder, removePair, reshuffleMahjong, undoPair, type GameWord } from './mahjong'

export const gameWords: GameWord[] = [
  { id: 'tea', character: '茶', pinyin: 'chá', meaning: 'tea' },
  { id: 'rain', character: '雨', pinyin: 'yǔ', meaning: 'rain' },
  { id: 'water', character: '水', pinyin: 'shuǐ', meaning: 'water' },
  { id: 'book', character: '书', pinyin: 'shū', meaning: 'book' },
  { id: 'student', character: '学生', pinyin: 'xué sheng', meaning: 'student' },
  { id: 'cat', character: '猫', pinyin: 'māo', meaning: 'cat' },
  { id: 'dog', character: '狗', pinyin: 'gǒu', meaning: 'dog' },
  { id: 'sun', character: '日', pinyin: 'rì', meaning: 'sun' },
  { id: 'moon', character: '月', pinyin: 'yuè', meaning: 'moon' },
  { id: 'person', character: '人', pinyin: 'rén', meaning: 'person' },
]
function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
}
const solvableDeals = [4, 6, 10].flatMap(count => Array.from({ length: 80 }, (_, seed) => ({ count, seed })))

describe('Mahjong Solitaire rules', () => {
  it('requires uncovered tiles with at least one open horizontal side', () => {
    const positions = layout(10)
    expect(isFree(positions[0], positions)).toBe(true)
    expect(isFree(positions[1], positions)).toBe(false)
    expect(isFree(positions[5], positions)).toBe(false)
    const withoutLeft = positions.filter(tile => tile.id !== 4)
    expect(isFree(positions[5], withoutLeft)).toBe(false)
    expect(isFree(positions[5], withoutLeft.filter(tile => tile.z === 0))).toBe(true)
    expect(isFree(positions[0], positions.slice(1))).toBe(false)
  })

  it('matches the same vocabulary sense across different representations only', () => {
    const first = { id: 0, x: 0, y: 0, z: 0, word: gameWords[0], face: 'character' as const }
    expect(matches(first, { ...first, id: 1, face: 'pinyin' })).toBe(true)
    expect(matches(first, { ...first, id: 1 })).toBe(false)
    expect(matches(first, { ...first, id: 1, word: gameWords[1], face: 'pinyin' })).toBe(false)
    expect(matches(first, first)).toBe(false)
  })

  it('excludes ambiguous forms, tone-equivalent spaced pinyin, overlapping glosses and long entries', () => {
    const word = gameWords[4]
    const candidates = [word, { ...gameWords[0], pinyin: 'xuésheng' }, { ...gameWords[1], meaning: 'a student; learner' },
      { ...gameWords[2], character: word.character }, { ...gameWords[3], meaning: 'x'.repeat(65) }]
    expect(distinctWords(candidates)).toEqual([word])
  })

  it.each(solvableDeals)('constructs a solvable 48-tile board from $count words with seed $seed', ({ count, seed }) => {
    let game = createMahjong(gameWords.slice(0, count), 'mixed', seeded(seed))
    expect(game.tiles).toHaveLength(48)
    expect(game.tiles.some(tile => tile.z === 2)).toBe(true)
    expect(game.tiles.some(tile => !Number.isInteger(tile.x))).toBe(true)
    const forms = new Set(game.tiles.map(tile => tile.face))
    expect(forms.size).toBe(3)
    for (const [first, second] of removalOrder(courtyardLayout(), () => .5)) {
      expect(availablePairs(game).some(pair => pair.some(tile => tile.id === first.id) && pair.some(tile => tile.id === second.id))).toBe(true)
      game = removePair(game, first.id, second.id)
      expect(readMahjong(game)).toEqual(game)
    }
  })

  it.each(['character-meaning', 'character-pinyin', 'pinyin-meaning'] as const)('supports %s boards', mode => {
    const game = createMahjong(gameWords, mode)
    expect(new Set(game.tiles.map(tile => tile.face))).toEqual(new Set(mode.split('-')))
  })

  it('counts mistakes without removing tiles, rejects blocked choices, and restores a match with Undo', () => {
    const game = createMahjong(gameWords, 'mixed', seeded(2))
    const remaining = remainingTiles(game)
    const blocked = remaining.find(tile => !isFree(tile, remaining))!
    const [first, second] = availablePairs(game)[0]
    expect(() => removePair(game, first.id, blocked.id)).toThrow('uncovered')
    expect(() => removePair(game, first.id, first.id)).toThrow('different')
    const wrong = remaining.find(tile => isFree(tile, remaining) && tile.word.id !== first.word.id)!
    const missed = removePair(game, first.id, wrong.id)
    expect(missed.mistakes).toBe(1)
    expect(missed.removed).toEqual([])
    const moved = removePair(game, first.id, second.id)
    expect(moved.removed).toHaveLength(2)
    const undone = undoPair(moved)
    expect(undone.removed).toEqual([])
    expect(undone.tiles).toEqual(game.tiles)
    expect(() => undoPair(undone)).toThrow('no match')
  })

  it('reshuffles only remaining tiles into solvable positions and resets undo history', () => {
    let game = createMahjong(gameWords, 'mixed', seeded(10))
    const pair = availablePairs(game)[0]
    game = removePair(game, pair[0].id, pair[1].id)
    const removed = game.removed
    game = reshuffleMahjong(game, seeded(11))
    expect(game.removed).toEqual(removed)
    expect(game.history).toEqual([])
    expect(game.shuffles).toBe(1)
    expect(readMahjong(game)).toEqual(game)
    for (const positions of removalOrder(boardLayout(game), () => .5).slice(-remainingTiles(game).length / 2)) {
      const next = positions.map(position => remainingTiles(game).find(tile => tile.x === position.x && tile.y === position.y && tile.z === position.z)!)
      expect(next.every(Boolean)).toBe(true)
      game = removePair(game, next[0].id, next[1].id)
    }
    expect(() => reshuffleMahjong(game)).toThrow('complete')
  })

  it('allows a duplicate copy to match across the originally dealt pairs', () => {
    const game = createMahjong(gameWords.slice(0, 4), 'character-pinyin', seeded(2))
    const originalPairs = removalOrder(courtyardLayout(), () => .5)
    const crossPair = availablePairs(game).find(([first, second]) => !originalPairs.some(pair => pair.some(p => p.id === first.id) && pair.some(p => p.id === second.id)))!
    expect(crossPair).toBeDefined()
    expect(game.tiles.filter(tile => tile.word.id === crossPair[0].word.id)).toHaveLength(12)
    const next = removePair(game, crossPair[0].id, crossPair[1].id)
    expect(next.removed).toHaveLength(2)
    expect(readMahjong(next)).toEqual(next)
    expect(readMahjong(undoPair(next)).removed).toEqual([])
  })

  it('handles partial covers and side neighbors offset by half a tile', () => {
    const tile = { id: 0, x: 1, y: 1, z: 0 }
    expect(isFree(tile, [tile, { id: 1, x: 1.5, y: 1.5, z: 1 }])).toBe(false)
    expect(isFree(tile, [tile, { id: 1, x: 0, y: 1.5, z: 0 }, { id: 2, x: 2, y: .5, z: 0 }])).toBe(false)
    expect(isFree(tile, [tile, { id: 1, x: 2, y: 1, z: 1 }])).toBe(true)
  })

  it('restacks an impossible remaining tower without losing duplicate copies or changing cleared pairs', () => {
    const game = createMahjong(gameWords, 'character-pinyin', seeded(3))
    const first = game.tiles[0]
    const second = game.tiles.find(tile => matches(first, tile))!
    game.tiles = game.tiles.map(tile => tile.id === first.id ? { ...tile, x: 1, y: 1.5, z: 2 }
      : tile.id === second.id ? { ...tile, x: .5, y: 1.25, z: 1 } : tile)
    game.removed = game.tiles.filter(tile => tile.id !== first.id && tile.id !== second.id).map(tile => tile.id)
    expect(readMahjong(game)).toEqual(game)
    expect(availablePairs(game)).toHaveLength(0)
    const next = reshuffleMahjong(game, seeded(4))
    expect(next.removed).toEqual(game.removed)
    expect(availablePairs(next)).toHaveLength(1)
    expect(readMahjong(next)).toEqual(next)
  })

  it('continues old small saved boards without resetting progress', () => {
    const old = { ...createMahjong(gameWords), layout: undefined, layoutSnapshot: undefined,
      tiles: removalOrder(layout(4), () => .5).flatMap((positions, i) => positions.map((position, index) => ({
        ...position, word: gameWords[i], face: index ? 'pinyin' as const : 'character' as const,
      }))) }
    expect(readMahjong(old).tiles).toHaveLength(8)
    const pair = availablePairs(old)[0]
    const next = removePair(old, pair[0].id, pair[1].id)
    expect(readMahjong(reshuffleMahjong(next)).removed).toEqual(next.removed)
  })

  it('rejects too-small word sets and corrupted saved boards', () => {
    expect(() => createMahjong(gameWords.slice(0, 3))).toThrow('four')
    const game = createMahjong(gameWords)
    expect(() => readMahjong({ ...game, removed: [0] })).toThrow('pair')
    expect(() => readMahjong({ ...game, tiles: game.tiles.map(tile => ({ ...tile, id: 0 })) })).toThrow('layout')
    expect(() => readMahjong({ ...game, history: [[0, 1]] })).toThrow('history')
  })
})
