// Contact sheets of the composed TOPIK 1 syllables (PNG), for the AI review: node scripts/korean-syllable-sheets.mjs OUT_DIR
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { cell, sheetPage, screenshotHtml, strokeSvg } from './writing-sheet-render.mjs'

const out = process.argv[2] ?? 'shots/korean-review'
const per = Number(process.argv[3] ?? 56)
mkdirSync(out, { recursive: true })
const data = parse(readFileSync(join('curriculum', 'korean', 'characters', 'topik1-syllables.yaml'), 'utf8'))
const entries = Object.entries(data.syllables)
for (let start = 0, n = 1; start < entries.length; start += per, n++) {
  const group = entries.slice(start, start + per)
  const cells = group.map(([character, paths]) => cell(strokeSvg(paths, { size: 150, pad: 10 }), character, `${paths.length} strokes`))
  const html = sheetPage(`TOPIK 1 syllables ${start + 1}-${start + group.length} of ${entries.length}`, `<div class="grid">${cells.join('')}</div>`)
  const name = `syllables-${String(n).padStart(2, '0')}.png`
  await screenshotHtml(html, join(out, name), { width: 1300, scale: 1.5 })
  console.log(name, group.map(([c]) => c).join(''))
}
