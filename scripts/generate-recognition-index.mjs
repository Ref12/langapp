// Handwriting-lookup index for Japanese and Korean, derived from the stroke pages shipped in public/characters/<folder>/ (Chinese has its own, written by generate-app-characters.mjs).
// Usage: node scripts/generate-recognition-index.mjs [--check]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { recognitionFile, recognitionIndex, repositoryRoot } from './generate-app-characters.mjs'

export const languages = [{ language: 'japanese', folder: 'japanese' }, { language: 'korean', folder: 'korean' }]

export function buildIndex(folder, language, root = repositoryRoot) {
  const directory = join(root, 'public', 'characters', folder)
  const characters = []
  for (const name of readdirSync(directory).filter(file => /^u[0-9a-f]{4}\.generated\.json$/.test(file)).sort()) {
    const page = JSON.parse(readFileSync(join(directory, name), 'utf8'))
    for (const record of page.characters) if (Array.isArray(record.paths) && record.paths.length) characters.push({ character: record.character, paths: record.paths })
  }
  characters.sort((a, b) => a.character.codePointAt(0) - b.character.codePointAt(0))
  const index = recognitionIndex(characters)
  return { ...index, language, notice: 'Derived from the ordered stroke paths of the guides in this folder (see ATTRIBUTION.html); regenerate with node scripts/generate-recognition-index.mjs.' }
}

export function run(check = false, root = repositoryRoot) {
  const stale = []
  for (const { language, folder } of languages) {
    const target = join(root, 'public', 'characters', folder, recognitionFile)
    const text = JSON.stringify(buildIndex(folder, language, root)) + '\n'
    if (check) { if (!existsSync(target) || readFileSync(target, 'utf8') !== text) stale.push(target) } else writeFileSync(target, text)
    console.log(folder + ': ' + Buffer.byteLength(text) + ' bytes')
  }
  return stale
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--check')
  const stale = run(check)
  if (stale.length) { console.error('Stale handwriting index: ' + stale.join(', ')); process.exitCode = 1 }
}
