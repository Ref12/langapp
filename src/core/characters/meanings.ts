import { defaultWritingLanguage, languageAssetUrl, type WritingLanguage } from './language'

/** A character's own pinyin and short English meaning (Unicode Unihan, first three senses). */
export interface CharacterMeaning { pinyin: string; meaning: string }

const tables = new Map<WritingLanguage, Promise<Record<string, [string, string]>>>()
const url = (language: WritingLanguage) => languageAssetUrl(language, 'meanings.generated.json')

/** For tests: forget the loaded table. */
export const resetCharacterMeanings = () => { tables.clear() }

/** The dictionary senses first, then the curriculum's own meaning when it is not already among them. */
export function combineMeanings(dictionary?: string, curriculum?: string): string | undefined {
  if (!dictionary) return curriculum || undefined
  if (!curriculum) return dictionary
  const norm = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim()
  const wanted = norm(curriculum)
  return dictionary.split(';').some(sense => norm(sense) === wanted) || norm(dictionary).includes(wanted) ? dictionary : `${dictionary}; ${curriculum}`
}

/** The character's meaning, or undefined when there is none or the table cannot be loaded (the writing practice works without it). */
export async function loadCharacterMeaning(character: string, language: WritingLanguage = defaultWritingLanguage): Promise<CharacterMeaning | undefined> {
  let table = tables.get(language)
  if (!table) {
    table = fetch(url(language)).then(response => response.ok ? response.json() as Promise<{ meanings?: Record<string, [string, string]> }> : Promise.reject(new Error(String(response.status))))
      .then(data => data.meanings ?? {}).catch(() => { tables.delete(language); return {} })
    tables.set(language, table)
  }
  const entry = (await table)[character]
  return entry?.[1] ? { pinyin: entry[0], meaning: entry[1] } : undefined
}
