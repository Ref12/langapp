// Sheet of confusable kana pairs drawn from the shipped Japanese data (public/characters/japanese). Usage: node scripts/kana-confusables-sheet.mjs [out.png]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cell, screenshotHtml, section, sheetPage, strokeSvg } from './writing-sheet-render.mjs'

const groups = [['シ', 'ツ'], ['ソ', 'ン'], ['ぬ', 'め'], ['わ', 'ね', 'れ'], ['る', 'ろ'], ['さ', 'ち'], ['ク', 'ケ', 'タ']]
const pages = new Map()
const strokes = character => {
  const page = `u${(character.codePointAt(0) >>> 8).toString(16).padStart(4, '0')}`
  if (!pages.has(page)) pages.set(page, JSON.parse(readFileSync(join('public', 'characters', 'japanese', `${page}.generated.json`), 'utf8')))
  const record = pages.get(page).characters.find(item => item.character === character)
  if (!record) throw new Error(`${character} is not in the shipped Japanese data`)
  return record.paths
}
const sections = groups.map(group => section(group.join(' / '), group.map(character => cell(strokeSvg(strokes(character), { size: 170, pad: 10 }), character, `${strokes(character).length} strokes`))))
await screenshotHtml(sheetPage('Confusable kana, from public/characters/japanese (unreviewed)', sections.join(''), 1100), process.argv[2] ?? 'shots/kana-confusables.png', { width: 1100, scale: 1.3 })
console.log('written')
