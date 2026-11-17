// Checks the modules of every pack against its catalog: the modules of each level cover units 1..N exactly once and in order, hold 8 to 12 units
// (the last one 5 to 12), and have titles of 2 to 7 words, never generic or numbered (Mixed, vocabulary 3, ...) that are unique in the level. Exits with 1 and says why when they do not fit.
// Usage: node scripts/check-modules.mjs
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packs = [{ name: 'zh', folder: join(root, 'src', 'data', 'v2') }, { name: 'ja', folder: join(root, 'src', 'data', 'packs', 'ja') }]
const read = file => JSON.parse(readFileSync(file, 'utf8'))

/** Why the modules do not fit a level of `total` units, or undefined. */
export function problemWith(modules, total) {
  if (!Array.isArray(modules) || !modules.length) return 'no modules'
  let expected = 1
  const titles = new Set()
  for (const [at, module] of modules.entries()) {
    if (module.from !== expected) return module.id + ' starts at unit ' + module.from + ', expected ' + expected
    const size = module.to - module.from + 1
    const last = at === modules.length - 1
    if (size > 12 || size < (last ? 5 : 8)) return module.id + ' has ' + size + ' units'
    const words = String(module.title).trim().split(/\s+/).length
    if (words < 2 || words > 7) return module.id + ' has a title of ' + words + ' words'
    if (/mixed|vocabulary \d|patterns \d|words \d/i.test(module.title)) return module.id + ' has a generic or numbered title "' + module.title + '"'
    const key = String(module.title).trim().toLowerCase()
    if (titles.has(key)) return module.id + ' repeats the title "' + module.title + '"'
    titles.add(key)
    expected = module.to + 1
  }
  return expected === total + 1 ? undefined : 'the modules end at unit ' + (expected - 1) + ' of ' + total
}

let failed = false
for (const pack of packs) {
  const index = read(join(pack.folder, 'index.generated.json'))
  const file = read(join(pack.folder, 'modules.generated.json'))
  for (const band of index.bands) {
    const entry = file.bands.find(item => item.band === band.alignment)
    const problem = entry ? problemWith(entry.modules, band.groups) : 'no modules for the level'
    console.log(pack.name + ' ' + band.alignment + ': ' + (problem ? 'FAIL ' + problem : entry.modules.length + ' modules cover ' + band.groups + ' units'))
    if (problem) failed = true
  }
  for (const entry of file.bands) if (!index.bands.some(band => band.alignment === entry.band)) { console.log(pack.name + ' ' + entry.band + ': FAIL not a level of the catalog'); failed = true }
}
process.exit(failed ? 1 : 0)
