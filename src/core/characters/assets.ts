import index from '../../data/characters/index.generated.json'
import { makeStrokeGuide } from './geometry'

export interface CharacterAssetSummary {
  character: string
  strokeCount: number
  reviewed: boolean
  variant: string
}

export interface CharacterAsset extends CharacterAssetSummary {
  paths: string[]
  provenance?: {
    sourceId: string
    sourceEntry: string
    sourceArchive: string
    sourceArchiveSha256: string
    member: string
    memberSha256: string
    generated: boolean
    validated: boolean
    review?: {
      date: string
      note: string
      reviewer: string
      recipe: { id: string; input: string; sha256: string; version: string }
    }
  }
}

export const characterAssetIndex: CharacterAssetSummary[] = index.characters
const summaries = new Map(characterAssetIndex.map(summary => [summary.character, { ...summary }]))
const pageFor = (character: string) => `u${(character.codePointAt(0)! >>> 8).toString(16).padStart(4, '0')}`
const assetUrl = (file: string) => `${import.meta.env.BASE_URL}characters/chinese/${file}`
export const characterAttributionUrl = assetUrl('ATTRIBUTION.html')
const chunks = new Map<string, Promise<Map<string, CharacterAsset>>>()
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const sourcePin = index.sourcePins['zh-writing-hanzi-writer']

function parseChunk(input: unknown, page: string): Map<string, CharacterAsset> {
  const invalid = () => new Error(`Invalid Chinese writing asset page: ${page}`)
  if (!object(input) || input.schemaVersion !== 1 || input.language !== 'chinese' || input.page !== page ||
    typeof input.notice !== 'string' || !input.notice.includes('ARPHIC PUBLIC LICENSE') || !Array.isArray(input.characters)) throw invalid()
  const expected = [...summaries.values()].filter(summary => pageFor(summary.character) === page)
  if (input.characters.length !== expected.length) throw invalid()
  const result = new Map<string, CharacterAsset>()
  for (const record of input.characters) {
    if (!object(record) || typeof record.character !== 'string') throw invalid()
    const summary = summaries.get(record.character)
    if (!summary || pageFor(record.character) !== page || result.has(record.character) || record.strokeCount !== summary.strokeCount ||
      record.reviewed !== summary.reviewed || record.variant !== summary.variant || !stringArray(record.paths) ||
      record.paths.length !== summary.strokeCount) throw invalid()
    const provenance = record.provenance
    const member = `data/${record.character}.json`
    const sourceEntry = `https://raw.githubusercontent.com/chanind/hanzi-writer-data/${sourcePin.revision}/${member}`
    if (!object(provenance) || provenance.sourceId !== 'zh-writing-hanzi-writer' || provenance.generated !== true || provenance.validated !== true ||
      provenance.sourceArchive !== sourcePin.archive || provenance.sourceArchiveSha256 !== sourcePin.archiveSha256 ||
      provenance.member !== member || !hash(provenance.memberSha256) || provenance.sourceEntry !== sourceEntry) throw invalid()
    const parsedProvenance: NonNullable<CharacterAsset['provenance']> = {
      sourceId: provenance.sourceId, sourceEntry, sourceArchive: provenance.sourceArchive,
      sourceArchiveSha256: provenance.sourceArchiveSha256, member, memberSha256: provenance.memberSha256,
      generated: provenance.generated, validated: provenance.validated,
    }
    if (summary.reviewed) {
      const review = provenance.review
      if (!object(review) || review.date !== '2026-09-15' || typeof review.note !== 'string' || !review.note ||
        typeof review.reviewer !== 'string' || !review.reviewer || !object(review.recipe) ||
        typeof review.recipe.id !== 'string' || review.recipe.input !== 'characters/recipes/reviewed-prototype.yaml' ||
        review.recipe.version !== '1' || !hash(review.recipe.sha256)) throw invalid()
      parsedProvenance.review = {
        date: review.date, note: review.note, reviewer: review.reviewer,
        recipe: { id: review.recipe.id, input: review.recipe.input, sha256: review.recipe.sha256, version: review.recipe.version },
      }
    } else if (provenance.review !== undefined) throw invalid()
    for (const [stroke, path] of record.paths.entries()) {
      try { makeStrokeGuide(path) } catch { throw new Error(`${invalid().message}: ${record.character} stroke ${stroke + 1}`) }
    }
    result.set(record.character, { ...summary, paths: [...record.paths], provenance: parsedProvenance })
  }
  return result
}

/** Fetches only the requested Unicode page; failed requests can be retried. */
export async function loadCharacterAsset(character: string): Promise<CharacterAsset> {
  if (!summaries.has(character)) throw new Error(`No Chinese writing guide is available for ${JSON.stringify(character)}.`)
  const page = pageFor(character)
  let request = chunks.get(page)
  if (!request) {
    request = (async () => {
      const response = await fetch(assetUrl(`${page}.generated.json`))
      if (!response.ok) throw new Error(`Unable to load Chinese writing guide (${response.status}).`)
      return parseChunk(await response.json(), page)
    })()
    chunks.set(page, request)
    void request.catch(() => { if (chunks.get(page) === request) chunks.delete(page) })
  }
  const asset = (await request).get(character)
  if (!asset) throw new Error(`Chinese writing page is missing ${character}.`)
  // Callers may keep or edit their copy without poisoning a cached page.
  return structuredClone(asset)
}
