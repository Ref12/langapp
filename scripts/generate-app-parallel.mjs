// Projects the parallel Japanese and Korean lessons (curriculum/<language>/parallel) into src/data/parallel/<language>.json for the app.
// Additive only: no Chinese data is read for this, and nothing in the imported references is changed.
// Usage: node scripts/generate-app-parallel.mjs [--check] [--root DIR]
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANGUAGES, appJsonFile, appJsonText, loadReferences, readParallel, root as defaultRoot, writeAtomic } from './parallel-lessons-files.mjs'

/** The files to write for a root: path -> text. */
export function parallelOutputs(base = defaultRoot) {
  const outputs = new Map()
  for (const code of Object.keys(LANGUAGES)) outputs.set(appJsonFile(code, base), appJsonText(code, readParallel(code, base), loadReferences(code, base), base))
  return outputs
}

/** Writes the outputs, or with check only lists the stale ones. */
export function synchronize(outputs, check) {
  const stale = []
  for (const [file, text] of outputs) {
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue
    stale.push(file)
    if (!check) writeAtomic(file, text)
  }
  return stale
}

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check')
  const at = argv.indexOf('--root')
  const base = at >= 0 ? resolve(argv[at + 1]) : defaultRoot
  const unknown = argv.filter((arg, index) => arg !== '--check' && arg !== '--root' && argv[index - 1] !== '--root')
  if (unknown.length) throw new Error('Usage: node scripts/generate-app-parallel.mjs [--check] [--root DIR]')
  const outputs = parallelOutputs(base)
  const stale = synchronize(outputs, check)
  for (const [file, text] of outputs) { const counts = JSON.parse(text).counts; console.log('parallel lessons ' + (check ? 'current' : 'generated') + ': ' + relative(base, file) + ' ' + JSON.stringify(counts)) }
  if (check && stale.length) { for (const file of stale) console.error('Stale parallel data: ' + relative(base, file)); throw new Error('Run "npm run parallel:generate" to regenerate the parallel lesson data.') }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
