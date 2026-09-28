import { z } from 'zod'

/** Phrase Potions: a word-sorting puzzle where each vial must end up holding one complete phrase. */
export const POTIONS_MAX_LEVEL = 300
const SEPARATOR = '\u0001'
const MAX_VIALS = 11

export const potionPhraseSchema = z.object({
  id: z.string().min(1).max(160),
  words: z.array(z.string().min(1).max(12)).min(2).max(7),
  pinyin: z.string().min(1).max(400),
  translation: z.string().min(1).max(400),
}).strict()
export type PotionPhrase = z.infer<typeof potionPhraseSchema>

const potionTileSchema = z.object({
  id: z.string().regex(/^[0-7]-[0-6]$/),
  text: z.string().min(1).max(12),
  phrase: z.number().int().min(0).max(7),
}).strict()
export type PotionTile = z.infer<typeof potionTileSchema>

export const potionsGameSchema = z.object({
  version: z.literal(1),
  id: z.literal('current'),
  gameId: z.string().min(1),
  revision: z.number().int().nonnegative().safe(),
  level: z.number().int().min(1).max(POTIONS_MAX_LEVEL),
  phrases: z.array(potionPhraseSchema).min(2).max(8),
  capacity: z.number().int().min(2).max(7),
  hidden: z.boolean(),
  revealed: z.boolean(),
  extra: z.boolean(),
  rows: z.array(z.array(potionTileSchema).max(7)).min(3).max(MAX_VIALS),
  moves: z.number().int().nonnegative().safe(),
  history: z.array(z.tuple([z.number().int().min(0).max(MAX_VIALS - 1), z.number().int().min(0).max(MAX_VIALS - 1)])).max(999),
  phase: z.enum(['play', 'complete']),
}).strict()
export type PotionsGame = z.infer<typeof potionsGameSchema>

export const potionsProgressSchema = z.object({
  version: z.literal(1),
  id: z.literal('progress'),
  maxLevel: z.number().int().min(0).max(POTIONS_MAX_LEVEL),
  stars: z.record(z.string().regex(/^[1-9][0-9]*$/), z.union([z.literal(1), z.literal(2), z.literal(3)])),
  brewed: z.array(z.string().min(1).max(160)).max(4000),
}).strict()
export type PotionsProgress = z.infer<typeof potionsProgressSchema>

export type PotionsAction =
  | { type: 'move'; from: number; to: number }
  | { type: 'undo' }
  | { type: 'reveal' }
  | { type: 'add-vial' }

export const emptyPotionsProgress: PotionsProgress = { version: 1, id: 'progress', maxLevel: 0, stars: {}, brewed: [] }

export function phraseText(phrase: Pick<PotionPhrase, 'words'>): string { return phrase.words.join('') }

/** Levels grow from three-word phrases in two vials to eight crowded five-word phrases. */
export function potionsLevelParams(level: number) {
  const target = clampLevel(level)
  return {
    phrases: Math.min(8, 2 + Math.floor(Math.sqrt(target) * 0.55)),
    lengths: target <= 8 ? [3] : target <= 30 ? [3, 4] : target <= 90 ? [3, 4, 5] : [4, 5],
    hidden: target >= 25 && (target % 5 === 0 || target % 7 === 0 || (target >= 120 && target % 2 === 1)),
    empties: target >= 15 && target % 5 === 0 ? 1 : 2,
  }
}

export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) throw new Error('Choose a level number.')
  return Math.max(1, Math.min(POTIONS_MAX_LEVEL, Math.trunc(level)))
}

/** Word pairs that may be stacked: the second word follows the first inside some phrase. */
export function potionPairs(phrases: readonly Pick<PotionPhrase, 'words'>[]): Set<string> {
  const pairs = new Set<string>()
  for (const phrase of phrases) {
    for (let index = 0; index < phrase.words.length - 1; index++) pairs.add(phrase.words[index] + SEPARATOR + phrase.words[index + 1])
  }
  return pairs
}

function rowText(row: readonly PotionTile[]): string { return row.map(tile => tile.text).join('') }

/** Which phrases are finished, and which vial holds each one. A duplicate vial does not count twice. */
export function potionsCompletion(game: Pick<PotionsGame, 'rows' | 'phrases'>): { done: boolean[]; rowPhrase: (number | undefined)[] } {
  const texts = game.rows.map(rowText)
  const claimed = new Set<number>()
  const done = game.phrases.map(phrase => {
    const wanted = phraseText(phrase)
    const index = texts.findIndex((text, row) => text === wanted && !claimed.has(row))
    if (index < 0) return false
    claimed.add(index)
    return true
  })
  const rowPhrase = game.rows.map((_, row) => {
    if (!claimed.has(row)) return undefined
    const index = game.phrases.findIndex(phrase => phraseText(phrase) === texts[row])
    return index < 0 ? undefined : index
  })
  return { done, rowPhrase }
}

export function canMovePotion(game: PotionsGame, from: number, to: number): { ok: true } | { ok: false; reason?: string } {
  const source = game.rows[from], destination = game.rows[to]
  if (game.phase !== 'play') return { ok: false, reason: 'This puzzle is already finished.' }
  if (!source || !destination || from === to) return { ok: false }
  if (!source.length) return { ok: false, reason: 'That vial is empty.' }
  if (destination.length >= game.capacity) return { ok: false, reason: 'That vial is full.' }
  if (!destination.length) return { ok: true }
  const word = source[source.length - 1].text, top = destination[destination.length - 1].text
  if (potionPairs(game.phrases).has(top + SEPARATOR + word)) return { ok: true }
  return { ok: false, reason: `\u201c${word}\u201d does not follow \u201c${top}\u201d in any phrase.` }
}

/** Three stars for a clean solve; revealing the colors or pouring an extra vial costs one each. */
export function potionStars(game: Pick<PotionsGame, 'hidden' | 'revealed' | 'extra'>): 1 | 2 | 3 {
  return (3 - (game.hidden && game.revealed ? 1 : 0) - (game.extra ? 1 : 0)) as 1 | 2 | 3
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

/** A reproducible generator so restarting a level deals the same puzzle. */
export function potionsRandom(level: number, phrases: readonly PotionPhrase[]): () => number {
  let hash = 2166136261
  for (const character of `${clampLevel(level)}:${phrases.map(phrase => phrase.id).join(',')}`) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619)
  }
  let state = hash >>> 0 || 1
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Scrambles a solved board by replaying legal moves backwards, so every generated
 * puzzle is guaranteed solvable.
 */
function scramble(rows: PotionTile[][], capacity: number, pairs: Set<string>, random: () => number, steps: number): void {
  let last: { id: string; from: number } | undefined
  for (let step = 0; step < steps; step++) {
    const sources: number[] = []
    rows.forEach((row, index) => {
      const size = row.length
      if (size && (size === 1 || pairs.has(row[size - 2].text + SEPARATOR + row[size - 1].text))) sources.push(index)
    })
    if (!sources.length) return
    const from = sources[Math.floor(random() * sources.length)]
    const tile = rows[from][rows[from].length - 1]
    const targets: [number, number][] = []
    let total = 0
    rows.forEach((row, index) => {
      if (index === from || row.length >= capacity) return
      if (last && last.id === tile.id && last.from === index) return
      const weight = !row.length ? 0.12 : pairs.has(row[row.length - 1].text + SEPARATOR + tile.text) ? 0.3 : 1
      targets.push([index, weight])
      total += weight
    })
    if (!targets.length) continue
    let pick = random() * total
    let to = targets[0][0]
    for (const [index, weight] of targets) { pick -= weight; if (pick <= 0) { to = index; break } }
    rows[to].push(rows[from].pop()!)
    last = { id: tile.id, from }
  }
}

/** Lower is a better scramble: finished phrases and leftover runs make a puzzle too easy. */
function disorder(rows: readonly PotionTile[][], phrases: readonly PotionPhrase[], pairs: Set<string>, empties: number): number {
  const texts = new Set(phrases.map(phraseText))
  let score = 0
  for (const row of rows) {
    if (row.length && texts.has(rowText(row))) score += 100
    for (let index = 0; index < row.length - 1; index++) if (pairs.has(row[index].text + SEPARATOR + row[index + 1].text)) score += 3
  }
  const empty = rows.filter(row => !row.length).length
  if (empty === 0) score += 12
  if (empty > empties) score += 8 * (empty - empties)
  return score
}

export function buildPotionsLevel(available: readonly PotionPhrase[], level: number, random: () => number = Math.random): PotionsGame {
  const target = clampLevel(level)
  const params = potionsLevelParams(target)
  const seen = new Set<string>()
  const usable = available.filter(phrase => {
    if (!potionPhraseSchema.safeParse(phrase).success) return false
    const text = phraseText(phrase)
    if (seen.has(text) || new Set(phrase.words).size < 2) return false
    seen.add(text)
    return true
  })
  if (usable.length < 2) throw new Error('Introduce more vocabulary so at least two lesson phrases are fully known.')
  let pool = usable.filter(phrase => params.lengths.includes(phrase.words.length))
  if (pool.length < Math.min(params.phrases, usable.length)) pool = usable
  const phrases = shuffle(pool, random).slice(0, Math.min(params.phrases, pool.length))
  const capacity = Math.max(...phrases.map(phrase => phrase.words.length))
  const pairs = potionPairs(phrases)
  const solved: PotionTile[][] = phrases.map((phrase, index) => phrase.words.map((text, position) => ({ id: `${index}-${position}`, text, phrase: index })))
  for (let empty = 0; empty < params.empties; empty++) solved.push([])
  const tiles = phrases.reduce((total, phrase) => total + phrase.words.length, 0)
  let best = solved.map(row => row.slice())
  let bestScore = Infinity
  for (let attempt = 0; attempt < 12; attempt++) {
    const rows = solved.map(row => row.slice())
    scramble(rows, capacity, pairs, random, tiles * 30)
    const score = disorder(rows, phrases, pairs, params.empties)
    if (score < bestScore) { bestScore = score; best = rows }
    if (score === 0) break
  }
  const rows = shuffle(best, random)
  const game: PotionsGame = {
    version: 1, id: 'current', gameId: crypto.randomUUID(), revision: 0, level: target, phrases, capacity,
    hidden: params.hidden, revealed: false, extra: false, rows, moves: 0, history: [], phase: 'play',
  }
  return { ...game, phase: potionsCompletion(game).done.every(Boolean) ? 'complete' : 'play' }
}

function expectedTiles(phrases: readonly PotionPhrase[]): Map<string, PotionTile> {
  const tiles = new Map<string, PotionTile>()
  phrases.forEach((phrase, index) => phrase.words.forEach((text, position) => {
    tiles.set(`${index}-${position}`, { id: `${index}-${position}`, text, phrase: index })
  }))
  return tiles
}

export function readPotionsGame(value: unknown): PotionsGame {
  const game = potionsGameSchema.parse(value)
  const texts = new Set(game.phrases.map(phraseText))
  const wanted = expectedTiles(game.phrases)
  const placed = game.rows.flat()
  if (texts.size !== game.phrases.length || new Set(game.phrases.map(phrase => phrase.id)).size !== game.phrases.length) {
    throw new Error('The saved Phrase Potions puzzle repeats a phrase.')
  }
  if (game.capacity !== Math.max(...game.phrases.map(phrase => phrase.words.length))) {
    throw new Error('The saved Phrase Potions puzzle has the wrong vial size.')
  }
  if (placed.length !== wanted.size || new Set(placed.map(tile => tile.id)).size !== placed.length
    || placed.some(tile => JSON.stringify(wanted.get(tile.id)) !== JSON.stringify(tile))) {
    throw new Error('The saved Phrase Potions puzzle is missing words.')
  }
  if (game.rows.length < game.phrases.length + 1 || game.rows.length > game.phrases.length + (game.extra ? 3 : 2)
    || game.rows.some(row => row.length > game.capacity)) {
    throw new Error('The saved Phrase Potions puzzle has an impossible vial arrangement.')
  }
  if ((game.revealed && !game.hidden) || game.history.length > game.moves
    || game.history.some(([from, to]) => from === to || from >= game.rows.length || to >= game.rows.length)) {
    throw new Error('The saved Phrase Potions history is inconsistent.')
  }
  if ((game.phase === 'complete') !== potionsCompletion(game).done.every(Boolean)) {
    throw new Error('The saved Phrase Potions puzzle does not match its finished state.')
  }
  return game
}

export function readPotionsProgress(value: unknown): PotionsProgress {
  if (value === undefined) return emptyPotionsProgress
  const progress = potionsProgressSchema.parse(value)
  if (Object.keys(progress.stars).some(level => Number(level) > progress.maxLevel)) {
    throw new Error('The saved Phrase Potions progress records an unreached level.')
  }
  return progress
}

export function recordPotionsLevel(progress: PotionsProgress, game: PotionsGame): PotionsProgress {
  const stars = potionStars(game)
  const brewed = new Set(progress.brewed)
  game.phrases.forEach(phrase => brewed.add(phrase.id))
  return {
    ...progress,
    maxLevel: Math.max(progress.maxLevel, game.level),
    stars: { ...progress.stars, [game.level]: Math.max(progress.stars[game.level] ?? 0, stars) as 1 | 2 | 3 },
    brewed: [...brewed].slice(-4000),
  }
}

export function applyPotionsAction(game: PotionsGame, action: PotionsAction): PotionsGame {
  if (game.phase === 'complete') throw new Error('This puzzle is finished. Start the next level to keep brewing.')
  const next = { ...game, revision: game.revision + 1 }
  if (action.type === 'reveal') {
    if (!game.hidden || game.revealed) throw new Error('The colors are already visible.')
    return { ...next, revealed: true }
  }
  if (action.type === 'add-vial') {
    if (game.extra) throw new Error('You have already poured the spare vial.')
    return { ...next, extra: true, rows: [...game.rows, []] }
  }
  if (action.type === 'undo') {
    if (!game.history.length) throw new Error('There is no move to undo.')
    const history = game.history.slice(0, -1)
    const [from, to] = game.history[game.history.length - 1]
    const rows = game.rows.map(row => row.slice())
    const tile = rows[to].pop()
    if (!tile) throw new Error('The saved move cannot be undone.')
    rows[from].push(tile)
    return { ...next, rows, history, moves: Math.max(0, game.moves - 1) }
  }
  const check = canMovePotion(game, action.from, action.to)
  if (!check.ok) throw new Error(check.reason ?? 'That pour is not allowed.')
  const rows = game.rows.map(row => row.slice())
  rows[action.to].push(rows[action.from].pop()!)
  const moved = { ...next, rows, moves: game.moves + 1, history: [...game.history, [action.from, action.to] as [number, number]] }
  return { ...moved, phase: potionsCompletion(moved).done.every(Boolean) ? 'complete' : 'play' }
}
