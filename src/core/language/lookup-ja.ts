// The Japanese look-up source: the JLPT words and grammar outside the pack catalog, and the search over them. Loaded on demand (dictionary.ts imports it dynamically).
import { kanaToRomaji, type RomajiOverrides } from '../reading/romaji'
import { loadDictionary, type DictGrammar, type DictWord } from './dictionary-file'
import { foldRomaji, foldText, japaneseRanker, lazy, type Keys, type LookupSearch, type LookupSource } from './dictionary'

const lookupKeys = new WeakMap<object, Keys>()
const wordKeys = (word: DictWord, overrides: RomajiOverrides): Keys => {
  let keys = lookupKeys.get(word)
  if (!keys) { const kana = foldText(word.reading); keys = { text: [foldText(word.form)], kana: [kana], romaji: lazy(() => [foldRomaji(kanaToRomaji(kana, overrides))]), ds: word.meaning.replace(/ \| /g, '; ').toLowerCase() }; lookupKeys.set(word, keys) }
  return keys
}
const grammarKeys = (item: DictGrammar): Keys => {
  let keys = lookupKeys.get(item)
  if (!keys) { keys = { text: [foldText(item.pattern)], kana: [], romaji: () => [], ds: item.english.toLowerCase() }; lookupKeys.set(item, keys) }
  return keys
}

/** The same search as the catalog's, over look-up entries: kana, kanji, romaji (long vowels folded) and English. */
export function japaneseLookupSearch(query: string, overrides: RomajiOverrides = {}): LookupSearch {
  const ranker = japaneseRanker(query)
  return { empty: ranker.empty, word: word => ranker.empty ? 0 : ranker.rank(wordKeys(word, overrides)), grammar: item => ranker.empty ? 0 : ranker.rank(grammarKeys(item)) }
}

export async function loadJapaneseLookup(inCatalog: (id: string) => boolean): Promise<LookupSource> {
  const dictionary = await loadDictionary('ja')
  return { words: dictionary.words.filter(word => !inCatalog(word.id)), grammar: dictionary.grammar.filter(item => !inCatalog(item.id)), search: japaneseLookupSearch }
}
