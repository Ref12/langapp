import { hasGuide, isHan } from '../characters/writing-route'
import { createRng, seedFrom } from '../study/local-exercises'
import type { Mark } from './contracts'

/** The characters of a word that Write it can check stroke by stroke: Han characters with a stroke guide. */
export const guidedChars = (zh: string, has: (character: string) => boolean = hasGuide): string[] => Array.from(zh).filter(character => isHan(character) && has(character))

export interface WriteChar {
  char: string
  /** The word whose pinyin sentence cues this character. */
  cue: string
  /** The character's place among the cue word's Han characters (its syllable). */
  index: number
  /** Every word of the set that contains the character. */
  words: string[]
}

/**
 * The Characters queue of Write it: every distinct guided character of the words, once, shuffled across words (stable for a seed and pass).
 * A character shared by several words is cued by a different one of them on each pass. Characters in `skip` already have a result.
 */
export function writeQueue(words: readonly { ref: string; zh: string }[], options: { seed: string; pass: number; skip?: ReadonlySet<string>; has?: (character: string) => boolean }): WriteChar[] {
  const owners = new Map<string, { ref: string; zh: string }[]>()
  for (const word of words) for (const char of new Set(guidedChars(word.zh, options.has))) {
    if (options.skip?.has(char)) continue
    owners.set(char, [...(owners.get(char) ?? []), word])
  }
  const entries = [...owners.entries()].sort((a, b) => a[0].codePointAt(0)! - b[0].codePointAt(0)!).map(([char, list]): WriteChar => {
    const sorted = [...list].sort((a, b) => a.ref.localeCompare(b.ref))
    const cue = sorted[Math.abs(options.pass) % sorted.length]
    return { char, cue: cue.ref, index: Array.from(cue.zh).filter(isHan).indexOf(char), words: sorted.map(word => word.ref) }
  })
  const rng = createRng(seedFrom(`${options.seed}:${options.pass}`))
  for (let at = entries.length - 1; at > 0; at--) { const other = Math.floor(rng() * (at + 1)); [entries[at], entries[other]] = [entries[other], entries[at]] }
  return entries
}

const SEVERITY: Record<Mark, number> = { got: 0, hint: 1, missed: 2 }
/** A word's result for Write it: the worst of its characters' results. */
export const worstMark = (marks: readonly Mark[]): Mark => marks.reduce<Mark>((worst, mark) => SEVERITY[mark] > SEVERITY[worst] ? mark : worst, 'got')

/** The characters the learner has written successfully (stroke practice, or Drills): the ones with a saved practice completion. */
export const writtenCharacters = (states: readonly { character: string; practiceCompletions: number }[]): Set<string> =>
  new Set(states.filter(state => state.practiceCompletions > 0).map(state => state.character))

/** Distinct characters of these words that Write it can teach: guided Han characters never written successfully. */
export function newCharacters(words: readonly string[], states: readonly { character: string; practiceCompletions: number }[], has?: (character: string) => boolean): string[] {
  const written = writtenCharacters(states)
  return [...new Set(words.flatMap(zh => guidedChars(zh, has)))].filter(char => !written.has(char))
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
/** "4 words · 2 grammar patterns · 5 new characters": what a set of items holds. New characters are the ones Write it will teach. */
export function describeItems(items: readonly { kind: 'vocabulary' | 'grammar' | 'phrase' | 'source'; zh: string }[], states: readonly { character: string; practiceCompletions: number }[], has?: (character: string) => boolean): string {
  const words = items.filter(item => item.kind === 'vocabulary' || item.kind === 'source')
  const grammar = items.filter(item => item.kind === 'grammar').length
  const phrases = items.filter(item => item.kind === 'phrase').length
  const fresh = newCharacters(words.map(item => item.zh), states, has).length
  return [words.length ? plural(words.length, 'word', 'words') : '', grammar ? plural(grammar, 'grammar pattern', 'grammar patterns') : '', phrases ? plural(phrases, 'phrase', 'phrases') : '',
    fresh ? plural(fresh, 'new character', 'new characters') : ''].filter(Boolean).join(' · ')
}
