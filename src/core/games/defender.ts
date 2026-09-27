import { z } from 'zod'
import { advanceRun, allowsPinyinAnnotations, ANSWER_BANK_SIZE, createRun, leadingWord, paceAt, pauseRun, resumeRun, SHIELDS, submitTranslation, type Settings, type Word } from '../../../shared/defender-engine'
import { distinctWords, gameWordSchema } from './game-vocabulary'
import { requireUnit, type Catalog } from '../study/catalog'
import type { Workspace } from '../model'

export { answerText, directionForms, isDirection, allowsPinyinAnnotations, leadingWord, promptText, SHIELDS } from '../../../shared/defender-engine'
export type { Settings, Word } from '../../../shared/defender-engine'

const WAVE_SECONDS = 60

export const defenderSettingsSchema = z.object({
  mode: z.enum(['tap', 'type']),
  direction: z.enum(['chinese', 'english', 'character-pinyin', 'pinyin-character']),
  pace: z.enum(['gentle', 'standard', 'brisk']),
  showPinyin: z.boolean().optional(),
}).strict()
const wordSchema = gameWordSchema.extend({ englishAnswers: z.array(z.string().min(1).max(100)).min(1).max(20) }).strict()
const count = z.number().int().nonnegative().safe()
const time = z.number().finite().nonnegative().max(86400)
const ref = z.string().min(1)
const defenderRunSchema = z.object({
  settings: defenderSettingsSchema,
  words: z.array(wordSchema).min(1).max(ANSWER_BANK_SIZE),
  phase: z.enum(['playing', 'paused', 'over']),
  elapsed: time, wave: z.number().int().min(1).max(5000),
  score: count, streak: count, bestStreak: count, hits: count, wrong: count,
  shields: z.number().int().min(0).max(SHIELDS), spawned: count,
  nextSpawn: z.number().finite().min(-86400).max(6),
  randomState: z.number().int().min(0).max(0xffffffff),
  incoming: z.array(z.object({
    id: z.number().int().positive().safe(), wordId: ref, lane: z.number().int().min(0).max(3),
    position: z.number().finite().min(0).max(1), speed: z.number().finite().positive().max(1),
  }).strict()).max(8),
  missed: z.array(ref).max(SHIELDS),
}).strict()
export const defenderGameSchema = z.object({
  version: z.literal(1), id: z.literal('current'), gameId: ref, revision: count,
  pool: z.array(wordSchema).min(1).max(10000),
  seen: z.array(ref).min(1).max(10000),
  review: z.array(ref).max(ANSWER_BANK_SIZE),
  stage: z.enum(['wave', 'between']),
  waveEndAt: time,
  run: defenderRunSchema,
}).strict()
export type DefenderGame = z.infer<typeof defenderGameSchema>

export function defenderKnowledgeWords(catalog: Catalog, workspace: Workspace): Word[] {
  const words = workspace.knowledge.flatMap(entry => {
    const unit = requireUnit(catalog, entry.ref)
    if (unit.kind !== 'vocabulary') return []
    return [{ id: unit.ref, character: unit.record.ch, pinyin: unit.record.pr.normalize('NFC'), meaning: unit.record.ds }]
  })
  return distinctWords(words).map(word => ({ ...word, englishAnswers: [word.meaning] }))
}

export function createDefenderGame(words: Word[], settings: Settings, seed: number): DefenderGame {
  if (!words.length) throw new Error('Add a vocabulary word to your knowledge set before playing Defender.')
  const run = createRun(settings, words, seed)
  return readDefenderGame({
    version: 1, id: 'current', gameId: crypto.randomUUID(), revision: 0,
    pool: words.map(word => ({ ...word, englishAnswers: [...word.englishAnswers] })),
    seen: run.words.map(word => word.id), review: [], stage: 'wave', waveEndAt: WAVE_SECONDS, run,
  })
}

export function readDefenderGame(value: unknown): DefenderGame {
  const game = defenderGameSchema.parse(value)
  const pool = new Map(game.pool.map(word => [word.id, word]))
  const bank = new Set(game.run.words.map(word => word.id))
  if (pool.size !== game.pool.length || bank.size !== game.run.words.length
    || game.run.words.some(word => JSON.stringify(word) !== JSON.stringify(pool.get(word.id)))
    || [game.seen, game.review].some(ids => new Set(ids).size !== ids.length)
    || game.seen.some(id => !pool.has(id)) || game.review.some(id => !bank.has(id))
    || game.run.words.some(word => !game.seen.includes(word.id))
    || new Set(game.run.incoming.map(tile => tile.id)).size !== game.run.incoming.length
    || game.run.incoming.some(tile => !bank.has(tile.wordId) || tile.id > game.run.spawned)
    || game.run.missed.some(id => !pool.has(id))
    || game.run.missed.length !== SHIELDS - game.run.shields
    || (game.run.shields === 0 && game.run.phase !== 'over')
    || game.run.streak > game.run.bestStreak || game.run.bestStreak > game.run.hits
    || game.waveEndAt <= 0 || game.waveEndAt > game.run.elapsed + WAVE_SECONDS + .001
    || (game.stage === 'between' && (game.run.phase !== 'paused' || game.run.incoming.length !== 0 || game.run.elapsed < game.waveEndAt))) {
    throw new Error('The saved Defender run is inconsistent.')
  }
  if (game.run.settings.showPinyin && !allowsPinyinAnnotations(game.run.settings.direction)) throw new Error('Pronunciation challenges cannot show pinyin hints.')
  createRun(game.run.settings, game.pool, game.run.randomState)
  return game
}

function settleWave(game: DefenderGame): DefenderGame {
  if (game.run.phase === 'playing' && game.run.elapsed >= game.waveEndAt && !game.run.incoming.length) {
    return { ...game, stage: 'between', run: pauseRun(game.run) }
  }
  return game
}

export function tickDefender(game: DefenderGame, seconds: number) {
  if (game.stage !== 'wave') return { game, events: [] }
  const advanced = advanceRun(game.run, seconds, game.waveEndAt)
  const review = [...new Set([...game.review, ...advanced.events.flatMap(event => event.type === 'breach' ? [event.tile.wordId] : [])])]
  return { game: settleWave({ ...game, run: advanced.run, review }), events: advanced.events }
}

export function answerDefender(game: DefenderGame, answer: string) {
  if (game.stage !== 'wave') return { game, outcome: 'ignored' as const }
  const leader = leadingWord(game.run)
  const result = submitTranslation(game.run, answer)
  const review = result.outcome === 'wrong' && leader ? [...new Set([...game.review, leader.wordId])] : game.review
  return { ...result, game: settleWave({ ...game, run: result.run, review }) }
}

export function nextDefenderWords(game: DefenderGame): Word[] {
  let seed = game.run.randomState
  const words = [...game.pool]
  for (let i = words.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const j = Math.floor(seed / 2 ** 32 * (i + 1))
    ;[words[i], words[j]] = [words[j], words[i]]
  }
  const review = new Set(game.review), seen = new Set(game.seen), previous = new Set(game.run.words.map(word => word.id))
  return [
    ...words.filter(word => review.has(word.id)),
    ...words.filter(word => !review.has(word.id) && !seen.has(word.id)),
    ...words.filter(word => !review.has(word.id) && seen.has(word.id) && !previous.has(word.id)),
    ...words.filter(word => !review.has(word.id) && previous.has(word.id)),
  ].slice(0, ANSWER_BANK_SIZE)
}

export function startNextDefenderWave(game: DefenderGame): DefenderGame {
  if (game.stage !== 'between') throw new Error('Finish the current wave before changing its words.')
  const fresh = createRun(game.run.settings, nextDefenderWords(game), game.run.randomState)
  const pace = paceAt(game.run.settings.pace, game.run.wave + 1)
  // Preserve the running score and time; only the word bank and spawn state change.
  return {
    ...game, stage: 'wave', review: [], seen: [...new Set([...game.seen, ...fresh.words.map(word => word.id)])],
    waveEndAt: game.run.elapsed + WAVE_SECONDS,
    run: {
      ...game.run, words: fresh.words, phase: 'playing', wave: game.run.wave + 1,
      randomState: fresh.randomState, spawned: game.run.spawned + 1, nextSpawn: pace.interval,
      incoming: fresh.incoming.map(tile => ({ ...tile, id: game.run.spawned + tile.id, speed: 1 / pace.travel })),
    },
  }
}

export function pauseDefender(game: DefenderGame): DefenderGame { return { ...game, run: pauseRun(game.run) } }
export function resumeDefender(game: DefenderGame): DefenderGame {
  if (game.stage === 'between') return game
  return { ...game, run: resumeRun(game.run) }
}
export function endDefender(game: DefenderGame): DefenderGame { return { ...game, stage: 'wave', run: { ...game.run, phase: 'over' } } }
