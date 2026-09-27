import { describe, expect, it } from 'vitest'
import { starterWords } from '../../data/mandarin'
import { applyMemoryAction, createMemoryGame, memoryGroupSize, memoryMatches, memoryModeSchema, readMemoryGame, type MemoryWordCount } from './memory'
import { distinctWords } from './game-vocabulary'

const words = distinctWords(starterWords.map(word => ({ id: word.id, character: word.native, pinyin: word.pinyin, meaning: word.meaning })))

describe('Memory matching', () => {
  it.each(memoryModeSchema.options.flatMap(mode => ([2, 4, 6, 8] as MemoryWordCount[]).map(wordCount => ({ mode, wordCount }))))(
    'studies and completes $mode with $wordCount words', ({ mode, wordCount }) => {
      let game = createMemoryGame(words, mode, wordCount, () => .5)
      const tiles = structuredClone(game.tiles)
      const size = memoryGroupSize(mode)
      expect(game.tiles).toHaveLength(wordCount * size)
      expect(game.phase).toBe('study')
      expect(() => applyMemoryAction(game, { type: 'reveal', id: 0 })).toThrow('face-down')
      expect(readMemoryGame(game)).toEqual(game)
      game = applyMemoryAction(game, { type: 'start' })
      expect(game.tiles).toEqual(tiles)
      for (const id of new Set(tiles.map(tile => tile.word.id))) {
        const group = tiles.filter(tile => tile.word.id === id)
        expect(memoryMatches(group, mode)).toBe(true)
        const matched = game.matched.length
        for (const [index, tile] of group.entries()) {
          game = applyMemoryAction(game, { type: 'reveal', id: tile.id })
          expect(readMemoryGame(game)).toEqual(game)
          if (index < size - 1) expect(game.matched).toHaveLength(matched)
        }
        expect(game.matched).toHaveLength(matched + size)
        expect(game.turned).toEqual([])
      }
      expect(game.phase).toBe('complete')
      expect(game.attempts).toBe(wordCount)
      expect(() => applyMemoryAction(game, { type: 'reveal', id: 0 })).toThrow('face-down')
    },
  )

  it.each(['mixed', 'triplets'] as const)('ends a failed %s turn at the second card and counts it once', mode => {
    let game = applyMemoryAction(createMemoryGame(words, mode, 4, () => .5), { type: 'start' })
    const first = game.tiles[0], other = game.tiles.find(tile => tile.word.id !== first.word.id)!
    const group = [first, other]
    for (const tile of group) game = applyMemoryAction(game, { type: 'reveal', id: tile.id })
    expect(game.phase).toBe('review')
    expect(game.turned).toHaveLength(2)
    expect(game.attempts).toBe(1)
    expect(game.matched).toEqual([])
    expect(readMemoryGame(JSON.parse(JSON.stringify(game)))).toEqual(game)
    expect(() => applyMemoryAction(game, { type: 'reveal', id: game.tiles.at(-1)!.id })).toThrow('face-down')
    const continued = applyMemoryAction(game, { type: 'continue' })
    expect(continued.phase).toBe('play')
    expect(continued.turned).toEqual([])
    expect(continued.attempts).toBe(1)
    expect(continued.tiles).toEqual(game.tiles)
  })

  it('waits for a third card only if the first two are compatible', () => {
    let game = applyMemoryAction(createMemoryGame(words, 'triplets', 4), { type: 'start' })
    const group = game.tiles.filter(tile => tile.word.id === game.tiles[0].word.id)
    game = applyMemoryAction(game, { type: 'reveal', id: group[0].id })
    game = applyMemoryAction(game, { type: 'reveal', id: group[1].id })
    expect(game.phase).toBe('play')
    expect(game.attempts).toBe(0)
    expect(game.matched).toEqual([])
    const wrong = game.tiles.find(tile => tile.word.id !== group[0].word.id)!
    game = applyMemoryAction(game, { type: 'reveal', id: wrong.id })
    expect(game.phase).toBe('review')
    expect(game.turned).toHaveLength(3)
    expect(game.attempts).toBe(1)
    expect(readMemoryGame(game)).toEqual(game)
  })

  it('resumes old unfinished triplet mismatches and old full review turns', () => {
    const game = applyMemoryAction(createMemoryGame(words, 'triplets', 4), { type: 'start' })
    const first = game.tiles[0], second = game.tiles.find(tile => tile.word.id !== first.word.id)!
    const third = game.tiles.find(tile => tile.id !== first.id && tile.id !== second.id)!
    const oldPartial = { ...game, turned: [first.id, second.id] }
    const resumed = readMemoryGame(oldPartial)
    expect(resumed.phase).toBe('review')
    expect(resumed.attempts).toBe(1)
    expect(readMemoryGame(resumed)).toEqual(resumed)
    expect(readMemoryGame({ ...game, phase: 'review', attempts: 1, turned: [first.id, second.id, third.id] }).turned).toHaveLength(3)
    expect(oldPartial.attempts).toBe(0)
  })

  it('rejects repeated tile selections and partial or forged matching groups', () => {
    let game = createMemoryGame(words, 'triplets', 4)
    expect(() => applyMemoryAction(game, { type: 'continue' })).toThrow('mismatched')
    game = applyMemoryAction(game, { type: 'start' })
    game = applyMemoryAction(game, { type: 'reveal', id: 0 })
    expect(() => applyMemoryAction(game, { type: 'reveal', id: 0 })).toThrow('face-down')
    expect(() => applyMemoryAction(game, { type: 'reveal', id: -1 })).toThrow('face-down')
    expect(() => readMemoryGame({ ...game, matched: [1] })).toThrow('matching group')
    expect(() => readMemoryGame({ ...game, phase: 'review' })).toThrow('turn')
    expect(() => readMemoryGame({ ...game, tiles: game.tiles.map(tile => ({ ...tile, face: 'character' })) })).toThrow('matching group')
    expect(() => readMemoryGame({ ...game, turned: [0, 0] })).toThrow('inconsistent')
  })

  it('does not introduce unknown words or merge ambiguous senses', () => {
    expect(() => createMemoryGame(words.slice(0, 1), 'mixed', 2)).toThrow('Add 2')
    const sameForm = [{ ...words[0] }, { ...words[1], character: words[0].character }]
    expect(() => createMemoryGame(sameForm, 'triplets', 2)).toThrow('distinct')
    const game = createMemoryGame(words.slice(0, 2), 'mixed', 2)
    expect(new Set(game.tiles.map(tile => tile.word.id))).toEqual(new Set(words.slice(0, 2).map(word => word.id)))
  })
})
