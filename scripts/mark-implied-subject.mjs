// Checks (or with --write sets) the impliedSubject flag on every sentence of the Japanese and Korean phrase banks, and prints the counts and samples.
// The flag is decided from the tokens by scripts/implied-subject.mjs; the pack generators (generate-pack-ja.mjs, generate-pack-ko.mjs) write the same flag, so a regeneration keeps it.
// Usage: node scripts/mark-implied-subject.mjs [--write] [--samples]   (samples: 15 flagged and 15 unflagged per language, picked with a fixed seed)
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { impliedSubject } from '../src/core/language/implied-subject.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const write = process.argv.includes('--write'), samples = process.argv.includes('--samples')
const seeded = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
const pick = (list, count, seed) => { const rng = seeded(seed), items = [...list]; const out = []; while (out.length < count && items.length) out.push(items.splice(Math.floor(rng() * items.length), 1)[0]); return out }
let stale = 0
for (const language of ['ja', 'ko']) {
  const path = join(root, 'src/data/packs', language, 'phrases-band-1.json')
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const phrases = data.phrases.map(({ impliedSubject: _old, tokens, readyAt, ...rest }) => ({ ...rest, readyAt, ...(impliedSubject(language, tokens) ? { impliedSubject: true } : {}), tokens }))
  const text = JSON.stringify({ ...data, phrases }) + '\n'
  if (text !== readFileSync(path, 'utf8')) { stale++; if (write) writeFileSync(path, text) }
  const flagged = phrases.filter(p => p.impliedSubject), other = phrases.filter(p => !p.impliedSubject)
  console.log(language + ': ' + phrases.length + ' sentences, ' + flagged.length + ' flagged impliedSubject, ' + other.length + ' with a stated subject')
  if (samples) for (const [name, list] of [['flagged', flagged], ['unflagged', other]]) { console.log('  ' + name + ':'); for (const p of pick(list, 15, 7)) console.log('    ' + p.id + ' ' + p.zh + '  ' + p.en) }
}
if (stale && !write) { console.error('The impliedSubject flags are stale: run node scripts/mark-implied-subject.mjs --write'); process.exitCode = 1 }
