/**
 * Character components: the breakdown of a character into parts, with the stroke each part owns, roles, meanings and variant forms.
 * Data: public/characters/chinese/components.generated.json (1.4 MB, about 183 kB gzipped). It is fetched once, on the first screen that
 * shows a decomposition or colours strokes, and cached for the session; it is never part of the main bundle.
 */
import { defaultWritingLanguage, languageAssetUrl, type WritingLanguage } from './language'
import { loadCharacterMeaning } from './meanings'

export interface ComponentNode { c: string; s: number[]; d?: string; k?: ComponentNode[]; r?: 'semantic' | 'phonetic' | 'other'; e?: { t?: string; h?: string }; u?: 1 }
export interface CharacterComponents { n: number; rad?: string; t?: string; h?: string; d?: string; k?: ComponentNode[]; phoneticAlsoSemantic?: string }
export interface ComponentInfo {
  uses: number
  pos?: Record<string, number>
  standalone?: boolean
  /** Reading (Unihan kMandarin, tone marks) of a form that is not a character of the set. */
  py?: string
  meaning?: { en: string; source: string; of?: string }
  none?: 'placeholder' | 'structural' | 'unique-shape'
  status: 'meaning' | 'none' | 'unknown'
  byPosition?: Record<string, { of: string; en: string }>
}
export interface ComponentData { characters: Record<string, CharacterComponents>; components: Record<string, ComponentInfo> }
/** glyphs: drawn shapes (Private Use Area code points in the parts font) keyed "character:strokes". missing: parts whose own character neither the parts font nor ordinary phone fonts can be trusted to show; they are drawn too. */
export interface PartGlyphs { glyphs: Record<string, number>; missing?: string[] }

const tables = new Map<WritingLanguage, Promise<ComponentData>>()
let glyphTable: Promise<PartGlyphs> | undefined
const url = (language: WritingLanguage) => languageAssetUrl(language, 'components.generated.json')

/** For tests: forget the loaded tables. */
export const resetComponentData = () => { tables.clear(); glyphTable = undefined; formIndex = undefined }

/** The parts file, retried once: a flaky or briefly offline network is the usual failure ("Failed to fetch"). */
const fetchOnce = (language: WritingLanguage) => fetch(url(language)).catch(() => fetch(url(language)))

/** Only Chinese has a parts table so far; for another language the fetch fails and the caller shows no decomposition. It never answers with Chinese parts. */
export function loadComponentData(language: WritingLanguage = defaultWritingLanguage): Promise<ComponentData> {
  let table = tables.get(language)
  if (!table) {
    table = fetchOnce(language).then(response => response.ok ? response.json() as Promise<ComponentData> : Promise.reject(new Error(`The character parts could not be loaded (${response.status}).`)))
      .then(data => data?.characters && data.components ? data : Promise.reject(new Error('The character parts file is not in the expected format.')))
      .catch(reason => { tables.delete(language); throw reason })
    tables.set(language, table)
  }
  return table
}

/** The drawn glyphs (Private Use Area code points in the parts font) for parts that have no font character. A small separate chunk. */
export function loadPartGlyphs(): Promise<PartGlyphs> {
  glyphTable ??= import('../../data/characters/part-glyphs.generated.json').then(module => module.default as PartGlyphs)
  return glyphTable
}

export type PartRole = 'meaning' | 'sound' | 'both'
export interface PartView {
  key: string
  /** The component as text (a font character), or a drawn glyph from the parts font, or undefined when neither exists. */
  glyph?: string
  strokes: number[]
  /** No font character: the shape is drawn from the strokes. */
  drawn: boolean
  meaning?: string
  /** The part's own reading when it has no entry in the character meanings table (a bound form such as 㝵). */
  reading?: string
  role?: PartRole
  /** The part is a bound form: it never stands alone as a character. */
  bound: boolean
  /** Known to have no meaning of its own (a placeholder such as 又 in 汉, or a structural shape). */
  noMeaning: boolean
  /** The part is a full character with a Dictionary entry. */
  link?: string
  /** A variant form: which character it is a form of, and where it sits in this character. */
  form?: { of: string; place?: string }
  children: PartView[]
  /** Position among the siblings in the data (the colour index; a hidden part leaves a gap). */
  index: number
}

const SLOTS: Record<string, string[]> = {
  '⿰': ['left', 'right'], '⿱': ['top', 'bottom'], '⿲': ['left', 'middle', 'right'], '⿳': ['top', 'middle', 'bottom'],
}
const slotOf = (operator: string | undefined, index: number): string | undefined => operator ? SLOTS[operator]?.[index] : undefined

/** A part the source gave no character and no strokes of its own: a placeholder (？) or an unnamed group whose strokes were not matched. */
const unmapped = (kid: ComponentNode) => !!kid.u || (!kid.c && kid.s.length === 0)

/** The strokes of a node's children that no sibling claims, for the single part drawn from them (a source placeholder). */
export function leftoverStrokes(node: { k?: ComponentNode[] }, strokes: number[]): number[] {
  const claimed = new Set((node.k ?? []).filter(kid => !kid.u).flatMap(kid => kid.s))
  return strokes.filter(stroke => !claimed.has(stroke))
}

/** The first senses of a Unihan-style gloss: ";" separates senses, and a gloss with none is a comma list (㝵: "(ancient form of 得) to get, complacent, (same as 礙) to obstruct, ...") cut to its first few items. */
const firstSenses = (text: string, count = 2) => text.includes(';') ? text.split(';').slice(0, count).map(sense => sense.trim()).filter(Boolean).join('; ') : text.split(', ').slice(0, count + 1).join(', ')

/** The parts of a character, one level (each with its own children for nesting), in reading order. */
export function describeParts(data: ComponentData, character: string, glyphs?: PartGlyphs, hasEntry: (character: string) => boolean = ch => data.components[ch]?.standalone === true): PartView[] {
  const entry = data.characters[character]
  if (!entry) return []
  const build = (node: ComponentNode | CharacterComponents, strokes: number[], type: string | undefined, trail: string, alsoSound?: string): PartView[] => {
    const kids = node.k ?? []
    const views = kids.map((kid, index): PartView => {
      const info = data.components[kid.c]
      // Drawn from strokes: a placeholder, a group no character names, or a character the fonts cannot show.
      const lacking = !kid.u && !!kid.c && !!glyphs?.missing?.includes(kid.c)
      const drawn = !!kid.u || !kid.c || lacking
      const rest = unmapped(kid) && kids.filter(unmapped).length === 1 ? leftoverStrokes(node, strokes) : []
      const own = kid.s.length ? kid.s : rest
      const code = drawn && own.length ? glyphs?.glyphs[`${character}:${own.join(',')}`] : undefined
      const role: PartRole | undefined = alsoSound && kid.c === alsoSound ? 'both' : kid.r === 'semantic' ? 'meaning' : kid.r === 'phonetic' ? 'sound' : type === 'ideographic' && !drawn ? 'meaning' : undefined
      const slot = slotOf(node.d, index)
      const parent = !drawn ? (info?.byPosition && slot ? info.byPosition[slot]?.of : info?.meaning?.of) : undefined
      const variant = !!info && !info.standalone && !!parent && parent !== kid.c
      const noMeaning = (drawn && !lacking) || info?.status === 'none' || (info?.status === 'unknown' && !info.meaning)
      const meaning = noMeaning ? undefined : info?.byPosition && slot && info.byPosition[slot] ? info.byPosition[slot].en : info?.meaning?.en
      const key = `${trail}${index}`
      return {
        key, glyph: drawn ? (code ? String.fromCodePoint(code) : undefined) : kid.c, strokes: own, drawn,
        meaning: meaning ? firstSenses(meaning) : undefined, reading: !drawn ? info?.py : undefined, role, bound: !drawn && !!info && !info.standalone, noMeaning,
        link: !drawn && !noMeaning && info?.standalone && hasEntry(kid.c) ? kid.c : undefined,
        form: variant ? { of: parent!, place: slot } : undefined,
        children: kid.k?.length ? build(kid, own, kid.e?.t, `${key}.`) : [],
        index,
      }
    })
    // A drawn part with no strokes mapped can be neither drawn nor named: leave it out rather than show a box.
    return views.filter(view => !(view.drawn && !view.glyph))
  }
  return build(entry, Array.from({ length: entry.n }, (_, i) => i), entry.t, '', entry.phoneticAlsoSemantic)
}

/** One colour index per stroke (the top-level part it belongs to), undefined for a stroke no part owns. */
export function strokeParts(data: ComponentData, character: string, strokeCount: number): (number | undefined)[] {
  const entry = data.characters[character]
  const result: (number | undefined)[] = Array.from({ length: strokeCount }, () => undefined)
  if (!entry?.k) return result
  entry.k.forEach((kid, index) => {
    const strokes = unmapped(kid) ? (entry.k!.filter(unmapped).length === 1 ? leftoverStrokes(entry, Array.from({ length: entry.n }, (_, i) => i)) : []) : kid.s
    for (const stroke of strokes) if (stroke < strokeCount) result[stroke] = index
  })
  return result
}

export const PART_COLOURS = 6
export const partColour = (index: number) => `var(--part-c${(index % PART_COLOURS) + 1})`

let formIndex: Map<string, string[]> | undefined
/** The forms of one radical: the character itself and each variant component that is a form of it, with a few example characters. */
export function formsOf(data: ComponentData, parent: string): { form: string; place?: string; examples: string[] }[] {
  if (!formIndex) {
    formIndex = new Map()
    for (const [char, entry] of Object.entries(data.characters)) for (const kid of entry.k ?? []) {
      if (kid.u || !kid.c) continue
      const list = formIndex.get(kid.c) ?? []
      if (list.length < 3 && !list.includes(char)) list.push(char)
      formIndex.set(kid.c, list)
    }
  }
  const rows = [parent, ...Object.entries(data.components).filter(([form, info]) => form !== parent && (info.meaning?.of === parent || Object.values(info.byPosition ?? {}).some(entry => entry.of === parent))).map(([form]) => form)]
  return rows.filter(form => data.components[form]).map(form => {
    const pos = Object.entries(data.components[form].pos ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0]
    return { form, place: pos && /^(left|right|top|bottom|middle)$/.test(pos) ? pos : undefined, examples: formIndex!.get(form) ?? [] }
  })
}

/** Pinyin of a sound part (tone marks), from the character meaning table; undefined when it has none. */
export async function partPinyin(character: string): Promise<string | undefined> {
  return (await loadCharacterMeaning(character))?.pinyin
}
