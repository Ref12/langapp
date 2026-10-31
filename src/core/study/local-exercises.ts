import type { Unit } from './catalog'
import type { ChoiceExercise, Exercise, MatchExercise, MatchMode } from './contracts'
import { createSegmenter } from './exercises'

// Exercises built in code from the vocabulary records alone: no AI, no network. A lesson opens on these while the AI writes the rest,
// and they fill any shortfall when the AI fails. Everything here is pure and deterministic for a given seed, so the planned daily drills can reuse it.

export type VocabularyUnit = Extract<Unit, { kind: 'vocabulary' }>
export const MATCH_MODES: readonly MatchMode[] = ['zh-en', 'zh-py', 'py-en']
const MAX_MEANING_LENGTH = 40

export function isVocabulary(unit: Unit): unit is VocabularyUnit {
  return unit.kind === 'vocabulary'
}

/** A small deterministic generator (mulberry32). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable seed from text (a session id, for example). */
export function seedFrom(text: string): number {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return hash >>> 0
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(rng() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

/** The first sense of a dictionary gloss: "to enjoy; be fond of an activity" gives "to enjoy". Never the whole gloss, never very long. */
export function shortMeaning(gloss: string): string {
  const first = gloss.split(/[;；]/)[0].trim() || gloss.trim()
  if (first.length <= MAX_MEANING_LENGTH) return first
  const clause = first.split(/[,，]/)[0].trim()
  if (clause && clause.length <= MAX_MEANING_LENGTH) return clause
  const cut = first.slice(0, MAX_MEANING_LENGTH)
  return `${cut.slice(0, Math.max(1, cut.lastIndexOf(' '))).trim()}…`
}

/** What makes two meanings "the same" for distractor purposes. */
function meaningKey(unit: VocabularyUnit): string {
  return shortMeaning(unit.record.ds).toLowerCase().replace(/\(.*?\)/g, '').replace(/^(to|a|an|the)\s+/, '').replace(/\s+/g, ' ').trim()
}

const pinyinKey = (unit: VocabularyUnit) => unit.record.pr.trim()

/** Candidates of about the same level first (known items ahead of curriculum-only ones); the order inside a tier is the seed's. */
function ranked(target: VocabularyUnit, pool: readonly VocabularyUnit[], known: Set<string> | undefined, rng: () => number): VocabularyUnit[] {
  const score = (unit: VocabularyUnit) => Math.abs(Number(unit.band) - Number(target.band)) * 2 + (known?.has(unit.ref) ? 0 : 1)
  return shuffled(pool, rng).map(unit => ({ unit, score: score(unit) })).sort((a, b) => a.score - b.score).map(entry => entry.unit)
}

export interface BuildOptions { pool: readonly VocabularyUnit[]; known?: Set<string>; seed: number; id: string }

/** A choice exercise for one word. Wrong options never share the answer's meaning or characters, and never repeat each other. Undefined when fewer than one distractor exists. */
export function buildChoice(target: VocabularyUnit, direction: ChoiceExercise['direction'], options: BuildOptions): ChoiceExercise | undefined {
  const rng = createRng(options.seed)
  const characters = new Set([target.record.ch])
  const meanings = new Set([meaningKey(target)])
  const distractors: VocabularyUnit[] = []
  for (const candidate of ranked(target, options.pool, options.known, rng)) {
    if (distractors.length >= 3) break
    const key = meaningKey(candidate)
    if (candidate.ref === target.ref || characters.has(candidate.record.ch) || meanings.has(key) || !key) continue
    characters.add(candidate.record.ch)
    meanings.add(key)
    distractors.push(candidate)
  }
  if (!distractors.length) return undefined
  const text = (unit: VocabularyUnit) => direction === 'zh-to-en' ? shortMeaning(unit.record.ds) : unit.record.ch
  const order = shuffled([target, ...distractors], rng)
  return {
    id: options.id, type: 'choice', targets: [target.ref], direction,
    question: direction === 'zh-to-en' ? target.record.ch : shortMeaning(target.record.ds),
    options: order.map(text), answer: order.indexOf(target),
    explanation: `${target.record.ch} (${target.record.pr}) means ${target.record.ds}.`.slice(0, 400),
  }
}

const SIDES = { 'zh-en': ['zh', 'en'], 'zh-py': ['zh', 'py'], 'py-en': ['py', 'en'] } as const
export type MatchSide = 'zh' | 'py' | 'en'
export function matchSides(mode: MatchMode): readonly [MatchSide, MatchSide] {
  return SIDES[mode]
}

function sideText(unit: VocabularyUnit, side: MatchSide): string {
  return side === 'zh' ? unit.record.ch : side === 'py' ? unit.record.pr : shortMeaning(unit.record.ds)
}

export interface MatchOptions extends BuildOptions { focus: readonly VocabularyUnit[]; mode: MatchMode }

/**
 * A matching exercise of 4 or 5 words: the focus words first, padded from the pool. Two words never share characters, a meaning or (in a pinyin column)
 * the exact tone-marked pinyin, so every pair has one right partner. Undefined when fewer than 4 compatible words exist.
 */
export function buildMatch(options: MatchOptions): MatchExercise | undefined {
  const rng = createRng(options.seed)
  const sides = matchSides(options.mode)
  const size = Math.min(5, Math.max(4, options.focus.length))
  const characters = new Set<string>(), pinyins = new Set<string>(), meanings = new Set<string>()
  const chosen: VocabularyUnit[] = []
  const take = (unit: VocabularyUnit) => {
    if (chosen.length >= size) return
    const key = meaningKey(unit)
    if (!key || characters.has(unit.record.ch) || (sides.includes('py') && pinyins.has(pinyinKey(unit))) || (sides.includes('en') && meanings.has(key))) return
    if (chosen.some(other => other.ref === unit.ref)) return
    characters.add(unit.record.ch); pinyins.add(pinyinKey(unit)); meanings.add(key)
    chosen.push(unit)
  }
  for (const unit of options.focus) take(unit)
  if (chosen.length < size) for (const unit of ranked(options.focus[0] ?? options.pool[0], options.pool, options.known, rng)) take(unit)
  if (chosen.length < 4) return undefined
  const pairs = shuffled(chosen, rng).map(unit => ({ ref: unit.ref, left: sideText(unit, sides[0]), right: sideText(unit, sides[1]) }))
  let order = shuffled(pairs.map((_, index) => index), rng)
  if (order.every((value, index) => value === index)) order = [...order.slice(1), order[0]]
  return {
    id: options.id, type: 'match', targets: pairs.map(pair => pair.ref), mode: options.mode, pairs, order,
    explanation: pairs.map(pair => `${pair.left} = ${pair.right}`).join('; ').slice(0, 400),
  }
}

export interface LocalInput {
  /** The vocabulary to drill. Other units are ignored. */
  targets: readonly Unit[]
  /** Where wrong options and padding come from: the curriculum's vocabulary. */
  pool: readonly Unit[]
  known?: Set<string>
  seed: number
  /** 0 is the opening set; each higher variant flips the choice directions and rotates the match modes. */
  variant?: number
  idPrefix?: string
}

/** Splits n focus words into groups of 4 or 5 where possible: 8 gives 4 + 4, 9 gives 5 + 4, 6 gives 3 + 3 (each padded from the pool). */
export function matchGroups<T>(items: readonly T[]): T[][] {
  if (items.length < 4) return []
  const groups = Math.ceil(items.length / 5)
  const base = Math.floor(items.length / groups)
  const extra = items.length - base * groups
  const result: T[][] = []
  let start = 0
  for (let group = 0; group < groups; group++) {
    const size = base + (group < extra ? 1 : 0)
    result.push(items.slice(start, start + size)); start += size
  }
  return result
}

/** One pass of programmatic vocabulary exercises: a choice per word and matches over the words, the first match early. */
export function localVocabularyExercises(input: LocalInput): Exercise[] {
  const variant = input.variant ?? 0
  const prefix = input.idPrefix ?? 'local-'
  const pool = input.pool.filter(isVocabulary)
  const items = [...new Map(input.targets.filter(isVocabulary).map(unit => [unit.ref, unit])).values()]
  const choices: Exercise[] = []
  items.forEach((unit, index) => {
    const choice = buildChoice(unit, (variant + index) % 2 === 0 ? 'zh-to-en' : 'en-to-zh', { pool, known: input.known, seed: input.seed + variant * 1009 + index * 31, id: `${prefix}choice-${variant}-${index}` })
    if (choice) choices.push(choice)
  })
  const matches: Exercise[] = []
  matchGroups(items).forEach((group, index) => {
    for (let attempt = 0; attempt < MATCH_MODES.length; attempt++) {
      const mode = MATCH_MODES[(variant + index + attempt) % MATCH_MODES.length]
      const match = buildMatch({ focus: group, pool, known: input.known, mode, seed: input.seed + variant * 7919 + index * 101, id: `${prefix}match-${variant}-${index}` })
      if (match) { matches.push(match); break }
    }
  })
  const result: Exercise[] = []
  let next = 0
  choices.forEach((choice, index) => {
    result.push(choice)
    // The first match after three choices, the next ones four choices apart.
    if (next < matches.length && index + 1 === Math.min(choices.length, 3 + next * 4)) result.push(matches[next++])
  })
  return [...result, ...matches.slice(next)]
}

/** Up to `needed` more programmatic exercises in other forms than the opening set (the other direction, other match modes). */
export function fillLocalExercises(input: LocalInput, needed: number): Exercise[] {
  const extra: Exercise[] = []
  for (let variant = (input.variant ?? 0) + 1; variant <= (input.variant ?? 0) + 3 && extra.length < needed; variant++) {
    extra.push(...localVocabularyExercises({ ...input, variant }))
  }
  return extra.slice(0, Math.max(0, needed))
}

/** Known vocabulary found inside free phrases, in order of first appearance, for lessons that have no vocabulary targets of their own. */
export function vocabularyInPhrases(phrases: readonly { text: string }[], vocabulary: readonly Unit[]): VocabularyUnit[] {
  const words = vocabulary.filter(isVocabulary)
  const byForm = new Map<string, VocabularyUnit>()
  for (const unit of words) if (!byForm.has(unit.record.ch)) byForm.set(unit.record.ch, unit)
  const segmenter = createSegmenter(byForm.keys())
  const found = new Map<string, VocabularyUnit>()
  for (const phrase of phrases) for (const form of segmenter.segment(phrase.text)) { const unit = byForm.get(form); if (unit && !found.has(unit.ref)) found.set(unit.ref, unit) }
  return [...found.values()]
}
