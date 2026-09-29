export interface Word {
  id: string
  character: string
  meaning: string
  pinyin: string
  englishAnswers: string[]
}

export type Mode = 'tap' | 'type'
export type Direction = 'chinese' | 'english' | 'character-pinyin' | 'pinyin-character'
export type WordForm = 'character' | 'meaning' | 'pinyin'
export type Pace = 'gentle' | 'standard' | 'brisk'
export interface Settings { mode: Mode; direction: Direction; pace: Pace; showPinyin?: boolean }
export const directionForms: Record<Direction, { prompt: WordForm; answer: WordForm }> = {
  chinese: { prompt: 'character', answer: 'meaning' },
  english: { prompt: 'meaning', answer: 'character' },
  'character-pinyin': { prompt: 'character', answer: 'pinyin' },
  'pinyin-character': { prompt: 'pinyin', answer: 'character' },
}
export function isDirection(value: string): value is Direction { return Object.prototype.hasOwnProperty.call(directionForms, value) }
export function allowsPinyinAnnotations(direction: Direction): boolean { return direction === 'chinese' || direction === 'english' }
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
export const ANSWER_BANK_SIZE = 12
export const MAX_INCOMING = 8
export const SHIELDS = 5
export const WAVE_SECONDS = 20

export function leadingWord(run: Run): Incoming | undefined {
  return run.incoming.reduce<Incoming | undefined>((leader, tile) =>
    !leader || tile.position < leader.position || (tile.position === leader.position && tile.id < leader.id) ? tile : leader, undefined)
}

function random(run: Run): number {
  run.randomState = (Math.imul(run.randomState, 1664525) + 1013904223) >>> 0
  return run.randomState / 2 ** 32
}

export function normalizeAnswer(text: string): string {
  return text.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?。！？]+$/u, '').trim()
}

export function answerText(word: Word, direction: Direction): string {
  return word[directionForms[direction].answer].normalize('NFC')
}

export function promptText(word: Word, direction: Direction): string {
  return word[directionForms[direction].prompt].normalize('NFC')
}

export function normalizePinyinInput(text: string): string {
  return normalizeAnswer(text).replace(/u:|v/g, 'ü').replace(/[\s'’]/g, '').replace(/([a-züê])[05]/g, '$1')
}

/** Source syllables are space-separated; neutral tones may be omitted or written 0/5. */
export function pinyinAnswerForms(pinyin: string): string[] {
  const toneNumbers: Record<string, string> = { '\u0304': '1', '\u0301': '2', '\u030c': '3', '\u0300': '4' }
  const syllables = pinyin.trim().normalize('NFD').split(/[\s'’]+/)
  const converted = syllables.map(syllable => {
    const marks = syllable.match(/[\u0304\u0301\u030c\u0300]/g) ?? []
    if (marks.length > 1) throw new Error('Separate pinyin syllables with spaces in the word deck.')
    const base = syllable.replace(/[\u0304\u0301\u030c\u0300]/g, '').normalize('NFC')
    if (!/^[a-züê]+$/i.test(base)) throw new Error('Use tone-marked pinyin syllables in the word deck.')
    const tone = marks[0] ? toneNumbers[marks[0]] : ''
    return { numbered: base + tone, combined: syllable.normalize('NFC') + tone }
  })
  return [...new Set([pinyin, converted.map(part => part.numbered).join(''), converted.map(part => part.combined).join('')].map(normalizePinyinInput))]
}

function acceptedAnswers(word: Word, direction: Direction): string[] {
  const form = directionForms[direction].answer
  return form === 'meaning' ? word.englishAnswers.map(normalizeAnswer)
    : form === 'pinyin' ? pinyinAnswerForms(word.pinyin) : [normalizeAnswer(word.character)]
}

export function paceAt(pace: Pace, wave: number) {
  const base = { gentle: { travel: 22, interval: 5.5 }, standard: { travel: 18, interval: 4.2 }, brisk: { travel: 14, interval: 3.2 } }[pace]
  const level = Math.max(0, wave - 1)
  return { travel: Math.max(6, base.travel - level * 1.4), interval: Math.max(.9, base.interval - level * .35) }
}

export function createRun(settings: Settings, words: readonly Word[], seed: number): Run {
  if (!['tap', 'type'].includes(settings.mode) || !isDirection(settings.direction)
    || !['gentle', 'standard', 'brisk'].includes(settings.pace)) throw new Error('Choose a valid mode, direction, and pace.')
  if (settings.showPinyin !== undefined && typeof settings.showPinyin !== 'boolean') throw new Error('Choose whether pinyin annotations are on or off.')
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('The game seed must be an unsigned integer.')
  if (!words.length || new Set(words.map(word => word.id)).size !== words.length) throw new Error('Defender needs at least one distinct word.')
  const answers = new Set<string>()
  const prompts = new Set<string>()
  for (const word of words) {
    if (!word.id || !word.character.trim() || !word.meaning.trim() || !word.pinyin.trim() || !word.englishAnswers.length) throw new Error('Every word needs Chinese, pinyin, a meaning, and accepted English answers.')
    pinyinAnswerForms(word.pinyin)
    const prompt = settings.direction === 'pinyin-character' ? normalizePinyinInput(word.pinyin) : normalizeAnswer(promptText(word, settings.direction))
    if (prompts.has(prompt)) throw new Error('The word deck has ambiguous prompts.')
    prompts.add(prompt)
    for (const normalized of new Set(acceptedAnswers(word, settings.direction))) {
      if (!normalized || answers.has(normalized)) throw new Error('The word deck has ambiguous answers.')
      answers.add(normalized)
    }
    if (settings.direction === 'chinese' && !word.englishAnswers.some(answer => normalizeAnswer(answer) === normalizeAnswer(word.meaning))) {
      throw new Error('The displayed translation must be an accepted answer.')
    }
  }
  const run: Run = {
    settings: { ...settings, showPinyin: allowsPinyinAnnotations(settings.direction) && settings.showPinyin === true },
    words: words.map(word => ({ ...word, englishAnswers: [...word.englishAnswers] })),
    phase: 'playing', elapsed: 0, wave: 1, score: 0, streak: 0, bestStreak: 0,
    hits: 0, wrong: 0, shields: SHIELDS, spawned: 0, nextSpawn: 0, randomState: seed, incoming: [], missed: [],
  }
  for (let i = run.words.length - 1; i > 0; i--) {
    const j = Math.floor(random(run) * (i + 1))
    ;[run.words[i], run.words[j]] = [run.words[j], run.words[i]]
  }
  run.words = run.words.slice(0, ANSWER_BANK_SIZE)
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

export function advanceRun(current: Run, seconds: number, waveEndAt?: number): { run: Run; events: GameEvent[] } {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1) throw new Error('Game updates must be between zero and one second.')
  if (waveEndAt !== undefined && (!Number.isFinite(waveEndAt) || waveEndAt < 0)) throw new Error('The wave deadline is invalid.')
  if (current.phase !== 'playing' || seconds === 0) return { run: current, events: [] }
  const run = copy(current), events: GameEvent[] = []
  let remaining = seconds
  while (remaining > .000001 && run.phase === 'playing') {
    const step = Math.min(.05, remaining)
    remaining -= step
    run.elapsed += step
    const wave = waveEndAt === undefined ? 1 + Math.floor(run.elapsed / WAVE_SECONDS) : run.wave
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
    if (run.nextSpawn <= 0 && (waveEndAt === undefined || run.elapsed < waveEndAt)) spawn(run)
  }
  return { run, events }
}

/** Common input boundary for tap, typing, and a future reviewed speech transcript. */
export function submitTranslation(current: Run, input: string): { run: Run; outcome: 'hit' | 'wrong' | 'ignored'; tile?: Incoming } {
  const answer = directionForms[current.settings.direction].answer === 'pinyin' ? normalizePinyinInput(input) : normalizeAnswer(input)
  const tile = leadingWord(current)
  if (current.phase !== 'playing' || !answer || !tile) return { run: current, outcome: 'ignored' }
  const run = copy(current), word = current.words.find(word => word.id === tile.wordId)!
  if (!acceptedAnswers(word, current.settings.direction).includes(answer)) {
    run.wrong++; run.streak = 0; return { run, outcome: 'wrong' }
  }
  run.incoming = run.incoming.filter(item => item.id !== tile.id)
  run.hits++
  run.streak++
  run.bestStreak = Math.max(run.bestStreak, run.streak)
  run.score += 100 + Math.min(run.streak - 1, 9) * 10
  return { run, outcome: 'hit', tile }
}

export function pauseRun(run: Run): Run { return run.phase === 'playing' ? { ...run, phase: 'paused' } : run }
export function resumeRun(run: Run): Run { return run.phase === 'paused' ? { ...run, phase: 'playing' } : run }
