// Render the Korean review sheets (PNG) from the original pilot recipes: node scripts/korean-review-sheets.mjs OUT_DIR [LABEL]
// Run python scripts/korean_review_data.py first (it writes the JSON this reads; default OUT_DIR/data.json).
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cell, section, sheetPage, screenshotHtml, strokeSvg } from './writing-sheet-render.mjs'

const out = process.argv[2] ?? 'shots/korean-review'
const label = process.argv[3] ?? 'sheet'
mkdirSync(out, { recursive: true })
const dataPath = join(out, 'data.json')
execFileSync(process.env.PYTHON ?? 'python3', [join('scripts', 'korean_review_data.py'), dataPath], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: 'scripts' } })
const data = JSON.parse(readFileSync(dataPath, 'utf8'))
const frameOf = name => data.frames[name] ?? [0, 0, 100, 100]
const size = frame => frame[2] <= 50 ? 110 : frame[2] <= 70 ? 130 : 170
const formCell = (letter, form) => cell(strokeSvg(form.paths, { frame: frameOf(form.name), size: size(frameOf(form.name)) }), letter, form.name)

const note = 'Numbered circle = pen down (stroke order); arrowhead = direction of travel. Dashed box = the form\'s frame. Original AI-assisted candidates, not human-reviewed.'
const consonants = data.masters.filter(m => m.kind === 'consonant')
const vowels = data.masters.filter(m => m.kind === 'vowel')
const sheets = [
  ['1-consonant-masters', 'Korean letter masters: consonants and their contextual forms (' + label + ')', consonants.map(m => section('Consonant ' + m.letter, m.forms.map(f => formCell(m.letter, f)))), note],
  ['2-vowel-masters', 'Korean letter masters: vowels and contextual forms (' + label + ')', [section('Vowels', vowels.flatMap(m => m.forms.map(f => formCell(m.letter, f))))], note],
  ['3-composite-letters', 'Korean composite letters: doubled consonants, compound vowels, final clusters (' + label + ')',
    ['double consonant', 'compound vowel', 'final cluster'].map(kind => section(kind, data.composites.filter(c => c.kind === kind).flatMap(c => c.forms.map(f => formCell(c.letter, f))))), note],
  ['4-block-layouts', 'Korean syllable block layouts: one sample each (' + label + ')',
    [section('Layouts', data.samples.map(s => {
      const paths = s.parts.flatMap(p => p.paths)
      return cell(strokeSvg(paths, { size: 300 }), s.letter, s.layout)
    }), 'Strokes are numbered across the whole block in writing order: initial consonant, vowel, then final.')], note],
]
// A sheet taller than a few screens is split (3 sections per image) so each image stays legible for a reviewer.
for (const [file, title, sections, extra] of sheets) {
  const parts = []
  for (let i = 0; i < sections.length; i += 3) parts.push(sections.slice(i, i + 3))
  for (const [n, group] of parts.entries()) {
    const name = `${label}-${file}${parts.length > 1 ? `-${n + 1}` : ''}.png`
    await screenshotHtml(sheetPage(title, `<p class="note">${extra}</p>` + group.join('')), join(out, name), { width: 1100, scale: 2 })
    console.log(name)
  }
}
