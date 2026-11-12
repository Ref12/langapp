// Part notes: what each shown top-level part of a character does IN that character.
// Source (authored by scripts/build-part-notes.mjs, then reviewed): curriculum/chinese/characters/part-notes.yaml
// Generated (lazy-loaded by the app next to components.generated.json): public/characters/chinese/part-notes.generated.json
// Kept in its own module so the origins generator (part of characters:check) can rebuild and check the JSON without the model client.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const notesYamlPath = join(root, 'curriculum', 'chinese', 'characters', 'part-notes.yaml')
export const notesJsonPath = join(root, 'public', 'characters', 'chinese', 'part-notes.generated.json')

export const ROLES = ['meaning', 'sound', 'both', 'form', 'shape']
/** One letter per role in the generated JSON. */
export const ROLE_CODES = { meaning: 'm', sound: 's', both: 'b', form: 'f', shape: 'h' }
export const MAX_NOTE_WORDS = 10
export const MAX_NOTE_CHARS = 80
export const MAX_ORIGIN_CHARS = 240

const header = [
  '# What each part of a character does IN that character (role + a short note), and an optional one-sentence origin.',
  '# Written by scripts/build-part-notes.mjs (Luna writes, DeepSeek checks, code validates) and reviewed by hand; edit entries here, then',
  '# run "npm run characters:origins" to rebuild public/characters/chinese/part-notes.generated.json. A character with no entry (or one that',
  '# fails the checks) shows the part\'s own dictionary meaning, as before.',
  '# part: the shown part\'s character, or [children] for a part drawn from strokes (in the order the app shows them).',
  '# role: meaning | sound | both | form (stands for an older or different element) | shape (only matches the shape).',
  '# Inputs: Make Me a Hanzi (LGPL) decomposition and roles, Unicode Unihan meanings and pinyin.',
]

const q = value => JSON.stringify(String(value))

/** notes: { [character]: { origin?: string, parts: { part, role, note }[] } } */
export function renderNotesYaml(notes) {
  const lines = [...header, 'schema_version: 1', 'notes:']
  for (const ch of Object.keys(notes).sort((a, b) => a.codePointAt(0) - b.codePointAt(0))) {
    const entry = notes[ch]
    lines.push('  ' + q(ch) + ':')
    if (entry.origin) lines.push('    origin: ' + q(entry.origin))
    lines.push('    parts:')
    for (const part of entry.parts) lines.push('      - {part: ' + q(part.part) + ', role: ' + part.role + ', note: ' + q(part.note) + '}')
  }
  return lines.join('\n') + '\n'
}

export function parseNotesYaml(text) {
  const data = parse(text)
  if (!data || data.schema_version !== 1 || typeof data.notes !== 'object') throw new Error('part-notes.yaml: expected schema_version 1 and a notes map.')
  return data.notes
}

export function readNotesYaml(path = notesYamlPath) { return existsSync(path) ? parseNotesYaml(readFileSync(path, 'utf8')) : {} }

/** The app's file: one record per character, short keys. p: [part ('' for a drawn part), role letter, note][]; o: origin. */
export function buildPartNotesJson(notes) {
  const out = {}
  for (const ch of Object.keys(notes).sort((a, b) => a.codePointAt(0) - b.codePointAt(0))) {
    const entry = notes[ch]
    if (!Array.isArray(entry.parts) || !entry.parts.length) throw new Error('part-notes.yaml: ' + ch + ' has no parts.')
    const record = { p: entry.parts.map(part => {
      if (!ROLE_CODES[part.role]) throw new Error('part-notes.yaml: ' + ch + ' has an unknown role ' + part.role)
      return [String(part.part).startsWith('[') ? '' : part.part, ROLE_CODES[part.role], part.note] }) }
    if (entry.origin) record.o = entry.origin
    out[ch] = record
  }
  return JSON.stringify({ schemaVersion: 1, source: 'curriculum/chinese/characters/part-notes.yaml', notes: out }) + '\n'
}
