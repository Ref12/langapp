// Per-character pinyin and a short English meaning for the characters that have stroke guides, from Unicode Unihan (kMandarin, kDefinition).
// Usage: node scripts/generate-character-meanings.mjs [--check] [path/to/Unihan.zip]   (without a path the pinned Unicode 18.0.0 ZIP is downloaded and hash-checked)
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'public', 'characters', 'chinese', 'meanings.generated.json')
const url = 'https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip'
const zipSha256 = '4c93ea9c1f636451729a840978f1667a53886af37ba854fdcce109721c63d43e'
const sha256 = value => createHash('sha256').update(value).digest('hex')

/** The first three senses of a Unihan definition, `;`-separated; the rest is dropped. */
export function shortMeaning(definition) {
  return definition.split(';').map(sense => sense.trim()).filter(Boolean).slice(0, 3).join('; ')
}

export function parseUnihan(text, characters) {
  const wanted = new Set(characters)
  const found = new Map()
  for (const line of text.split('\n')) {
    const match = /^U\+([0-9A-F]+)\t(kMandarin|kDefinition)\t(.+)$/.exec(line)
    if (!match) continue
    const character = String.fromCodePoint(Number.parseInt(match[1], 16))
    if (!wanted.has(character)) continue
    const entry = found.get(character) ?? {}
    if (match[2] === 'kMandarin') entry.pinyin = match[3].trim().split(/\s+/)[0]
    else entry.meaning = shortMeaning(match[3])
    found.set(character, entry)
  }
  return Object.fromEntries([...found].filter(([, entry]) => entry.meaning).sort(([a], [b]) => a.codePointAt(0) - b.codePointAt(0)).map(([character, entry]) => [character, entry.pinyin ? [entry.pinyin, entry.meaning] : ['', entry.meaning]]))
}

async function main() {
  const check = process.argv.includes('--check')
  const local = process.argv.slice(2).find(arg => !arg.startsWith('--'))
  const bytes = local ? readFileSync(local) : Buffer.from(await (await fetch(url)).arrayBuffer())
  if (sha256(bytes) !== zipSha256) throw new Error('Unihan.zip does not match the pinned SHA-256.')
  const zip = await JSZip.loadAsync(bytes)
  const text = await zip.file('Unihan_Readings.txt').async('string')
  const index = JSON.parse(readFileSync(join(root, 'src', 'data', 'characters', 'index.generated.json'), 'utf8'))
  const meanings = parseUnihan(text, index.characters.map(entry => entry.character))
  const body = `${JSON.stringify({ schemaVersion: 1, source: 'Unicode Unihan 18.0.0 (kMandarin, kDefinition); Unicode License v3; first three senses', url, sha256: zipSha256, meanings })}\n`
  if (check) {
    if (!existsSync(output) || readFileSync(output, 'utf8') !== body) throw new Error('Run "npm run characters:meanings" to regenerate public/characters/chinese/meanings.generated.json.')
    console.log(`Character meanings current: ${Object.keys(meanings).length} characters.`)
  } else {
    writeFileSync(output, body)
    console.log(`Character meanings generated: ${Object.keys(meanings).length} of ${index.characters.length} characters.`)
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
