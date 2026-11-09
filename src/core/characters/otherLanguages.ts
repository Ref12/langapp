/**
 * Japanese and Korean writing data, loaded lazily from public/characters/<language>/ (never part of the main bundle).
 * Same shape as the Chinese pages minus per-glyph provenance: one small index per language, then one page per Unicode page.
 * A character that is not in the language's own index is a miss. There is no fallback to Chinese or between languages.
 */
import type { CharacterAsset } from './assets'
import { makeStrokeGuide } from './geometry'
import { languageAssetUrl, languageFolder, languageName, type WritingLanguage } from './language'

type Other = Exclude<WritingLanguage, 'zh'>
interface PageRecord { strokeCount: number; paths: string[]; review?: 'ai-reviewed' }

const variants: Record<Other, string> = { ja: 'japanese-source', ko: 'original-monoline-pilot' }
const noticeMarkers: Record<Other, string> = { ja: 'ARPHIC PUBLIC LICENSE', ko: 'CC0' }
const pageFor = (character: string) => `u${(character.codePointAt(0)! >>> 8).toString(16).padStart(4, '0')}`
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const indexes = new Map<Other, Promise<Map<string, number>>>()
const pages = new Map<string, Promise<Map<string, PageRecord>>>()

/** For tests: forget everything loaded. */
export const resetOtherLanguages = () => { indexes.clear(); pages.clear() }

const fail = (language: Other, what: string) => new Error(`Invalid ${languageName[language]} writing asset ${what}`)

async function loadIndex(language: Other): Promise<Map<string, number>> {
  const response = await fetch(languageAssetUrl(language, 'index.generated.json'))
  if (!response.ok) throw new Error(`Unable to load ${languageName[language]} writing index (${response.status}).`)
  const data: unknown = await response.json()
  if (!object(data) || data.schemaVersion !== 1 || data.language !== languageFolder(language) || !object(data.characters)) throw fail(language, 'index')
  const result = new Map<string, number>()
  for (const [character, count] of Object.entries(data.characters)) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || Array.from(character).length !== 1) throw fail(language, `index entry ${character}`)
    result.set(character, count)
  }
  return result
}

function parsePage(input: unknown, language: Other, page: string, index: Map<string, number>): Map<string, PageRecord> {
  if (!object(input) || input.schemaVersion !== 1 || input.language !== languageFolder(language) || input.page !== page ||
    typeof input.notice !== 'string' || !input.notice.includes(noticeMarkers[language]) || !Array.isArray(input.characters)) throw fail(language, `page ${page}`)
  const expected = [...index.keys()].filter(character => pageFor(character) === page).length
  if (input.characters.length !== expected) throw fail(language, `page ${page}`)
  const result = new Map<string, PageRecord>()
  for (const record of input.characters) {
    if (!object(record) || typeof record.character !== 'string' || result.has(record.character) || pageFor(record.character) !== page ||
      index.get(record.character) !== record.strokeCount || !Array.isArray(record.paths) || record.paths.length !== record.strokeCount ||
      !record.paths.every(path => typeof path === 'string') || (record.review !== undefined && record.review !== 'ai-reviewed')) throw fail(language, `page ${page}: ${String(record.character)}`)
    for (const [stroke, path] of (record.paths as string[]).entries()) {
      try { makeStrokeGuide(path) } catch { throw fail(language, `page ${page}: ${record.character} stroke ${stroke + 1}`) }
    }
    result.set(record.character, { strokeCount: record.strokeCount, paths: [...record.paths as string[]], ...(record.review ? { review: record.review } : {}) })
  }
  return result
}

/** The characters this language has stroke data for (fetches only the small index). */
export async function loadLanguageCharacters(language: WritingLanguage): Promise<string[]> {
  if (language === 'zh') throw new Error('Chinese characters come from the bundled index.')
  return [...(await indexFor(language)).keys()]
}

/** The language's characters with their stroke counts. */
export const loadLanguageIndex = (language: Other): Promise<Map<string, number>> => indexFor(language)

function indexFor(language: Other) {
  let request = indexes.get(language)
  if (!request) {
    request = loadIndex(language)
    indexes.set(language, request)
    void request.catch(() => { if (indexes.get(language) === request) indexes.delete(language) })
  }
  return request
}

export async function loadOtherCharacterAsset(character: string, language: Other): Promise<CharacterAsset> {
  const miss = () => new Error(`No ${languageName[language]} writing guide is available for ${JSON.stringify(character)}.`)
  // Exact Unicode scalar, no normalization: keys that are not one scalar never reach the network.
  if (Array.from(character).length !== 1 || /[\uD800-\uDFFF]/.test(character)) throw miss()
  const index = await indexFor(language)
  if (!index.has(character)) throw miss()
  const page = pageFor(character)
  const key = `${language}/${page}`
  let request = pages.get(key)
  if (!request) {
    request = (async () => {
      const response = await fetch(languageAssetUrl(language, `${page}.generated.json`))
      if (!response.ok) throw new Error(`Unable to load ${languageName[language]} writing guide (${response.status}).`)
      return parsePage(await response.json(), language, page, index)
    })()
    pages.set(key, request)
    void request.catch(() => { if (pages.get(key) === request) pages.delete(key) })
  }
  const record = (await request).get(character)
  if (!record) throw new Error(`${languageName[language]} writing page is missing ${character}.`)
  return {
    character, strokeCount: record.strokeCount, reviewed: false, variant: variants[language], paths: [...record.paths],
    ...(record.review ? { review: record.review } : {}),
  }
}
