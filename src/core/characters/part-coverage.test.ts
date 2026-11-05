import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeParts, type ComponentData, type ComponentNode, type PartGlyphs, type PartView } from './components'

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8')
const data = JSON.parse(read('public', 'characters', 'chinese', 'components.generated.json')) as ComponentData
const glyphs = JSON.parse(read('src', 'data', 'characters', 'part-glyphs.generated.json')) as PartGlyphs
const fontCss = read('src', 'components', 'characters', 'parts-font.generated.css')

/** Code points the parts font covers (its unicode-range). */
const fontRanges = [...fontCss.matchAll(/U\+([0-9A-F]+)(?:-([0-9A-F]+))?/g)].map(m => [parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)] as const)
const inFont = (character: string) => fontRanges.some(([from, to]) => character.codePointAt(0)! >= from && character.codePointAt(0)! <= to)
/** A character the parts font does not carry is left to the phone's own fonts, which only the main CJK block can be trusted for. */
const phoneCanShow = (character: string) => { const cp = character.codePointAt(0)!; return (cp >= 0x4e00 && cp <= 0x9fff) || inFont(character) }

/** Every part of every character, nested ones too, as the Decomposition boxes show them. */
function allParts() {
  const rows: { character: string; part: PartView }[] = []
  const walk = (character: string, parts: PartView[]) => parts.forEach(part => { rows.push({ character, part }); walk(character, part.children) })
  for (const character of Object.keys(data.characters)) walk(character, describeParts(data, character, glyphs))
  return rows
}

describe('every part of every character has a visible shape', () => {
  const rows = allParts()
  it('no part is an empty box: each has a character or a drawn glyph', () => {
    const boxes = rows.filter(({ part }) => !part.glyph).map(({ character, part }) => `${character}:${part.key}`)
    expect(boxes).toEqual([])
  })
  it('a drawn glyph is in the parts font; a character glyph is one the phone can show', () => {
    const bad = rows.filter(({ part }) => part.glyph && !(part.drawn ? inFont(part.glyph) : phoneCanShow(part.glyph))).map(({ character, part }) => `${character}:${part.key} ${part.glyph}`)
    expect(bad).toEqual([])
  })
  it('the only parts left out are source placeholders (？) with no strokes mapped, which can be neither drawn nor named', () => {
    // Allow-list, by reason: Make Me a Hanzi marks a part it cannot encode with ？; when the strokes it owns are also claimed elsewhere (临: ⿰？丨 inside a
    // character whose other ？ owns the rest) it has no strokes of its own, so describeParts leaves it out instead of showing a box. 70 before this change, still 70.
    const left: string[] = []
    const walk = (character: string, nodes: ComponentNode[] | undefined, views: PartView[]) => {
      const shown = new Set(views.map(view => view.index))
      ;(nodes ?? []).forEach((node, index) => { if (!shown.has(index)) left.push(`${character}:${node.u ? 'placeholder' : node.c || 'group'}`) })
      views.forEach(view => walk(character, nodes?.[view.index]?.k, view.children))
    }
    for (const [character, entry] of Object.entries(data.characters)) walk(character, entry.k, describeParts(data, character, glyphs))
    expect(left.filter(item => !item.endsWith(':placeholder'))).toEqual([])
    expect(left.length).toBe(70)
  })
  it('the parts font lists the characters it cannot show only when they are drawn', () => {
    const missing = new Set(glyphs.missing ?? [])
    expect(rows.filter(({ part }) => part.glyph && missing.has(part.glyph))).toEqual([])
  })
})

describe('得: the right-hand part', () => {
  it('is 㝵, a character with its meaning and reading, not an empty box', () => {
    const [, right] = describeParts(data, '得', glyphs)
    expect(right.glyph).toBe('㝵')
    expect(right.drawn).toBe(false)
    expect(right.meaning).toMatch(/ancient form of 得/)
    expect(right.reading).toBe('dé')
    expect(right.children.map(kid => kid.glyph)).toEqual(['旦', '寸'])
  })
})
