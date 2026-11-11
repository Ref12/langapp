// The Korean look-up source: the TOPIK words and grammar outside the pack catalog. Loaded on demand (dictionary-ko.ts imports it dynamically).
// A headword that the list has more than once (different dictionary senses) is one entry here, its senses together.
import { loadDictionary, type DictWord } from './dictionary-file'
import { koreanLookupSearch } from './dictionary-ko'
import type { LookupSource } from './dictionary'

export const SHORT_GLOSS = 80

/** The first sense of a definition, cut at a word near 80 characters: the line of a list row. */
export function shortGloss(meaning: string): string {
  const first = (meaning.split(/ [|/] /)[0] ?? '').trim()
  if (first.length <= SHORT_GLOSS) return first
  const cut = first.slice(0, SHORT_GLOSS - 1)
  const space = cut.lastIndexOf(' ')
  return (space > 40 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '') + '\u2026'
}

/** The entries of one headword as one: the senses of every entry in file order ("|" between entries, " / " inside one), the best level, the parts of speech, and every id. */
export function groupHeadwords(words: DictWord[]): DictWord[] {
  const byForm = new Map<string, DictWord[]>()
  for (const word of words) { const list = byForm.get(word.form); if (list) list.push(word); else byForm.set(word.form, [word]) }
  return [...byForm.values()].map(list => {
    const first = list[0]
    const meaning = list.map(word => word.meaning).join(' | ')
    const levels = list.filter(word => word.levelNo > 0)
    const best = levels.length ? levels.reduce((a, b) => b.levelNo < a.levelNo ? b : a) : undefined
    return { ...first, meaning, short: shortGloss(first.meaning), ids: list.map(word => word.id), pos: [...new Set(list.map(word => word.pos).filter(Boolean))].join(', '), level: best?.level, levelNo: best?.levelNo ?? 0 }
  })
}

export async function loadKoreanLookup(inCatalog: (id: string) => boolean): Promise<LookupSource> {
  const dictionary = await loadDictionary('ko')
  return { words: groupHeadwords(dictionary.words.filter(word => !inCatalog(word.id))), grammar: dictionary.grammar.filter(item => !inCatalog(item.id)), search: koreanLookupSearch }
}
