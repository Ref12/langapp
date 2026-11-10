// One-off: reads curriculum/korean/reading-overlay.yaml once and writes the official pronunciations of the lesson words (the NIKL words of the Korean lessons)
// to curriculum/korean/authoring/pack-pronunciations.json (with their ids and the raw text) and to src/data/korean-pronunciations.generated.json (spelling -> pronunciation, length marks removed), which the app reads.
// Run: node scripts/pack-ko-pronunciations.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = new URL('../', import.meta.url)
const path = relative => fileURLToPath(new URL(relative, root))
const overlay = parse(readFileSync(path('curriculum/korean/reading-overlay.yaml'), 'utf8'))
const band = JSON.parse(readFileSync(path('src/data/packs/ko/band-1.generated.json'), 'utf8'))

const words = {}
const missing = []
for (const word of band.vocabulary) {
  if (!word.id.startsWith('ko-nikl-')) continue
  const entry = overlay.entries[word.id]
  const raw = entry?.pronunciations?.[0]
  if (!raw) { missing.push(word.ch); continue }
  words[word.ch] = { id: word.id, raw, ...(entry.pronunciations.length > 1 ? { alternatives: entry.pronunciations.slice(1) } : {}) }
}
const sorted = Object.fromEntries(Object.entries(words).sort(([a], [b]) => a.localeCompare(b, 'ko')))
writeFileSync(path('curriculum/korean/authoring/pack-pronunciations.json'), JSON.stringify({ source: overlay.source_id, note: 'Official citation pronunciations of the lesson words that have one (length mark ː kept in raw). Written by scripts/pack-ko-pronunciations.mjs.', words: sorted }, null, 2) + '\n')
const app = Object.fromEntries(Object.entries(sorted).map(([ch, word]) => [ch, word.raw.replace(/\u02d0/g, '')]))
writeFileSync(path('src/data/korean-pronunciations.generated.json'), JSON.stringify(app, null, 1) + '\n')
console.log(Object.keys(sorted).length + ' words with a pronunciation; without: ' + missing.length + ' ' + missing.join(' '))
