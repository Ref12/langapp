// Prints one compact file per level listing its units in order (index, then each word / grammar label with a short meaning),
// the input for dividing the level into modules. Usage: node scripts/modules-input.mjs [outDir] [zh|ja]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outDir = resolve(process.argv[2] ?? join(root, 'modules-input'))
const language = process.argv[3] ?? 'zh'
const folder = language === 'zh' ? join(root, 'src', 'data', 'v2') : join(root, 'src', 'data', 'packs', language)
const read = file => JSON.parse(readFileSync(join(folder, file), 'utf8'))
const short = text => String(text).split(/[;,(]/)[0].replace(/^to /, '').trim().split(/\s+/).slice(0, 3).join(' ')

mkdirSync(outDir, { recursive: true })
for (const entry of read('index.generated.json').bands) {
  const file = language === 'zh' ? 'hsk-' + entry.band + '.generated.json' : 'band-' + entry.band + '.generated.json'
  const data = read(file)
  const vocabulary = new Map(data.vocabulary.map(word => [word.lb, word]))
  const grammar = new Map(data.grammar.map(item => [item.lb, item]))
  const lines = data.groups.map((group, index) => {
    const parts = group.units.map(unit => {
      const label = unit.ref.replace(/^[a-z]+:([wg]:)?/, '')
      if (unit.kind === 'vocabulary') { const word = vocabulary.get(label); return word ? word.ch + ' ' + short(word.ds) : label }
      const item = grammar.get(label)
      return item ? '[' + (item.st ?? item.pt) + ']' : label
    })
    return (index + 1) + ' ' + parts.join(' · ')
  })
  const name = entry.alignment + '.txt'
  writeFileSync(join(outDir, name), lines.join('\n') + '\n')
  console.log(name, lines.length, 'units')
}
