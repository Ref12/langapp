import type { DictionaryCharacter } from './dictionary'
import type { CharacterState } from './contracts'

/** Where a built-in writing-guide character comes from: the lowest HSK reference band that spells it, with that word; kind w = word, e = example sentence, g = grammar pattern, t = only in the app's course tracks. */
export type CharacterOrigin = [band: string, word: string, kind: 'w' | 'e' | 'g' | 't']

let table: Promise<Record<string, CharacterOrigin>> | undefined
const url = () => `${import.meta.env?.BASE_URL ?? '/'}characters/chinese/origins.generated.json`

/** For tests: forget the loaded table. */
export const resetCharacterOrigins = () => { table = undefined }

export async function loadCharacterOrigin(character: string): Promise<CharacterOrigin | undefined> {
  table ??= fetch(url()).then(response => response.ok ? response.json() as Promise<{ origins?: Record<string, CharacterOrigin> }> : Promise.reject(new Error(String(response.status))))
    .then(data => data.origins ?? {}).catch(() => { table = undefined; return {} })
  return (await table)[character]
}

const date = (time: number) => new Date(time).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })
const bandLabel = (band: string) => band === '7-9' ? 'HSK 7\u20139' : `HSK ${band}`

/** What defines the built-in list, named once so the card and the page footnote agree. */
export const builtInListName = 'HSK 2021 standard word lists (bands 1\u20139) and the app course tracks'

/** One line saying why the character is in the app, most personal reason first. */
export function provenanceLine(input: { entry: DictionaryCharacter; knownWords: string[]; state?: CharacterState; origin?: CharacterOrigin }): string {
  const { entry, knownWords, state, origin } = input
  const parts: string[] = []
  if (knownWords.length) parts.push(`From your words: ${knownWords.slice(0, 3).join(', ')}${knownWords.length > 3 ? ` (+${knownWords.length - 3} more)` : ''}`)
  if (state?.manualAddedAt !== undefined) parts.push(`Added manually ${date(state.manualAddedAt)}`)
  if (entry.asset) {
    const place = !origin ? '' : origin[2] === 't' ? ' \u00b7 course tracks only' : ` \u00b7 ${bandLabel(origin[0])} ${origin[2] === 'w' ? 'word' : origin[2] === 'e' ? 'example' : 'pattern'} ${origin[1]}`
    parts.push(`Built-in writing guide${place}`)
  } else if (entry.words.length) parts.push(`In ${[...new Set(entry.bands)].map(bandLabel).join(', ')} words`)
  return parts.join(' \u00b7 ')
}
