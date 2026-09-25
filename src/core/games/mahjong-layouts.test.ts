import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { getMahjongLayout, mahjongLayouts, parseMahjongLayout, parseMahjongLayouts } from './mahjong-layouts'
import { isFree, type Position } from './mahjong-geometry'
import { boardLayout, createMahjong, readMahjong, remainingTiles, removePair, reshuffleMahjong } from './mahjong'

const flat = {
  version: 1, id: 'small-test', name: 'Small test', description: 'A small test board.',
  layers: [{ rows: [{ y: 0, x: [0, 1, 2, 3] }, { y: 1, x: [0, 1, 2, 3] }] }],
}
const words = [
  { id: 'tea', character: '\u8336', pinyin: 'ch\u00e1', meaning: 'tea' },
  { id: 'rain', character: '\u96e8', pinyin: 'y\u01d4', meaning: 'rain' },
  { id: 'book', character: '\u4e66', pinyin: 'sh\u016b', meaning: 'book' },
  { id: 'person', character: '\u4eba', pinyin: 'r\u00e9n', meaning: 'person' },
]

describe('Mahjong YAML configurations', () => {
  it('automatically includes every layout file with a proven removal sequence', () => {
    const sources = import.meta.glob('../../data/mahjong/*.yaml')
    expect(mahjongLayouts).toHaveLength(Object.keys(sources).length)
    expect(mahjongLayouts.map(layout => layout.id)).toEqual(expect.arrayContaining(['courtyard', 'pagoda', 'bridges']))
    for (const layout of mahjongLayouts) {
      let remaining = layout.positions
      for (const pair of layout.solution) {
        expect(pair.every(tile => isFree(tile, remaining))).toBe(true)
        remaining = remaining.filter(tile => !pair.some(item => item.id === tile.id))
      }
      expect(remaining).toEqual([])
    }
  })

  it('retains the original courtyard coordinates and IDs for pre-YAML saved boards', () => {
    const original: Position[] = []
    const add = (x: number, y: number, z: number) => original.push({ id: original.length, x, y, z })
    for (let y = 0; y < 7; y++) {
      const columns = y === 0 || y === 6 ? [2, 3] : y === 3 ? [0, 1, 4, 5] : [0, 1, 2, 3, 4, 5]
      columns.forEach(x => add(x, y, 0))
    }
    for (const y of [1.25, 4.75]) for (const x of [.5, 1.5, 3.5, 4.5]) add(x, y, 1)
    for (const y of [2.5, 3.5]) for (const x of [.5, 4.5]) add(x, y, 1)
    for (const y of [1.5, 4.5]) for (const x of [1, 4]) add(x, y, 2)
    expect(getMahjongLayout('courtyard').positions).toEqual(original)
    const game = createMahjong(words)
    delete game.layoutSnapshot
    expect(boardLayout(readMahjong(game))).toEqual(original)
  })

  it.each(mahjongLayouts.map(layout => [layout.id, layout.positions.length] as const))('deals, reloads, and clears the %s layout (%i tiles)', (id, count) => {
    const configuration = getMahjongLayout(id)
    let game = createMahjong(words, 'mixed', () => .5, id)
    expect(game.tiles).toHaveLength(count)
    expect(game.layoutSnapshot).toMatchObject({ id, name: configuration.name, positions: configuration.positions })
    for (const pair of configuration.solution) {
      game = removePair(readMahjong(JSON.parse(JSON.stringify(game))), pair[0].id, pair[1].id)
    }
    expect(remainingTiles(game)).toEqual([])
  })

  it('keeps a saved snapshot usable when its configuration is no longer in the catalog', () => {
    const game = createMahjong(words, 'mixed', () => .5, 'pagoda')
    game.layout = 'retired-pagoda'
    game.layoutSnapshot = { ...game.layoutSnapshot!, id: 'retired-pagoda', name: 'Earlier Pagoda' }
    const stored = readMahjong(JSON.parse(JSON.stringify(game)))
    expect(boardLayout(stored)).toEqual(getMahjongLayout('pagoda').positions)
    expect(readMahjong(reshuffleMahjong(stored)).layoutSnapshot?.name).toBe('Earlier Pagoda')
    expect(() => getMahjongLayout('retired-pagoda')).toThrow('Unknown')
  })

  it('rejects an inconsistent or overlapping saved geometry snapshot', () => {
    const game = createMahjong(words)
    expect(() => readMahjong({ ...game, layout: 'different-id' })).toThrow('does not match')
    game.layoutSnapshot!.positions[1] = { ...game.layoutSnapshot!.positions[0], id: 1 }
    expect(() => readMahjong(game)).toThrow('overlaps')
  })

  it('accepts a new file without a code registry entry', () => {
    const layouts = parseMahjongLayouts({ 'new-pattern.yaml': stringify(flat) })
    expect(layouts[0]).toMatchObject({ id: 'small-test', name: 'Small test' })
    expect(layouts[0].positions).toHaveLength(8)
  })

  it('supports configuration snapshots larger than the original 48-tile board', () => {
    const configuration = parseMahjongLayout(stringify({
      ...flat,
      layers: [{ rows: Array.from({ length: 6 }, (_, y) => ({ y, x: Array.from({ length: 12 }, (_, x) => x) })) }],
    }), 'large.yaml')
    const game = {
      ...createMahjong(words),
      layout: configuration.id,
      layoutSnapshot: { id: configuration.id, name: configuration.name, positions: configuration.positions },
      tiles: configuration.solution.flatMap((positions, i) => positions.map((position, index) => ({
        ...position, word: words[i % words.length], face: index ? 'pinyin' as const : 'character' as const,
      }))),
    }
    expect(readMahjong(game).tiles).toHaveLength(72)
    expect(readMahjong(reshuffleMahjong(game)).tiles).toHaveLength(72)
  })

  it.each([
    { ...flat, version: 2 },
    { ...flat, typo: true },
    { ...flat, layers: [{ rows: [{ y: 0, x: [0, 1, 2, 3, 4, 5, 6, 7, 8] }] }] },
    { ...flat, layers: [{ rows: [{ y: 0, x: [0, 0, 1, 2, 3, 4, 5, 6] }] }] },
    { ...flat, layers: [{ rows: [{ y: 0, x: [0, .5, 2, 3, 4, 5, 6, 7] }] }] },
    { ...flat, layers: [{ rows: [{ y: 0, x: [0, 1, 2, 3, 4, 5, 6, 12] }] }] },
    { ...flat, layers: [{ rows: [{ y: .1, x: [0, 1, 2, 3] }, { y: 1, x: [0, 1, 2, 3] }] }] },
    { ...flat, layers: [...flat.layers, { rows: [{ y: 5, x: [0, 1] }] }] },
  ])('rejects invalid structure or geometry with the file name (case %#)', value => {
    expect(() => parseMahjongLayout(stringify(value), 'broken.yaml')).toThrow('Invalid Mahjong layout broken.yaml')
  })

  it('rejects geometrically supported but impossible removal layouts', () => {
    const value = {
      ...flat,
      layers: [
        { rows: [{ y: 0, x: [0, 1, 2] }] },
        { rows: [{ y: 0, x: [0, 1] }] },
        { rows: [{ y: 0, x: [0] }] },
        { rows: [{ y: 0, x: [0] }] },
        { rows: [{ y: 0, x: [0] }] },
      ],
    }
    expect(() => parseMahjongLayout(stringify(value), 'impossible.yaml')).toThrow('no complete legal removal sequence')
  })

  it('rejects duplicate IDs, YAML aliases, duplicate keys, tags, and an empty catalog', () => {
    expect(() => parseMahjongLayouts({ 'a.yaml': stringify(flat), 'b.yaml': stringify(flat) })).toThrow('Duplicate Mahjong layout ID')
    expect(() => parseMahjongLayout(`${stringify(flat)}name: Another\n`, 'duplicate.yaml')).toThrow('duplicate.yaml')
    expect(() => parseMahjongLayout('version: !unknown 1\n', 'tag.yaml')).toThrow('tag.yaml')
    expect(() => parseMahjongLayout('a: &a [1, 2]\nb: *a\n', 'alias.yaml')).toThrow('alias.yaml')
    expect(() => parseMahjongLayouts({})).toThrow('No Mahjong')
  })
})
