import { requestStructuredJSON } from './structured'
import type { AIConnectionInput } from '../assistant/contracts'

// The in-app check pass: material the app itself had the AI write (drill sentences, conversations, lesson exercises, Sudoku phrases) is reviewed by one batched
// call on the assistant connection (the stronger model) before it is used. Material that fails is rewritten once, in one batch, and checked again; what still
// fails is dropped. If the check call itself fails, the material stays, marked unchecked, and the failure is logged: practice is never blocked by the check.
// The shipped phrase bank is checked offline (scripts/build-phrase-bank.mjs) and is not checked here.

export type JudgeItem =
  | { id: string; kind: 'sentence'; zh: string; en: string }
  | { id: string; kind: 'choice'; direction: 'zh-to-en' | 'en-to-zh'; prompt: string; options: string[]; answerIndex: number }
  | { id: string; kind: 'tiles'; zh: string; en: string }
  | { id: string; kind: 'conversation'; lines: { who: string; zh: string; en: string }[]; questions: { question: string; options: string[]; answerIndex: number }[] }

export interface Verdict { ok: boolean; reason: string }

const judgeSchema = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: { results: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'natural', 'matches', 'oneRight', 'wrongClear', 'reason'],
    properties: { id: { type: 'string' }, natural: { type: 'boolean' }, matches: { type: 'boolean' }, oneRight: { type: 'boolean' }, wrongClear: { type: 'boolean' }, reason: { type: 'string' } } } } },
}
const SYSTEM = 'You review practice material written by another model for an English-speaking learner of Mandarin. Be strict and concrete. Reply with JSON only.'
const QUESTIONS = 'For every item answer: natural (is the Chinese natural, correct everyday Mandarin?), matches (does the English match the Chinese in meaning?), ' +
  'oneRight (for items with options: is exactly one option right for the prompt, and is it the marked answer? true when the item has no options), ' +
  'wrongClear (for items with options: is every wrong option clearly wrong, with no second option that also reads as right, such as a near-duplicate that only adds or drops a small word? true when the item has no options), ' +
  'and a short reason when anything is false. Return {"results":[{"id","natural","matches","oneRight","wrongClear","reason"}]} with every id copied.'

/** Judges the items in one call. Items the reply leaves out have no verdict. Throws when the call fails. */
export async function judgeItems(connection: AIConnectionInput, items: readonly JudgeItem[], signal?: AbortSignal): Promise<Map<string, Verdict>> {
  const value = await requestStructuredJSON(connection, { name: 'material_check', schema: judgeSchema, system: SYSTEM, signal, maxOutputTokens: Math.min(6000, 400 + items.length * 120), user: `${QUESTIONS}\n${JSON.stringify({ items })}` })
  const verdicts = new Map<string, Verdict>()
  const rows = (value as { results?: unknown })?.results
  if (!Array.isArray(rows)) throw new Error('The check returned no results.')
  for (const row of rows as Record<string, unknown>[]) {
    if (typeof row?.id !== 'string') continue
    const ok = row.natural === true && row.matches === true && row.oneRight !== false && row.wrongClear !== false
    verdicts.set(row.id, { ok, reason: typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim().slice(0, 200) : ok ? '' : 'failed the check' })
  }
  return verdicts
}

export interface Review<T> {
  /** Passed the check (the originals), then the rewrites that passed it. */
  accepted: T[]
  /** Kept without a verdict: the check call failed or left it out. */
  unchecked: T[]
  dropped: { item: T; reason: string }[]
}

export interface ReviewIO<T> {
  describe(item: T): JudgeItem
  check(items: readonly JudgeItem[]): Promise<Map<string, Verdict>>
  /** One batch for all that failed: replacements for them, or fewer. Absent: failing material is dropped. */
  rewrite?(failed: readonly { item: T; reason: string }[]): Promise<T[]>
}

/**
 * Check, rewrite once, check again. `accepted` holds material that passed; `unchecked` holds material the check could not judge, which is used all the same.
 * A failure of the check call is logged and leaves everything unchecked.
 */
export async function reviewMaterial<T>(items: readonly T[], io: ReviewIO<T>, log: (message: string) => void = message => console.warn(message)): Promise<Review<T>> {
  const out: Review<T> = { accepted: [], unchecked: [], dropped: [] }
  if (!items.length) return out
  let verdicts: Map<string, Verdict>
  try { verdicts = await io.check(items.map(io.describe)) } catch (reason) {
    log(`The check pass failed; ${items.length} items are used unchecked: ${reason instanceof Error ? reason.message : String(reason)}`)
    return { ...out, unchecked: [...items] }
  }
  const failed: { item: T; reason: string }[] = []
  for (const item of items) {
    const verdict = verdicts.get(io.describe(item).id)
    if (!verdict) out.unchecked.push(item)
    else if (verdict.ok) out.accepted.push(item)
    else failed.push({ item, reason: verdict.reason })
  }
  if (!failed.length) return out
  if (!io.rewrite) { out.dropped.push(...failed); return out }
  let rewrites: T[] = []
  try { rewrites = await io.rewrite(failed) } catch (reason) {
    log(`Rewriting ${failed.length} failed items did not work; they are dropped: ${reason instanceof Error ? reason.message : String(reason)}`)
    out.dropped.push(...failed); return out
  }
  if (!rewrites.length) { out.dropped.push(...failed); return out }
  try {
    const second = await io.check(rewrites.map(io.describe))
    for (const item of rewrites) {
      const verdict = second.get(io.describe(item).id)
      if (verdict?.ok) out.accepted.push(item)
      else if (!verdict) out.unchecked.push(item)
      else out.dropped.push({ item, reason: verdict.reason })
    }
    // anything not replaced is gone
    out.dropped.push(...failed.slice(rewrites.length))
  } catch (reason) {
    log(`The second check failed; ${rewrites.length} rewritten items are used unchecked: ${reason instanceof Error ? reason.message : String(reason)}`)
    out.unchecked.push(...rewrites)
  }
  return out
}

/** The usual wiring: the judge call on the assistant connection. */
export const judgeWith = (connection: AIConnectionInput, signal?: AbortSignal) => (items: readonly JudgeItem[]) => judgeItems(connection, items, signal)
