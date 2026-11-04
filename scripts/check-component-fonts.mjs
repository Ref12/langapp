// Which components of components.generated.json does an installed font cover (default: Noto Sans CJK SC Regular)?
// Usage: node scripts/check-component-fonts.mjs [family] [out.json]   (needs fontconfig: fc-list, fc-query)
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const family = process.argv[2] ?? 'Noto Sans CJK SC'
const out = process.argv[3] ?? join(root, 'curriculum', 'chinese', 'characters', 'component-font-check.json')
const listing = execFileSync('fc-list', [`${family}:style=Regular`, 'file', 'index'], { encoding: 'utf8' }).trim().split('\n')[0]
const match = /^(.+?):\s*index=(\d+)/.exec(listing.replace(/:\s*(index=\d+)/, ': $1'))
const file = listing.split(':')[0]
const index = /index=(\d+)/.exec(listing)?.[1] ?? '0'
if (!file || !match) throw new Error(`${family} is not installed (fc-list found nothing).`)
const charset = execFileSync('fc-query', ['-f', '%{charset}\n', '-i', index, file], { encoding: 'utf8' }).trim()
const ranges = charset.split(/\s+/).map(r => r.split('-').map(h => parseInt(h, 16))).map(([a, b]) => [a, b ?? a])
const has = cp => ranges.some(([a, b]) => cp >= a && cp <= b)
const data = JSON.parse(readFileSync(join(root, 'public', 'characters', 'chinese', 'components.generated.json'), 'utf8'))
const missing = []
let covered = 0
for (const [form, info] of Object.entries(data.components)) {
  if (has(form.codePointAt(0))) covered++
  else missing.push({ form, cp: info.cp, block: info.block, uses: info.uses })
}
const version = execFileSync('fc-list', [`${family}:style=Regular`, 'fontversion'], { encoding: 'utf8' }).trim().split('\n')[0]
const result = { family, file: file.split('/').pop(), fontconfig: version.trim(), components: Object.keys(data.components).length, covered, missing }
writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`)
console.log(JSON.stringify({ ...result, missing: missing.map(m => `${m.form} ${m.cp} x${m.uses}`) }))
