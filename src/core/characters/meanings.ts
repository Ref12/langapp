/** A character's own pinyin and short English meaning (Unicode Unihan, first three senses). */
export interface CharacterMeaning { pinyin: string; meaning: string }

let table: Promise<Record<string, [string, string]>> | undefined
const url = () => `${import.meta.env?.BASE_URL ?? '/'}characters/chinese/meanings.generated.json`

/** For tests: forget the loaded table. */
export const resetCharacterMeanings = () => { table = undefined }

/** The dictionary senses first, then the curriculum's own meaning when it is not already among them. */
export function combineMeanings(dictionary?: string, curriculum?: string): string | undefined {
  if (!dictionary) return curriculum || undefined
  if (!curriculum) return dictionary
  const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()
  const wanted = norm(curriculum)
  return dictionary.split(';').some(sense => norm(sense) === wanted) || norm(dictionary).includes(wanted) ? dictionary : `${dictionary}; ${curriculum}`
}

/** The character's meaning, or undefined when there is none or the table cannot be loaded (the writing practice works without it). */
export async function loadCharacterMeaning(character: string): Promise<CharacterMeaning | undefined> {
  table ??= fetch(url()).then(response => response.ok ? response.json() as Promise<{ meanings?: Record<string, [string, string]> }> : Promise.reject(new Error(String(response.status))))
    .then(data => data.meanings ?? {}).catch(() => { table = undefined; return {} })
  const entry = (await table)[character]
  return entry?.[1] ? { pinyin: entry[0], meaning: entry[1] } : undefined
}
