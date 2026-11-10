import { getPack } from '../language'
import { hasGuide } from '../characters/writing-route'
import type { Mark } from './contracts'

/** The characters of a word that Write it and the stroke views take: every one the language has a stroke guide for (the pack's writing entry; Japanese: kanji and kana). */
export const guidedChars = (zh: string, has: (character: string) => boolean = hasGuide): string[] => Array.from(zh).filter(has)
/** The characters of a word that get a "new character" introduction: guided ones the pack's rule introduces (Japanese: kanji only). */
export const introducedChars = (zh: string, has: (character: string) => boolean = hasGuide): string[] => guidedChars(zh, has).filter(character => getPack().writing.introduces(character))

const SEVERITY: Record<Mark, number> = { got: 0, hint: 1, missed: 2 }
/** A word's result for Write it: the worst of its characters' results. */
export const worstMark = (marks: readonly Mark[]): Mark => marks.reduce<Mark>((worst, mark) => SEVERITY[mark] > SEVERITY[worst] ? mark : worst, 'got')

/** A character's writing state as the UI sees it: exactly two values. `writeState` is the learner's explicit answer; unset falls back to practice history. (`writeKnown` is the old flag, read as 'can'.) */
export type WriteState = { character: string; practiceCompletions: number; writeState?: 'can' | 'cannot'; writeKnown?: boolean }
/** The one definition of "can write": 'can', or no explicit answer and at least one completed practice. */
export const canWrite = (state: WriteState | undefined): boolean =>
  !state ? false : state.writeState ? state.writeState === 'can' : state.writeKnown === true || state.practiceCompletions > 0
export const writtenCharacters = (states: readonly WriteState[]): Set<string> =>
  new Set(states.filter(canWrite).map(state => state.character))

/** Distinct characters of these words that Write it can teach: guided characters the language introduces, never written successfully. */
export function newCharacters(words: readonly string[], states: readonly WriteState[], has?: (character: string) => boolean): string[] {
  const written = writtenCharacters(states)
  return [...new Set(words.flatMap(zh => introducedChars(zh, has)))].filter(char => !written.has(char))
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
/** "4 words · 2 grammar patterns · 5 new characters": what a set of items holds. New characters are the ones Write it will teach. */
export function describeItems(items: readonly { kind: 'vocabulary' | 'grammar' | 'phrase' | 'source'; zh: string }[], states: readonly WriteState[], has?: (character: string) => boolean): string {
  const words = items.filter(item => item.kind === 'vocabulary' || item.kind === 'source')
  const grammar = items.filter(item => item.kind === 'grammar').length
  const phrases = items.filter(item => item.kind === 'phrase').length
  const fresh = newCharacters(words.map(item => item.zh), states, has).length
  return [words.length ? plural(words.length, 'word', 'words') : '', grammar ? plural(grammar, 'grammar pattern', 'grammar patterns') : '', phrases ? plural(phrases, 'phrase', 'phrases') : '',
    fresh ? plural(fresh, 'new character', 'new characters') : ''].filter(Boolean).join(' · ')
}
