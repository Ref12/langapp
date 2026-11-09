// Projects the Japanese and Korean dictionaries (JLPT / TOPIK vocabulary and grammar, plus the parallel-authored entries) into compact
// per-language files the app loads lazily: src/data/dictionary/<ja|ko>.json. Licence files and a one-line attribution go to
// public/dictionary/<language>/ (the way the Chinese data carries them). Nothing in curriculum/ is edited.
// Usage: node scripts/generate-app-dictionary.mjs [--check] [--root DIR]
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { writeAtomic } from './parallel-lessons-files.mjs'
import { createForms } from '../src/core/forms/engine.mjs'
import { loadClassOverrides, loadFormsRules } from './forms-data.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const LANGS = {
  ja: { dir: 'japanese', levels: [5, 4, 3, 2, 1].map(n => ({ dir: 'jlpt-n' + n, label: 'N' + n, grammarPrefix: 'ja-n' + n })),
    licenses: ['CC-BY-SA-4.0.txt', 'EDRDG-license.html', 'Waller-sharing.html'],
    attribution: 'Japanese vocabulary: JMdict/EDICT, copyright James William Breen and the Electronic Dictionary Research and Development Group (EDRDG), used under the EDRDG licence (https://www.edrdg.org/edrdg/licence.html); JLPT level estimates adapted from Jonathan Waller\'s JLPT Resources (https://www.tanos.co.uk/jlpt/, CC BY) through stephenmk/yomitan-jlpt-vocab (CC BY-SA 4.0); transformed and compacted for this app; grammar notes are original (CC0).' },
  ko: { dir: 'korean', levels: [1, 2, 3, 4, 5, 6].map(n => ({ dir: 'topik-' + n, label: 'TOPIK ' + n, grammarPrefix: 'ko-topik' + n })),
    licenses: ['NOTICE.md'],
    attribution: 'Korean vocabulary: National Institute of Korean Language and Korean-English Learners\' Dictionary contributors (https://krdict.korean.go.kr), CC BY-SA 2.0 Korea (https://creativecommons.org/licenses/by-sa/2.0/kr/), via the binjang January 2024 CSV extraction; definitions normalised and levels assigned by project heuristics, not an official TOPIK list; transformed and compacted for this app; grammar notes are original (CC0).' },
}

const yaml = (file) => parse(readFileSync(file, 'utf8')) ?? []
/** Japanese glosses come numbered ("1. a | 2. b"); keep them as "a | b". */
const meanings = text => String(text ?? '').split(' | ').map(part => part.replace(/^\d+\.\s*/, '').trim()).filter(Boolean).join(' | ')

export function buildDictionary(code, base = root) {
  const language = LANGS[code]
  const dir = join(base, 'curriculum', language.dir)
  const pos = []
  const posIndex = text => { const key = String(text ?? ''); let at = pos.indexOf(key); if (at < 0) { at = pos.length; pos.push(key) } return at }
  const levels = language.levels.map(level => level.label)
  const words = []
  const seen = new Set()
  language.levels.forEach((level, levelAt) => {
    for (const entry of yaml(join(dir, level.dir, 'vocabulary.yaml'))) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      const row = [entry.id, entry.target, entry.reading ?? '', meanings(entry.english), posIndex(entry.part_of_speech), levelAt]
      if (entry.hanja) row.push(entry.hanja)
      words.push(row)
    }
  })
  const parallel = yaml(join(dir, 'parallel', 'entries.yaml'))
  for (const entry of parallel.vocabulary ?? []) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    words.push([entry.id, entry.target, entry.reading ?? '', meanings(entry.english), posIndex(entry.part_of_speech), -1])
  }
  // Grammar: the points the parallel lessons teach, with the level they come from.
  const lessons = yaml(join(dir, 'parallel', 'zh-lessons.yaml'))
  const used = new Set()
  for (const lesson of lessons.lessons ?? []) for (const id of [...(lesson.grammar_intro ?? []), ...(lesson.grammar_taught ?? [])]) used.add(id)
  const grammarAll = new Map()
  language.levels.forEach((level, levelAt) => { for (const entry of yaml(join(dir, level.dir, 'grammar.yaml'))) grammarAll.set(entry.id, { entry, levelAt }) })
  for (const entry of parallel.grammar ?? []) if (!grammarAll.has(entry.id)) grammarAll.set(entry.id, { entry, levelAt: -1 })
  const grammar = [...used].sort().flatMap(id => {
    const found = grammarAll.get(id)
    if (!found) return []
    const { entry, levelAt } = found
    return [[entry.id, entry.pattern, entry.english ?? '', entry.note ?? '', levelAt, (entry.examples ?? []).map(example => [example.target, example.english ?? ''])]]
  })
  // The word form class of every verb and adjective (src/core/forms): assigned by code from the dictionary form and part of speech.
  const engine = createForms(loadFormsRules(code, base)), overrides = loadClassOverrides(code, base)
  const classes = {}
  for (const row of words) {
    const key = row[1] + '|' + row[2]
    const cls = overrides[key] ?? overrides[row[1]] ?? engine.classify(row[1], pos[row[4]], row[2])
    if (cls) classes[row[0]] = cls
  }
  return { v: 1, lang: code, levels, pos, words, grammar, classes }
}

/** One entry per line keeps the file diffable and gzips well. */
export function dictionaryText(data) {
  const head = { v: data.v, lang: data.lang, levels: data.levels, pos: data.pos }
  const classLines = Object.entries(data.classes ?? {}).map(([id, cls]) => JSON.stringify(id) + ':' + JSON.stringify(cls))
  const lines = JSON.stringify(head).slice(0, -1) + ',\n"words":[\n' + data.words.map(row => JSON.stringify(row)).join(',\n') + '\n],\n"grammar":[\n' + data.grammar.map(row => JSON.stringify(row)).join(',\n') + '\n],\n"classes":{\n' + classLines.join(',\n') + '\n}}\n'
  return lines
}

export const dictionaryFile = (code, base = root) => join(base, 'src', 'data', 'dictionary', code + '.json')
export const publicDir = (code, base = root) => join(base, 'public', 'dictionary', LANGS[code].dir)

/** path -> text (or { copy } for licence files). */
export function outputs(base = root) {
  const out = new Map()
  for (const code of Object.keys(LANGS)) {
    out.set(dictionaryFile(code, base), dictionaryText(buildDictionary(code, base)))
    out.set(join(publicDir(code, base), 'ATTRIBUTION.txt'), LANGS[code].attribution + '\n')
    for (const name of LANGS[code].licenses) out.set(join(publicDir(code, base), name), readFileSync(join(base, 'curriculum', LANGS[code].dir, 'licenses', name), 'utf8'))
  }
  return out
}

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check')
  const at = argv.indexOf('--root')
  const base = at >= 0 ? resolve(argv[at + 1]) : root
  const stale = []
  const result = outputs(base)
  for (const [file, text] of result) {
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue
    stale.push(file)
    if (!check) writeAtomic(file, text)
  }
  for (const code of Object.keys(LANGS)) {
    const text = result.get(dictionaryFile(code, base))
    const data = JSON.parse(text)
    console.log('dictionary ' + (check ? 'current' : 'generated') + ': ' + relative(base, dictionaryFile(code, base)) + ' words=' + data.words.length + ' grammar=' + data.grammar.length + ' bytes=' + Buffer.byteLength(text) + ' gzip=' + gzipSync(text).length)
  }
  if (check && stale.length) { for (const file of stale) console.error('Stale dictionary data: ' + relative(base, file)); throw new Error('Run "npm run dictionary:generate" to regenerate the Japanese and Korean dictionary files.') }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
