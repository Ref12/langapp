import type { Word } from './deck'

export type Mode = 'tap' | 'type'
export type Direction = 'chinese' | 'english'
export type Pace = 'gentle' | 'standard' | 'brisk'
export interface Settings { mode: Mode; direction: Direction; pace: Pace }
export interface Incoming { id: number; wordId: string; lane: number; position: number; speed: number }
export type GameEvent = { type: 'hit' | 'breach'; tile: Incoming } | { type: 'wave'; wave: number }
export interface Run {
  settings: Settings
  words: Word[]
  phase: 'playing' | 'paused' | 'over'
  elapsed: number
  wave: number
  score: number
  streak: number
  bestStreak: number
  hits: number
  wrong: number
  shields: number
  spawned: number
  nextSpawn: number
  randomState: number
  incoming: Incoming[]
  missed: string[]
}
export const LANES = 4
export const MAX_INCOMING = 8
export const SHIELDS = 5
export const WAVE_SECONDS = 20

function random(run: Run): number {
  run.randomState = (Math.imul(run.randomState, 1664525) + 1013904223) >>> 0
  return run.randomState / 2 ** 32
}

export function normalizeAnswer(text: string): string {
  return text.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?。！？]+$/u, '').trim()
}

export function answerText(word: Word, direction: Direction): string {
  return direction === 'chinese' ? word.meaning : word.character
}

export function promptText(word: Word, direction: Direction): string {
  return direction === 'chinese' ? word.character : word.meaning
}

export function paceAt(pace: Pace, wave: number) {
  const base = { gentle: { travel: 22, interval: 5.5 }, standard: { travel: 18, interval: 4.2 }, brisk: { travel: 14, interval: 3.2 } }[pace]
  const level = Math.max(0, wave - 1)
  return { travel: Math.max(6, base.travel - level * 1.4), interval: Math.max(.9, base.interval - level * .35) }
}

export function createRun(settings: Settings, words: readonly Word[], seed: number): Run {
  if (!['tap', 'type'].includes(settings.mode) || !['chinese', 'english'].includes(settings.direction)
    || !['gentle', 'standard', 'brisk'].includes(settings.pace)) throw new Error('Choose a valid mode, direction, and pace.')
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('The game seed must be an unsigned integer.')
  if (words.length < 2 || new Set(words.map(word => word.id)).size !== words.length) throw new Error('The prototype needs at least two distinct words.')
  const answers = new Set<string>()
  for (const word of words) {
    if (!word.id || !word.character.trim() || !word.meaning.trim() || !word.englishAnswers.length) throw new Error('Every prototype word needs both forms and accepted English answers.')
    for (const answer of settings.direction === 'chinese' ? word.englishAnswers : [word.character]) {
      const normalized = normalizeAnswer(answer)
      if (!normalized || answers.has(normalized)) throw new Error('The prototype deck has ambiguous answers.')
      answers.add(normalized)
    }
    if (settings.direction === 'chinese' && !word.englishAnswers.some(answer => normalizeAnswer(answer) === normalizeAnswer(word.meaning))) {
      throw new Error('The displayed translation must be an accepted answer.')
    }
  }
  const run: Run = {
    settings: { ...settings }, words: words.map(word => ({ ...word, englishAnswers: [...word.englishAnswers] })),
    phase: 'playing', elapsed: 0, wave: 1, score: 0, streak: 0, bestStreak: 0,
    hits: 0, wrong: 0, shields: SHIELDS, spawned: 0, nextSpawn: 0, randomState: seed, incoming: [], missed: [],
  }
  for (let i = run.words.length - 1; i > 0; i--) {
    const j = Math.floor(random(run) * (i + 1))
    ;[run.words[i], run.words[j]] = [run.words[j], run.words[i]]
  }
  run.words = run.words.slice(0, 6)
  spawn(run)
  return run
}

function copy(run: Run): Run {
  return { ...run, incoming: run.incoming.map(tile => ({ ...tile })), missed: [...run.missed] }
}

function spawn(run: Run): void {
  // Keep enough lane spacing for fixed-width cards even on a phone.
  const lanes = Array.from({ length: LANES }, (_, lane) => lane)
    .filter(lane => run.incoming.filter(tile => tile.lane === lane).every(tile => tile.position < .18))
  if (!lanes.length || run.incoming.length >= MAX_INCOMING) { run.nextSpawn = .2; return }
  const lane = lanes[Math.floor(random(run) * lanes.length)]
  const pace = paceAt(run.settings.pace, run.wave)
  const ahead = run.incoming.filter(tile => tile.lane === lane)
  const speed = Math.min(1 / pace.travel, ...ahead.map(tile => tile.speed))
  run.incoming.push({ id: ++run.spawned, wordId: run.words[Math.floor(random(run) * run.words.length)].id, lane, position: 1, speed })
  run.nextSpawn = pace.interval
}

export function advanceRun(current: Run, seconds: number): { run: Run; events: GameEvent[] } {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1) throw new Error('Game updates must be between zero and one second.')
  if (current.phase !== 'playing' || seconds === 0) return { run: current, events: [] }
  const run = copy(current), events: GameEvent[] = []
  let remaining = seconds
  while (remaining > .000001 && run.phase === 'playing') {
    const step = Math.min(.05, remaining)
    remaining -= step
    run.elapsed += step
    const wave = 1 + Math.floor(run.elapsed / WAVE_SECONDS)
    if (wave !== run.wave) { run.wave = wave; events.push({ type: 'wave', wave }) }
    for (const tile of run.incoming) tile.position -= tile.speed * step
    const breached = run.incoming.filter(tile => tile.position <= 0)
    run.incoming = run.incoming.filter(tile => tile.position > 0)
    for (const tile of breached) {
      if (!run.shields) break
      run.shields--
      run.streak = 0
      run.missed.push(tile.wordId)
      events.push({ type: 'breach', tile: { ...tile } })
    }
    if (!run.shields) { run.phase = 'over'; break }
    run.nextSpawn -= step
    if (run.nextSpawn <= 0) spawn(run)
  }
  return { run, events }
}

/** Common input boundary for tap, typing, and a future reviewed speech transcript. */
export function submitTranslation(current: Run, input: string): { run: Run; outcome: 'hit' | 'wrong' | 'ignored'; tile?: Incoming } {
  const answer = normalizeAnswer(input)
  if (current.phase !== 'playing' || !answer) return { run: current, outcome: 'ignored' }
  const matches = current.incoming.filter(tile => {
    const word = current.words.find(word => word.id === tile.wordId)!
    const accepted = current.settings.direction === 'chinese' ? word.englishAnswers : [word.character]
    return accepted.some(value => normalizeAnswer(value) === answer)
  }).sort((a, b) => a.position - b.position || a.id - b.id)
  const run = copy(current), tile = matches[0]
  if (!tile) { run.wrong++; run.streak = 0; return { run, outcome: 'wrong' } }
  run.incoming = run.incoming.filter(item => item.id !== tile.id)
  run.hits++
  run.streak++
  run.bestStreak = Math.max(run.bestStreak, run.streak)
  run.score += 100 + Math.min(run.streak - 1, 9) * 10
  return { run, outcome: 'hit', tile }
}

export function pauseRun(run: Run): Run { return run.phase === 'playing' ? { ...run, phase: 'paused' } : run }
export function resumeRun(run: Run): Run { return run.phase === 'paused' ? { ...run, phase: 'playing' } : run }
