// Where each built-in writing-guide character comes from: the lowest HSK reference band whose word (or example/pattern) spells it, plus that word.
// Source: curriculum/chinese/characters/coverage.yaml (the inventory that defines the guide set) and the band vocabulary/grammar files.
// Usage: node scripts/generate-character-origins.mjs [--check]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { buildPartNotesJson, notesJsonPath, notesYamlPath, readNotesYaml } from './part-notes-files.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chinese = join(root, 'curriculum', 'chinese')
const output = join(root, 'public', 'characters', 'chinese', 'origins.generated.json')
const bands = ['1', '2', '3', '4', '5', '6', '7-9']
const read = path => parse(readFileSync(join(chinese, path), 'utf8'))

/** [band, word, kind]; kind w = a vocabulary word, e = a word's example sentence, g = a grammar pattern; band '' = only in the course tracks. */
export function buildOrigins() {
  const inventory = read(join('characters', 'coverage.yaml')).inventory
  const text = new Map()
  for (const band of bands) {
    for (const row of read(join('hsk-' + band, 'vocabulary.yaml'))) text.set(row.id, row.target)
    for (const row of read(join('hsk-' + band, 'grammar.yaml'))) text.set(row.id, row.pattern)
  }
  const origins = {}
  for (const character of inventory.required) {
    const evidence = inventory.characters[character].evidence.filter(item => item.scope.startsWith('reference:'))
    const rank = item => bands.indexOf(item.scope.slice('reference:hsk-'.length)) * 4 + (item.field === 'target' ? 0 : item.field === 'examples.target' ? 1 : 2)
    const best = evidence.sort((a, b) => rank(a) - rank(b))[0]
    if (!best) { origins[character] = ['', '', 't']; continue }
    const word = text.get(best.first_entry.replace(/(-s\d+|\[\d+\])$/, ''))
    if (!word) throw new Error('No source text for ' + best.first_entry)
    origins[character] = [best.scope.slice('reference:hsk-'.length), word, best.field === 'target' ? 'w' : best.field === 'examples.target' ? 'e' : 'g']
  }
  return origins
}

/** The part notes JSON (public/characters/chinese/part-notes.generated.json) from curriculum/chinese/characters/part-notes.yaml; written by scripts/build-part-notes.mjs, reviewed by hand. */
function partNotes(check) {
  if (!existsSync(notesYamlPath)) { if (check && existsSync(notesJsonPath)) throw new Error('part-notes.generated.json has no part-notes.yaml source.'); return }
  const body = buildPartNotesJson(readNotesYaml())
  const count = Object.keys(JSON.parse(body).notes).length
  if (check) {
    if (!existsSync(notesJsonPath) || readFileSync(notesJsonPath, 'utf8') !== body) throw new Error('Run "npm run characters:origins" to regenerate public/characters/chinese/part-notes.generated.json.')
    console.log('Character part notes current: ' + count + ' characters.')
  } else {
    writeFileSync(notesJsonPath, body)
    console.log('Character part notes generated: ' + count + ' characters.')
  }
}

function main() {
  partNotes(process.argv.includes('--check'))
  const origins = buildOrigins()
  const body = JSON.stringify({ schemaVersion: 1, source: 'curriculum/chinese/characters/coverage.yaml inventory (curriculum-writing-inventory-v2)', origins }) + '\n'
  if (process.argv.includes('--check')) {
    if (!existsSync(output) || readFileSync(output, 'utf8') !== body) throw new Error('Run "npm run characters:origins" to regenerate public/characters/chinese/origins.generated.json.')
    console.log('Character origins current: ' + Object.keys(origins).length + ' characters.')
  } else {
    writeFileSync(output, body)
    console.log('Character origins generated: ' + Object.keys(origins).length + ' characters.')
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
