// The phrase bank as files: the authored YAML (curriculum/chinese/authoring/phrases/hsk-N.yaml, one per band) and the JSON the app loads lazily
// (src/data/phrases/hsk-N.json), generated from it by scripts/generate-app-curriculum.mjs. Shared by that generator and by build-phrase-bank.mjs.
//
// A band file is a flat list of phrases. Each phrase appears once and names every word it uses in 'words' (and the grammar patterns in 'grammar').
// 'id' counts from 1 within the file; it only lets a person see how many phrases a file holds (nothing keys on it). 'lastId' is the highest id ever
// given, so the id of a dropped phrase is not reused.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Document, isPair, parse, visit } from 'yaml'
import { z } from 'zod'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const PHRASE_BANDS = ['1', '2', '3', '4', '5', '6']
export const PHRASE_FILE_VERSION = 2
/** What the offline pipeline writes (ai), and what imports from books and media will write. catalog and drill phrases are made by the app, never stored here. */
export const FILE_SOURCES = ['ai', 'book', 'media']
export const defaultPhraseAuthoringDir = join(root, 'curriculum', 'chinese', 'authoring', 'phrases')
export const defaultPhraseJsonDir = join(root, 'src', 'data', 'phrases')

const place = z.union([z.string().min(1), z.number()])
/** Where an imported phrase came from: the title, and a chapter, page or timestamp. */
export const phraseRefSchema = z.object({ title: z.string().min(1), chapter: place.optional(), page: place.optional(), timestamp: place.optional() }).strict()

export const phraseSchema = z.object({
  id: z.number().int().positive(),
  zh: z.string().min(1), py: z.string().min(1), en: z.string().min(1),
  words: z.array(z.string().min(1)).min(1),
  grammar: z.array(z.string().min(1)).optional(),
  source: z.enum(FILE_SOURCES),
  ref: phraseRefSchema.optional(),
  checked: z.boolean(),
  lookahead: z.number().int().nonnegative().optional(),
  readyAt: z.number().int().nonnegative().optional(),
}).strict()

export const bandFileSchema = z.object({
  schemaVersion: z.literal(PHRASE_FILE_VERSION),
  band: z.string().min(1),
  lastId: z.number().int().nonnegative().optional(),
  phrases: z.array(phraseSchema),
}).strict().superRefine((file, context) => {
  const ids = new Set(), texts = new Set()
  for (const phrase of file.phrases) {
    if (ids.has(phrase.id)) context.addIssue({ code: 'custom', message: 'Duplicate phrase id ' + phrase.id })
    if (texts.has(phrase.zh)) context.addIssue({ code: 'custom', message: 'Phrase listed twice: ' + phrase.zh })
    ids.add(phrase.id); texts.add(phrase.zh)
    if (file.lastId !== undefined && phrase.id > file.lastId) context.addIssue({ code: 'custom', message: 'lastId ' + file.lastId + ' is below phrase id ' + phrase.id })
  }
})

const KEYS = ['id', 'zh', 'py', 'en', 'words', 'grammar', 'source', 'ref', 'checked', 'lookahead', 'readyAt']
/** A phrase with its fields in the file's order and no empty optional ones. */
export function cleanPhrase(phrase) {
  const out = {}
  for (const key of KEYS) {
    const value = phrase[key]
    if (value === undefined || (key === 'grammar' && !value.length)) continue
    out[key] = key === 'words' || key === 'grammar' ? [...value] : key === 'ref' ? { ...value } : value
  }
  return out
}

/** The highest id a file has used: its lastId or the highest phrase id. */
export const lastIdOf = file => Math.max(file.lastId ?? 0, ...file.phrases.map(phrase => phrase.id))

export function stringifyPhraseYaml({ band, lastId, phrases }) {
  const sorted = [...phrases].sort((a, b) => a.id - b.id).map(cleanPhrase)
  const data = { schemaVersion: PHRASE_FILE_VERSION, band: String(band), lastId: Math.max(lastId ?? 0, ...sorted.map(phrase => phrase.id)), phrases: sorted }
  const doc = new Document(data)
  doc.commentBefore = ' Phrase bank, HSK ' + band + ': one phrase per block, each listing every word (and grammar pattern) it uses. Written by scripts/build-phrase-bank.mjs; edit freely.\n' +
    ' id only counts the phrases (1, 2, 3 ...); lastId is the highest id ever given, so an id is never reused. Book or media phrases use source: book (or media) and ref: { title, chapter | page | timestamp }.\n' +
    ' src/data/phrases/hsk-' + band + '.json is generated from this file: npm run curriculum:generate.'
  visit(doc, { Seq(_, node, path) { const pair = path.at(-1); if (isPair(pair) && (pair.key?.value === 'words' || pair.key?.value === 'grammar')) node.flow = true } })
  const list = doc.get('phrases', true)
  list?.items.forEach((item, at) => { if (at > 0) item.spaceBefore = true })
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

/** A band file's text as { band, lastId, phrases }, or an error naming the file and the problem. */
export function parsePhraseYaml(text, band, label = 'hsk-' + band + '.yaml') {
  const parsed = bandFileSchema.safeParse(parse(text))
  if (!parsed.success) throw new Error('Invalid phrase file ' + label + ': ' + parsed.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('; '))
  if (parsed.data.band !== String(band)) throw new Error('Phrase file ' + label + ' is for band ' + parsed.data.band + ', not ' + band)
  return { band: String(band), lastId: lastIdOf(parsed.data), phrases: parsed.data.phrases }
}

export const phraseFile = (dir, band, extension = 'yaml') => join(dir, 'hsk-' + band + '.' + extension)

/** One band's file; an empty band when the file does not exist. */
export function readPhraseBand(dir, band) {
  const file = phraseFile(dir, band)
  return existsSync(file) ? parsePhraseYaml(readFileSync(file, 'utf8'), band, file) : { band, lastId: 0, phrases: [] }
}

/** Every band's file, checking that no phrase is listed in two bands. */
export function readPhraseBands(dir = defaultPhraseAuthoringDir) {
  const bands = PHRASE_BANDS.map(band => readPhraseBand(dir, band))
  const seen = new Map()
  for (const file of bands) for (const phrase of file.phrases) {
    if (seen.has(phrase.zh)) throw new Error('Phrase ' + phrase.zh + ' is in hsk-' + seen.get(phrase.zh) + ' and hsk-' + file.band + '; each phrase appears once')
    seen.set(phrase.zh, file.band)
  }
  return bands
}

/** The JSON the app loads for a band: the same phrases, in id order. */
export function phraseJson({ band, phrases }) {
  return { schemaVersion: PHRASE_FILE_VERSION, band: String(band), phrases: [...phrases].sort((a, b) => a.id - b.id).map(cleanPhrase) }
}
export const phraseJsonText = file => JSON.stringify(phraseJson(file)) + '\n'

/** [path, Buffer] for every generated band file, for the curriculum generator to write or to check against. */
export function phraseBankOutputs(authoringDir = defaultPhraseAuthoringDir, jsonDir = defaultPhraseJsonDir) {
  return readPhraseBands(authoringDir).map(file => [phraseFile(jsonDir, file.band, 'json'), Buffer.from(phraseJsonText(file))])
}

export function writeAtomic(file, text) { mkdirSync(dirname(file), { recursive: true }); const temp = file + '.tmp'; writeFileSync(temp, text); renameSync(temp, file) }

export function writePhraseBands(files, { authoringDir = defaultPhraseAuthoringDir, jsonDir } = {}) {
  for (const file of files) {
    writeAtomic(phraseFile(authoringDir, file.band), stringifyPhraseYaml(file))
    if (jsonDir) writeAtomic(phraseFile(jsonDir, file.band, 'json'), phraseJsonText(file))
  }
}

// ---------------------------------------------------------------- the old format (keyed by word)

const oldPhrase = raw => ({
  zh: raw.zh, py: raw.py, en: raw.en, words: [...(raw.words ?? [])], ...(raw.grammar?.length ? { grammar: [...raw.grammar] } : {}),
  source: raw.source ?? 'ai', checked: raw.checked === true, ...(raw.lookahead !== undefined ? { lookahead: raw.lookahead } : {}), ...(raw.readyAt !== undefined ? { readyAt: raw.readyAt } : {}),
})

/** An old band file ({ schemaVersion: 1, phrases: { wordLabel: [...] } }) as a flat list without ids; a phrase listed under several words comes once. */
export function readOldBank(json) {
  const seen = new Set(), out = []
  for (const list of Object.values(json?.phrases ?? {})) for (const raw of Array.isArray(list) ? list : []) { if (typeof raw?.zh !== 'string' || seen.has(raw.zh)) continue; seen.add(raw.zh); out.push(oldPhrase(raw)) }
  return out
}

/** True for a state file of the first format (phrases kept inside each word's record). */
export const isOldState = state => !!state && typeof state === 'object' && state.words && (state.version === 1 || Object.values(state.words).some(record => Array.isArray(record?.phrases)))

/** An old state file as { words: progress per word, phrases: the flat list without ids }. */
export function readOldState(state) {
  const words = {}, seen = new Set(), phrases = []
  for (const [lb, record] of Object.entries(state.words ?? {})) {
    const { phrases: list = [], ...progress } = record ?? {}
    words[lb] = progress
    for (const raw of list) { if (typeof raw?.zh !== 'string' || seen.has(raw.zh)) continue; seen.add(raw.zh); phrases.push(oldPhrase(raw)) }
  }
  return { words, phrases, ...(state.target !== undefined ? { target: state.target } : {}), ...(state.passes ? { passes: state.passes } : {}) }
}
