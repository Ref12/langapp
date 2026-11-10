// Offline projection of prepared Japanese and Korean stroke data into lazy Unicode-page JSON (public/characters/<language>/).
// Same page format as the Chinese data minus per-glyph provenance: the licence files and one attribution page ship next to it.
// Usage: node scripts/generate-app-writing-ja-ko.mjs [--check]
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { validateCharacterPath } from './generate-app-characters.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const json = value => `${JSON.stringify(value)}\n`
const pageFor = character => `u${(character.codePointAt(0) >>> 8).toString(16).padStart(4, '0')}`
const scalar = value => typeof value === 'string' && [...value].length === 1
const readYaml = path => parse(readFileSync(path, 'utf8'))

const jaNotice = 'MODIFIED 2026-09-15: ordered centerlines projected from the Japanese KanjiVG stroke data (CC BY-SA 3.0, Ulrich Apel and contributors) and the AnimCJK set (Arphic Public License / LGPL-3.0, FM-SH) into lazy Unicode-page JSON; paths are scaled into a 100-unit y-down frame and otherwise unchanged. Unreviewed. See ATTRIBUTION.html and the license files in this folder. ARPHIC PUBLIC LICENSE.'
const koNotice = 'Original AI-assisted Korean monoline strokes, CC0-1.0 to the extent rights apply. Syllables are composed from the letter recipes and marked ai-reviewed: a vision model checked them, no person has (human_reviewed stays false). The learner decided on 2026-11-08 that AI review is enough, so the handwriting gate is lifted. No source-derived paths. See ATTRIBUTION.html.'

const kanaOrMark = code => (code >= 0x3041 && code <= 0x3096) || (code >= 0x3099 && code <= 0x309f) || (code >= 0x30a1 && code <= 0x30fc) || code === 0x30ff

function defaultStrokes(label, record) {
  assert(record && Array.isArray(record.variants), `${label}: missing variants`)
  const selected = record.variants.find(variant => variant.id === record.default_variant)
  assert(selected && selected.status && selected.status.generated === true && selected.status.validated === true && selected.status.reviewed === false, `${label}: default variant must be generated, validated and unreviewed`)
  assert(Array.isArray(selected.strokes) && selected.strokes.length > 0, `${label}: no strokes`)
  return selected.strokes.map((stroke, index) => { validateCharacterPath(stroke.path, `${label} stroke ${index + 1}`); return stroke.path })
}

function loadPrepared(language) {
  const dir = join(root, 'curriculum', language, 'characters')
  const records = new Map()
  for (const file of readdirSync(dir).filter(name => /^u[0-9a-f]{4}\.yaml$/.test(name)).sort()) {
    const page = readYaml(join(dir, file))
    for (const [character, record] of Object.entries(page)) {
      assert(scalar(character) && pageFor(character) === file.slice(0, -5), `${file}: ${character} is on the wrong page`)
      records.set(character, record)
    }
  }
  return records
}

const hanLike = code => (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0x20000 && code <= 0x323af) || (code >= 0x3005 && code <= 0x3007)

/** Every string value under a JSON value (keys are ids, not text). */
function collectText(value, out) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) collectText(item, out)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectText(item, out)
  return out
}

const listPath = join('curriculum', 'japanese', 'characters', 'app-kanji.yaml')
const gapsPath = join(root, 'curriculum', 'japanese', 'characters', 'app-accepted-gaps.yaml')

/**
 * What the Japanese app can show, derived from its data and never typed: the kanji (and kana) in the course packs
 * (src/data/packs/ja/*.json) and in the dictionary (src/data/dictionary/ja.json). Strokes must ship for all of them.
 */
export function appCharacters() {
  const packDir = join(root, 'src', 'data', 'packs', 'ja')
  const course = new Set(), dictionary = new Set(), kana = new Set()
  const scan = (texts, kanjiTarget) => {
    for (const text of texts) for (const character of text) {
      const code = character.codePointAt(0)
      if (hanLike(code)) kanjiTarget.add(character)
      else if (kanaOrMark(code)) kana.add(character)
    }
  }
  for (const name of readdirSync(packDir).filter(file => file.endsWith('.json')).sort()) scan(collectText(JSON.parse(readFileSync(join(packDir, name), 'utf8')), []), course)
  scan(collectText(JSON.parse(readFileSync(join(root, 'src', 'data', 'dictionary', 'ja.json'), 'utf8')), []), dictionary)
  const order = (a, b) => a.codePointAt(0) - b.codePointAt(0)
  const all = [...new Set([...course, ...dictionary])].sort(order)
  return { course: [...course].sort(order), dictionary: [...dictionary].sort(order), kanji: all, kana: [...kana].sort(order) }
}

/** Characters no pinned Japanese source has, each with the reason (curriculum/japanese/characters/app-accepted-gaps.yaml). */
export function acceptedGaps() {
  if (!existsSync(gapsPath)) return {}
  const file = readYaml(gapsPath)
  assert(file && file.version === '1' && file.gaps && typeof file.gaps === 'object', 'Unsupported app-accepted-gaps.yaml')
  for (const [character, reason] of Object.entries(file.gaps)) assert(scalar(character) && typeof reason === 'string' && reason.trim(), `app-accepted-gaps.yaml: ${character} needs a one-character key and a reason`)
  return file.gaps
}

const listText = app => `# Derived by scripts/generate-app-writing-ja-ko.mjs; do not edit. Regenerate: npm run characters:generate (or node scripts/generate-app-writing-ja-ko.mjs).
# The kanji that the Japanese course (src/data/packs/ja/*.json) and the Japanese
# dictionary (src/data/dictionary/ja.json) use. scripts/import_japanese_characters.py prepares a record for each; the generator ships them all.
version: '1'
course_kanji: ${app.course.length}
kanji_count: ${app.kanji.length}
kanji: ${JSON.stringify(app.kanji.join(''))}
`

function selectJapanese() {
  const selection = readYaml(join(root, 'curriculum', 'japanese', 'characters', 'app-selection.yaml'))
  assert(selection.version === '1', 'Unsupported Japanese selection')
  const prepared = loadPrepared('japanese')
  const failures = []
  const kana = [...prepared.keys()].filter(character => kanaOrMark(character.codePointAt(0)))
  const n5 = [...selection.kanji.n5], n4 = [...selection.kanji.n4], parallel = [...(selection.kanji.parallel ?? '')]
  assert(new Set([...n5, ...n4, ...parallel]).size === n5.length + n4.length + parallel.length, 'Japanese selection lists a kanji twice')
  const wanted = [...new Set([...kana, ...n5, ...n4, ...parallel])].sort((a, b) => a.codePointAt(0) - b.codePointAt(0))
  const app = appCharacters(), gaps = acceptedGaps()
  const entries = new Map()
  const wantedAll = [...new Set([...wanted, ...app.kanji, ...app.kana])].sort((a, b) => a.codePointAt(0) - b.codePointAt(0))
  for (const character of wantedAll) {
    if (gaps[character] && !prepared.has(character)) continue
    try { entries.set(character, { paths: defaultStrokes(character, prepared.get(character)) }) } catch (error) { failures.push(error.message) }
  }
  // The coverage check: everything the course or the dictionary uses has data, or is in the short accepted list with a reason.
  const course = new Set(app.course)
  for (const character of [...app.kanji, ...app.kana]) {
    const label = `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ${character}`
    if (!entries.has(character) && !gaps[character]) failures.push(`${label}: used by the Japanese course or dictionary but has no shipped stroke data and is not in app-accepted-gaps.yaml`)
    if (gaps[character] && course.has(character)) failures.push(`${label}: used by the Japanese course, so it cannot be an accepted gap`)
  }
  for (const character of Object.keys(gaps)) {
    if (entries.has(character)) failures.push(`${character}: listed in app-accepted-gaps.yaml but strokes now exist; remove it from the list`)
    if (!app.kanji.includes(character)) failures.push(`${character}: listed in app-accepted-gaps.yaml but neither the course nor the dictionary uses it`)
  }
  const derivedKanji = app.kanji.filter(character => entries.has(character))
  return { entries, failures, app, gaps, list: listText(app), counts: { kana: kana.length, n5: n5.length, n4: n4.length, parallel: parallel.length, appKanji: app.kanji.length, appKanjiShipped: derivedKanji.length, course: app.course.length, acceptedGaps: Object.keys(gaps).length } }
}

const hangulSyllable = character => character >= '가' && character <= '힣'

/** What the Korean app can show, derived from its data and never typed: the Hangul syllables of the dictionary headwords (src/data/dictionary/ko.json, word[1]) and of every string in the lesson pack (src/data/packs/ko/*.json: words and sentences). */
export function koreanAppSyllables() {
  const dictionary = new Set(), lessons = new Set()
  for (const word of JSON.parse(readFileSync(join(root, 'src', 'data', 'dictionary', 'ko.json'), 'utf8')).words) for (const character of word[1]) if (hangulSyllable(character)) dictionary.add(character)
  const packDir = join(root, 'src', 'data', 'packs', 'ko')
  for (const name of readdirSync(packDir).filter(file => file.endsWith('.json')).sort()) for (const text of collectText(JSON.parse(readFileSync(join(packDir, name), 'utf8')), [])) for (const character of text) if (hangulSyllable(character)) lessons.add(character)
  const order = (a, b) => a.codePointAt(0) - b.codePointAt(0)
  return { dictionary: [...dictionary].sort(order), lessons: [...lessons].sort(order) }
}

/** Syllables that cannot be made well, each with the reason (curriculum/korean/characters/dictionary-accepted.yaml). */
export function koreanAcceptedGaps() {
  const path = join(root, 'curriculum', 'korean', 'characters', 'dictionary-accepted.yaml')
  if (!existsSync(path)) return {}
  const file = readYaml(path)
  assert(file && file.version === '1' && file.gaps && typeof file.gaps === 'object', 'Unsupported dictionary-accepted.yaml')
  for (const [character, reason] of Object.entries(file.gaps)) assert(scalar(character) && typeof reason === 'string' && reason.trim(), `dictionary-accepted.yaml: ${character} needs a one-character key and a reason`)
  return file.gaps
}

function selectKorean() {
  const prepared = loadPrepared('korean')
  const failures = [], entries = new Map()
  for (const [character, record] of prepared) {
    try { entries.set(character, { paths: defaultStrokes(character, record) }) } catch (error) { failures.push(error.message) }
  }
  let syllables = 0
  // TOPIK 1 syllables, the syllables the parallel Korean lessons use (scripts/korean_parallel_syllables.py), and the dictionary headwords' (scripts/korean_dictionary_syllables.py)
  for (const name of ['topik1-syllables.yaml', 'parallel-syllables.yaml', 'dictionary-syllables.yaml']) {
    const path = join(root, 'curriculum', 'korean', 'characters', name)
    if (name === 'parallel-syllables.yaml' && !existsSync(path)) continue
    const file = readYaml(path)
    assert(file.review === 'ai-reviewed' && file.human_reviewed === false && file.syllables, 'Korean syllables must be AI-reviewed and not human-reviewed')
    for (const [character, paths] of Object.entries(file.syllables)) {
      try {
        assert(scalar(character) && character >= '가' && character <= '힣', `${character}: not a Hangul syllable`)
        paths.forEach((path, index) => validateCharacterPath(path, `${character} stroke ${index + 1}`))
        if (!entries.has(character)) syllables++
        entries.set(character, { paths, review: 'ai-reviewed' })
      } catch (error) { failures.push(error.message) }
    }
  }
  // The coverage check: every syllable of the dictionary headwords and of the lessons has a guide, or is on the accepted list with a reason.
  const app = koreanAppSyllables(), gaps = koreanAcceptedGaps()
  for (const character of [...app.dictionary, ...app.lessons]) {
    if (!entries.has(character) && !gaps[character]) failures.push(`${character}: used by the Korean dictionary or lessons but has no shipped stroke data and is not in dictionary-accepted.yaml`)
    if (gaps[character] && app.lessons.includes(character)) failures.push(`${character}: used by the Korean lessons, so it cannot be an accepted gap`)
  }
  for (const character of Object.keys(gaps)) {
    if (entries.has(character)) failures.push(`${character}: listed in dictionary-accepted.yaml but strokes now exist; remove it from the list`)
    if (!app.dictionary.includes(character) && !app.lessons.includes(character)) failures.push(`${character}: listed in dictionary-accepted.yaml but neither the dictionary nor the lessons use it`)
  }
  return { entries, failures, app, gaps, counts: { letters: entries.size - syllables, syllables, dictionarySyllables: app.dictionary.length, lessonSyllables: app.lessons.length, acceptedGaps: Object.keys(gaps).length } }
}

const attribution = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:1rem/1.6 system-ui;max-width:70ch;margin:2rem auto;padding:0 1rem}a{overflow-wrap:anywhere}</style></head><body>
<h1>${title}</h1>
${body}
</body></html>
`

const jaAttribution = attribution('Japanese writing artwork: attribution', '<p>Stroke data derived from <a href="https://kanjivg.tagaini.net/">KanjiVG</a> (Copyright Ulrich Apel and contributors, <a href="writing-kanjivg-COPYING.txt">CC BY-SA 3.0</a>) and AnimCJK (FM-SH; <a href="writing-animcjk-COPYING.txt">COPYING</a>, <a href="writing-ARPHICPL.txt">Arphic Public License</a>, <a href="writing-LGPL-3.0.txt">LGPL-3.0</a>, <a href="writing-GPL-3.0.txt">GPL-3.0</a>). Centerlines were selected and scaled into a 100-unit frame; share-alike terms apply to these files. Unreviewed; no accuracy claim is made.</p>')
const koAttribution = attribution('Korean writing artwork: attribution', '<p>Original AI-assisted strokes, CC0-1.0 to the extent rights apply (<a href="ORIGINAL-WRITING-PILOT.md">notice</a>). Syllables are AI-reviewed only (a vision model checked stroke order and direction); no person has reviewed them. The learner decided on 2026-11-08 that AI review is enough, so the handwriting gate is lifted.</p>')

function projection(language, selected, notice, attributionHtml, licenses) {
  const outputs = new Map()
  const out = name => join('public', 'characters', language, name)
  const pages = new Map()
  for (const [character, entry] of selected.entries) {
    const page = pageFor(character)
    if (!pages.has(page)) pages.set(page, [])
    pages.get(page).push({ character, strokeCount: entry.paths.length, paths: entry.paths, ...(entry.review ? { review: entry.review } : {}) })
  }
  for (const [page, characters] of pages) outputs.set(out(`${page}.generated.json`), Buffer.from(json({ schemaVersion: 1, language, page, notice, characters })))
  outputs.set(out('index.generated.json'), Buffer.from(json({ schemaVersion: 1, language, characters: Object.fromEntries([...selected.entries].map(([character, entry]) => [character, entry.paths.length])) })))
  outputs.set(out('ATTRIBUTION.html'), Buffer.from(attributionHtml))
  for (const license of licenses) outputs.set(out(license.split('/').pop()), readFileSync(join(root, 'curriculum', language, license)))
  return { outputs, pages: pages.size }
}

export function buildWritingJaKo() {
  const ja = selectJapanese(), ko = selectKorean()
  const japanese = projection('japanese', ja, jaNotice, jaAttribution, ['licenses/writing-ARPHICPL.txt', 'licenses/writing-GPL-3.0.txt', 'licenses/writing-LGPL-3.0.txt', 'licenses/writing-animcjk-COPYING.txt', 'licenses/writing-kanjivg-COPYING.txt'])
  const korean = projection('korean', ko, koNotice, koAttribution, ['licenses/ORIGINAL-WRITING-PILOT.md'])
  return { japanese: { ...japanese, ...ja }, korean: { ...korean, ...ko } }
}

const owned = name => /^u[0-9a-f]{4}\.generated\.json$/.test(name) || ['index.generated.json', 'ATTRIBUTION.html'].includes(name) || /^(writing-.*|ORIGINAL-WRITING-PILOT\.md)$/.test(name)

export function synchronize(outputs, folder, check) {
  const stale = []
  const dir = join(root, 'public', 'characters', folder)
  for (const name of existsSync(dir) ? readdirSync(dir).filter(owned) : []) {
    const path = join('public', 'characters', folder, name)
    if (outputs.has(path)) continue
    stale.push(path)
    if (!check) unlinkSync(join(root, path))
  }
  for (const [path, bytes] of outputs) {
    const full = join(root, path)
    if (existsSync(full) && readFileSync(full).equals(bytes)) continue
    stale.push(path)
    if (!check) { mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, bytes) }
  }
  return stale
}

/** One derived file outside public/ (the list the importer reads): write it, or report it stale. */
export function synchronizeFile(path, text, check) {
  const full = join(root, path)
  if (existsSync(full) && readFileSync(full, 'utf8') === text) return []
  if (!check) writeFileSync(full, text)
  return [path]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.slice(2).every(arg => arg === '--check'), 'Usage: node scripts/generate-app-writing-ja-ko.mjs [--check]')
    const check = process.argv.includes('--check')
    const data = buildWritingJaKo()
    let stale = []
    for (const [name, language] of [['japanese', data.japanese], ['korean', data.korean]]) {
      if (language.list) stale = stale.concat(synchronizeFile(listPath, language.list, check))
      assert(language.failures.length === 0, `${name} validation failures:\n${language.failures.join('\n')}`)
      stale = stale.concat(synchronize(language.outputs, name, check))
      const bytes = [...language.outputs.values()].reduce((sum, value) => sum + value.length, 0)
      console.log(`${name} writing assets ${check ? 'current' : 'generated'}: ${language.entries.size} characters (${JSON.stringify(language.counts)}), ${language.pages} lazy pages, ${bytes} bytes, ${language.failures.length} failed validation.`)
    }
    if (check && stale.length) {
      for (const path of stale) console.error(`Stale writing asset: ${relative(root, join(root, path))}`)
      throw new Error('Run "npm run characters:generate" to regenerate writing assets.')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
