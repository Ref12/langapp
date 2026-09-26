import type { Workspace } from '../model'
import type { Catalog } from '../study/catalog'
import { characterKnowledge, wordCharacters } from '../characters/dictionary'
import { getWord } from '../../data/mandarin'
import type { SudokuSymbol } from './sudoku-contracts'

export function sudokuCharacters(catalog: Catalog, workspace: Workspace): SudokuSymbol[] {
  const characters = characterKnowledge(catalog, workspace.knowledge, workspace.characterStates).all
  const contexts = new Map<string, SudokuSymbol['contexts']>()
  const addContext = (text: string, pinyin: string, meaning: string) => {
    for (const character of wordCharacters(text)) {
      characters.add(character)
      const examples = contexts.get(character) ?? []
      if (examples.length < 3 && !examples.some(example => example.text === text && example.pinyin === pinyin && example.meaning === meaning)) {
        examples.push({ text, pinyin: pinyin.normalize('NFC'), meaning })
      }
      contexts.set(character, examples)
    }
  }
  for (const entry of workspace.knowledge) {
    const unit = catalog.units.get(entry.ref)
    if (unit?.kind === 'vocabulary') addContext(unit.record.ch, unit.record.pr, unit.record.ds)
  }
  for (const entry of workspace.words) {
    const word = getWord(entry.wordId)
    addContext(word.native, word.pinyin, word.meaning)
  }
  return [...characters].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).map(character => ({
    character, contexts: contexts.get(character) ?? [],
  }))
}
