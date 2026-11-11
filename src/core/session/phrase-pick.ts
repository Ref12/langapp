import { db } from '../database'
import { shippedSentences, type ShippedPhrase } from '../phrases/sentence-ref'
import { usableFor } from '../phrases/bank'
import { readyLesson } from '../phrases/dictionary'
import type { Catalog } from '../study/catalog'
import { createRng } from '../study/local-exercises'
import type { SkillPractice } from '../study/skill-map'
import { reachedLesson } from './dataset-source'

// The picker of a Phrases set (design 2.5): a pure function over the shipped phrases, the knowledge set, the practice counts and a seed, so a set is repeatable and testable.

/** Phrases per set: the same choices as the other counts (5, 10, 15, 20), 10 by default (a phrase round is quicker than a new-item round). */
export const PHRASE_COUNT_DEFAULT = 10

/** The order of a Phrases set, worded like the strategies of Practise by skill: least practised (the default) first, or the phrases of the most recently reached lessons first. */
export const PHRASE_ORDERS = ['least', 'recent'] as const
export type PhraseOrder = typeof PHRASE_ORDERS[number]

/** What is remembered about one phrase: how often it was practised (all skills together), how often it was right the first time, and when last. */
export interface PhrasePractice { count: number; wins: number; lastAt: number }

/** The practice of every ref: the counts of its skill rows added up (a row without `correct` adds no wins). */
export function practiceByRef(rows: readonly SkillPractice[]): Map<string, PhrasePractice> {
  const out = new Map<string, PhrasePractice>()
  for (const row of rows) {
    const found = out.get(row.ref) ?? { count: 0, wins: 0, lastAt: 0 }
    out.set(row.ref, { count: found.count + row.count, wins: found.wins + (row.correct ?? 0), lastAt: Math.max(found.lastAt, row.lastAt) })
  }
  return out
}

export interface PhrasePickInput {
  entries: readonly ShippedPhrase[]
  /** The knowledge set: a phrase is offered only when every word and grammar point it uses is in it. */
  known: ReadonlySet<string>
  /** The lesson of a phrase: the lesson by which all its words and grammar are introduced. */
  lessonOf: (phrase: ShippedPhrase['phrase']) => number
  /** The lesson the learner has reached. */
  reached: number
  /** Only the phrases that use at least one of these refs (a study set, or the items of a past lesson or session). */
  scope?: ReadonlySet<string>
  practice: ReadonlyMap<string, PhrasePractice>
  order: PhraseOrder
  count: number
  seed: number
}

export interface PhrasePick {
  refs: string[]
  /** How many phrases could be offered at all (the picked ones come from these). */
  ready: number
  /** Of the picked ones, how many were never practised. */
  never: number
  /** The lessons the picked ones come from (the lowest and the highest). */
  lessons?: { from: number; to: number }
}

/** The phrases that can be offered: checked, every word and grammar known, ready at or before the lesson reached (and in the scope, when there is one). */
export function phraseCandidates(input: Pick<PhrasePickInput, 'entries' | 'known' | 'lessonOf' | 'reached' | 'scope'>): ShippedPhrase[] {
  const { known, scope } = input
  return input.entries.filter(({ phrase }) => phrase.checked && usableFor(phrase, known) && input.lessonOf(phrase) <= input.reached
    && (!scope || phrase.words.some(ref => scope.has(ref)) || (phrase.grammar ?? []).some(ref => scope.has(ref))))
}

export function pickPhrases(input: PhrasePickInput): PhrasePick {
  const candidates = phraseCandidates(input)
  const rng = createRng(input.seed)
  const keyed = candidates.map(entry => ({ entry, key: rng(), count: input.practice.get(entry.ref)?.count ?? 0, lesson: input.lessonOf(entry.phrase) }))
  keyed.sort(input.order === 'recent' ? (a, b) => b.lesson - a.lesson || a.count - b.count || a.key - b.key : (a, b) => a.count - b.count || a.key - b.key)
  const picked = keyed.slice(0, Math.max(0, input.count))
  return { refs: picked.map(item => item.entry.ref), ready: candidates.length, never: picked.filter(item => !item.count).length,
    ...(picked.length ? { lessons: { from: Math.min(...picked.map(item => item.lesson)), to: Math.max(...picked.map(item => item.lesson)) } } : {}) }
}

/** The pick for the learner as they are now: the knowledge set, the lesson reached, the counts and the shipped phrases of the pack. */
export async function loadPhrasePick(catalog: Catalog, options: { order: PhraseOrder; count: number; seed: number; scope?: ReadonlySet<string> }): Promise<PhrasePick> {
  const [entries, knowledge, rows] = await Promise.all([shippedSentences(), db.knowledge.toArray(), db.skillPractice.toArray()])
  const known = new Set(knowledge.map(entry => entry.ref))
  return pickPhrases({ ...options, entries, known, lessonOf: phrase => readyLesson(catalog, phrase), reached: reachedLesson(catalog, known), practice: practiceByRef(rows) })
}
