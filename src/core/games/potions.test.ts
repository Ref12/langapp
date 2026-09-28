import { expect, it } from 'vitest'
import { applyPotionsAction, buildPotionsLevel, canMovePotion, emptyPotionsProgress, phraseText, potionsCompletion, potionsLevelParams, potionsRandom, potionStars, readPotionsGame, readPotionsProgress, recordPotionsLevel, type PotionPhrase, type PotionsGame } from './potions'

const phrases: PotionPhrase[] = [
  { id: 'a', words: ['\u6211', '\u559c\u6b22', '\u8336'], pinyin: 'wo xi huan cha', translation: 'I like tea.' },
  { id: 'b', words: ['\u4ed6', '\u662f', '\u8001\u5e08'], pinyin: 'ta shi lao shi', translation: 'He is a teacher.' },
  { id: 'c', words: ['\u5979', '\u5728', '\u5bb6'], pinyin: 'ta zai jia', translation: 'She is at home.' },
  { id: 'd', words: ['\u6211\u4eec', '\u53bb', '\u5b66\u6821'], pinyin: 'wo men qu xue xiao', translation: 'We go to school.' },
  { id: 'e', words: ['\u4f60', '\u60f3', '\u5403', '\u996d'], pinyin: 'ni xiang chi fan', translation: 'You want to eat.' },
  { id: 'f', words: ['\u4eca\u5929', '\u5f88', '\u70ed'], pinyin: 'jin tian hen re', translation: 'Today is hot.' },
  { id: 'g', words: ['\u4ed6\u4eec', '\u5728', '\u770b', '\u4e66'], pinyin: 'ta men zai kan shu', translation: 'They are reading.' },
  { id: 'h', words: ['\u8fd9', '\u4e2a', '\u5f88', '\u597d'], pinyin: 'zhe ge hen hao', translation: 'This one is good.' },
  { id: 'i', words: ['\u6211', '\u4e0d', '\u77e5\u9053'], pinyin: 'wo bu zhi dao', translation: "I don't know." },
  { id: 'j', words: ['\u8bf7', '\u5750', '\u4e00\u4e0b'], pinyin: 'qing zuo yi xia', translation: 'Please sit down.' },
]

/** Depth-first search over pour states; every generated level must be reachable back to solved. */
function solvable(game: PotionsGame): boolean {
  const seen = new Set<string>()
  const search = (current: PotionsGame, depth: number): boolean => {
    if (potionsCompletion(current).done.every(Boolean)) return true
    if (depth === 0) return false
    const key = [...current.rows.map(row => row.map(tile => tile.text).join('\u0001'))].sort().join('|')
    if (seen.has(key)) return false
    seen.add(key)
    for (let from = 0; from < current.rows.length; from++) {
      for (let to = 0; to < current.rows.length; to++) {
        if (!canMovePotion(current, from, to).ok) continue
        const next = applyPotionsAction(current, { type: 'move', from, to })
        if (search({ ...next, phase: 'play' }, depth - 1)) return true
      }
    }
    return false
  }
  return search(game, 60)
}

it('deals scrambled but solvable levels that repeat exactly when restarted', () => {
  for (const level of [1, 2, 5, 9, 14]) {
    const game = buildPotionsLevel(phrases, level, potionsRandom(level, phrases))
    const params = potionsLevelParams(level)
    expect(game.level).toBe(level)
    expect(game.phrases).toHaveLength(Math.min(params.phrases, phrases.length))
    expect(game.rows).toHaveLength(game.phrases.length + params.empties)
    expect(game.capacity).toBe(Math.max(...game.phrases.map(phrase => phrase.words.length)))
    expect(game.rows.flat()).toHaveLength(game.phrases.reduce((total, phrase) => total + phrase.words.length, 0))
    expect(game.phase).toBe('play')
    expect(game.rows.some(row => row.map(tile => tile.text).join('') === phraseText(game.phrases[0]))).toBe(false)
    expect(solvable(game)).toBe(true)
    const again = buildPotionsLevel(phrases, level, potionsRandom(level, phrases))
    expect(again.rows).toEqual(game.rows)
    expect(again.gameId).not.toBe(game.gameId)
  }
})

it('scales difficulty and refuses to deal without two usable phrases', () => {
  expect(potionsLevelParams(1)).toMatchObject({ phrases: 2, lengths: [3], hidden: false, empties: 2 })
  expect(potionsLevelParams(15)).toMatchObject({ empties: 1, hidden: false })
  expect(potionsLevelParams(25).hidden).toBe(true)
  expect(potionsLevelParams(400).phrases).toBe(8)
  expect(() => buildPotionsLevel(phrases.slice(0, 1), 1)).toThrow('two lesson phrases')
  expect(() => buildPotionsLevel([{ ...phrases[0], words: ['\u597d', '\u597d'] }, phrases[1]], 1)).toThrow('two lesson phrases')
  expect(() => buildPotionsLevel(phrases, Number.NaN)).toThrow('level number')
})

function level(index = 1) { return buildPotionsLevel(phrases, index, potionsRandom(index, phrases)) }

it('pours only onto an empty vial or the word that precedes it', () => {
  const game = level()
  const [first, second] = game.phrases
  const rows = [[{ id: '0-0', text: first.words[0], phrase: 0 }], [{ id: '1-0', text: second.words[0], phrase: 1 }], []]
  const placed: PotionsGame = {
    ...game, capacity: 3, phrases: [first, second], rows: [...rows, [
      { id: '0-1', text: first.words[1], phrase: 0 }, { id: '0-2', text: first.words[2], phrase: 0 },
      { id: '1-1', text: second.words[1], phrase: 1 }, { id: '1-2', text: second.words[2], phrase: 1 },
    ].slice(0, 3)],
  }
  expect(canMovePotion(placed, 2, 0).ok).toBe(false)
  expect(canMovePotion(placed, 0, 2).ok).toBe(true)
  expect(canMovePotion(placed, 0, 0).ok).toBe(false)
  const wrong = canMovePotion(placed, 1, 0)
  expect(wrong.ok).toBe(false)
  expect(wrong.ok === false && wrong.reason).toContain(second.words[0])
})

it('counts pours, undoes them, and finishes when every vial holds one phrase', () => {
  let game = level()
  const first = game.phrases[0]
  const from = game.rows.findIndex(row => row.length)
  const to = game.rows.findIndex(row => !row.length)
  const lifted = game.rows[from][game.rows[from].length - 1]
  game = applyPotionsAction(game, { type: 'move', from, to })
  expect(game.moves).toBe(1)
  expect(game.history).toEqual([[from, to]])
  expect(game.rows[to]).toEqual([lifted])
  const undone = applyPotionsAction(game, { type: 'undo' })
  expect(undone.moves).toBe(0)
  expect(undone.history).toEqual([])
  expect(undone.rows[from][undone.rows[from].length - 1]).toEqual(lifted)
  expect(() => applyPotionsAction(undone, { type: 'undo' })).toThrow('no move to undo')
  const solved: PotionsGame = {
    ...game, moves: 9, history: [], phase: 'play',
    rows: [...game.phrases.map((phrase, index) => phrase.words.map((text, position) => ({ id: `${index}-${position}`, text, phrase: index }))), []],
  }
  const finished = applyPotionsAction({ ...solved, rows: [solved.rows[0].slice(0, -1), ...solved.rows.slice(1, -1), [solved.rows[0][solved.rows[0].length - 1]]] },
    { type: 'move', from: solved.rows.length - 1, to: 0 })
  expect(finished.phase).toBe('complete')
  expect(potionsCompletion(finished).done.every(Boolean)).toBe(true)
  expect(potionsCompletion(finished).rowPhrase[0]).toBe(0)
  expect(() => applyPotionsAction(finished, { type: 'undo' })).toThrow('finished')
  expect(phraseText(first)).toBe(first.words.join(''))
})

it('spends the reveal and the spare vial at most once each, costing one star each', () => {
  const plain = level(1)
  expect(plain.hidden).toBe(false)
  expect(() => applyPotionsAction(plain, { type: 'reveal' })).toThrow('already visible')
  const smoky = { ...plain, hidden: true }
  const revealed = applyPotionsAction(smoky, { type: 'reveal' })
  expect(revealed.revealed).toBe(true)
  expect(potionStars(revealed)).toBe(2)
  expect(() => applyPotionsAction(revealed, { type: 'reveal' })).toThrow('already visible')
  const spare = applyPotionsAction(revealed, { type: 'add-vial' })
  expect(spare.rows).toHaveLength(revealed.rows.length + 1)
  expect(spare.rows[spare.rows.length - 1]).toEqual([])
  expect(potionStars(spare)).toBe(1)
  expect(() => applyPotionsAction(spare, { type: 'add-vial' })).toThrow('spare vial')
  expect(potionStars(plain)).toBe(3)
})

it('rejects a saved puzzle whose words, vials, or finished state were tampered with', () => {
  const game = level(3)
  expect(readPotionsGame(JSON.parse(JSON.stringify(game)))).toEqual(game)
  const from = game.rows.findIndex(row => row.length)
  expect(() => readPotionsGame({ ...game, rows: game.rows.map((row, index) => index === from ? row.slice(1) : row) })).toThrow('missing words')
  expect(() => readPotionsGame({ ...game, rows: game.rows.map((row, index) => index === from ? [...row, row[0]] : row) })).toThrow('missing words')
  expect(() => readPotionsGame({ ...game, capacity: game.capacity + 1 })).toThrow('vial size')
  expect(() => readPotionsGame({ ...game, phrases: [game.phrases[0], game.phrases[0]] })).toThrow('repeats a phrase')
  expect(() => readPotionsGame({ ...game, revealed: true })).toThrow('history is inconsistent')
  expect(() => readPotionsGame({ ...game, history: [[0, 0]], moves: 1 })).toThrow('history is inconsistent')
  expect(() => readPotionsGame({ ...game, phase: 'complete' })).toThrow('finished state')
  expect(() => readPotionsGame({ ...game, rows: [...game.rows, [], [], []] })).toThrow('vial arrangement')
})

it('keeps the best star count per level and collects brewed phrases', () => {
  const game = { ...level(4), extra: true }
  expect(readPotionsProgress(undefined)).toEqual(emptyPotionsProgress)
  const first = recordPotionsLevel(emptyPotionsProgress, game)
  expect(first.maxLevel).toBe(4)
  expect(first.stars).toEqual({ 4: 2 })
  expect(first.brewed).toEqual(expect.arrayContaining(game.phrases.map(phrase => phrase.id)))
  const clean = recordPotionsLevel(first, { ...game, extra: false })
  expect(clean.stars).toEqual({ 4: 3 })
  expect(recordPotionsLevel(clean, { ...game, level: 2 })).toMatchObject({ maxLevel: 4, stars: { 2: 2, 4: 3 } })
  expect(readPotionsProgress(clean)).toEqual(clean)
  expect(() => readPotionsProgress({ ...clean, maxLevel: 1 })).toThrow('unreached level')
})
