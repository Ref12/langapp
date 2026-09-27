import { expect, it } from 'vitest'
import { starterWords } from '../../data/mandarin'
import { applyMemoryAction, createMemoryGame, readMemoryGame } from './memory'
import { MEMORY_MATCH_COLORS, memoryMatchedColors } from './memory-colors'

it('gives each matching group a distinct predefined color stable across reload and later matches', () => {
  const words = starterWords.map(word => ({ id: word.id, character: word.native, pinyin: word.pinyin, meaning: word.meaning }))
  let game = applyMemoryAction(createMemoryGame(words, 'triplets', 8), { type: 'start' })
  expect(memoryMatchedColors(game).size).toBe(0)
  for (const [index, id] of [...new Set(game.tiles.map(tile => tile.word.id))].entries()) {
    for (const tile of game.tiles.filter(tile => tile.word.id === id)) game = applyMemoryAction(game, { type: 'reveal', id: tile.id })
    expect(memoryMatchedColors(game).get(id)).toBe(MEMORY_MATCH_COLORS[index])
    expect(memoryMatchedColors(readMemoryGame(JSON.parse(JSON.stringify(game))))).toEqual(memoryMatchedColors(game))
  }
  expect(new Set([...memoryMatchedColors(game).values()].map(color => color.background)).size).toBe(8)
})

it('keeps the fixed palette text readable with at least 4.5:1 contrast', () => {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  }
  for (const color of MEMORY_MATCH_COLORS) {
    const background = luminance(color.background), ink = luminance(color.ink)
    expect((Math.max(background, ink) + .05) / (Math.min(background, ink) + .05)).toBeGreaterThanOrEqual(4.5)
  }
})
