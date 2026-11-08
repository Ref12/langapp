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
const koNotice = 'Original AI-assisted Korean monoline strokes, CC0-1.0 to the extent rights apply. Syllables are composed from the letter recipes and marked ai-reviewed: a vision model checked them, no person has. No source-derived paths. See ATTRIBUTION.html.'

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

function selectJapanese() {
  const selection = readYaml(join(root, 'curriculum', 'japanese', 'characters', 'app-selection.yaml'))
  assert(selection.version === '1', 'Unsupported Japanese selection')
  const prepared = loadPrepared('japanese')
  const failures = []
  const kana = [...prepared.keys()].filter(character => kanaOrMark(character.codePointAt(0)))
  const n5 = [...selection.kanji.n5], n4 = [...selection.kanji.n4]
  assert(new Set([...n5, ...n4]).size === n5.length + n4.length, 'Japanese selection lists a kanji twice')
  const wanted = [...new Set([...kana, ...n5, ...n4])].sort((a, b) => a.codePointAt(0) - b.codePointAt(0))
  const entries = new Map()
  for (const character of wanted) {
    try { entries.set(character, { paths: defaultStrokes(character, prepared.get(character)) }) } catch (error) { failures.push(error.message) }
  }
  return { entries, failures, counts: { kana: kana.length, n5: n5.length, n4: n4.length } }
}

function selectKorean() {
  const prepared = loadPrepared('korean')
  const failures = [], entries = new Map()
  for (const [character, record] of prepared) {
    try { entries.set(character, { paths: defaultStrokes(character, record) }) } catch (error) { failures.push(error.message) }
  }
  const file = readYaml(join(root, 'curriculum', 'korean', 'characters', 'topik1-syllables.yaml'))
  assert(file.review === 'ai-reviewed' && file.human_reviewed === false && file.syllables, 'Korean syllables must be AI-reviewed and not human-reviewed')
  let syllables = 0
  for (const [character, paths] of Object.entries(file.syllables)) {
    try {
      assert(scalar(character) && character >= '가' && character <= '힣', `${character}: not a Hangul syllable`)
      paths.forEach((path, index) => validateCharacterPath(path, `${character} stroke ${index + 1}`))
      entries.set(character, { paths, review: 'ai-reviewed' }); syllables++
    } catch (error) { failures.push(error.message) }
  }
  return { entries, failures, counts: { letters: entries.size - syllables, syllables } }
}

const attribution = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:1rem/1.6 system-ui;max-width:70ch;margin:2rem auto;padding:0 1rem}a{overflow-wrap:anywhere}</style></head><body>
<h1>${title}</h1>
${body}
</body></html>
`

const jaAttribution = attribution('Japanese writing artwork: attribution', '<p>Stroke data derived from <a href="https://kanjivg.tagaini.net/">KanjiVG</a> (Copyright Ulrich Apel and contributors, <a href="writing-kanjivg-COPYING.txt">CC BY-SA 3.0</a>) and AnimCJK (FM-SH; <a href="writing-animcjk-COPYING.txt">COPYING</a>, <a href="writing-ARPHICPL.txt">Arphic Public License</a>, <a href="writing-LGPL-3.0.txt">LGPL-3.0</a>, <a href="writing-GPL-3.0.txt">GPL-3.0</a>). Centerlines were selected and scaled into a 100-unit frame; share-alike terms apply to these files. Unreviewed; no accuracy claim is made.</p>')
const koAttribution = attribution('Korean writing artwork: attribution', '<p>Original AI-assisted strokes, CC0-1.0 to the extent rights apply (<a href="ORIGINAL-WRITING-PILOT.md">notice</a>). Syllables are AI-reviewed only (a vision model checked stroke order and direction); no person has reviewed them and the human review gate is still open.</p>')

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.slice(2).every(arg => arg === '--check'), 'Usage: node scripts/generate-app-writing-ja-ko.mjs [--check]')
    const check = process.argv.includes('--check')
    const data = buildWritingJaKo()
    let stale = []
    for (const [name, language] of [['japanese', data.japanese], ['korean', data.korean]]) {
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
