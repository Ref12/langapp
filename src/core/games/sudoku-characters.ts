import type { Workspace } from '../model'
import type { Catalog } from '../study/catalog'
import { characterKnowledge, wordCharacters } from '../characters/dictionary'
import { getWord } from '../../data/mandarin'
import type { SudokuSymbol } from './sudoku-contracts'

export function sudokuKnownWords(catalog: Catalog, workspace: Workspace): SudokuSymbol['contexts'] {
  const words: SudokuSymbol['contexts'] = []
  for (const entry of workspace.knowledge) {
    const unit = catalog.units.get(entry.ref)
    if (unit?.kind === 'vocabulary') words.push({ text: unit.record.ch, pinyin: unit.record.pr, meaning: unit.record.ds })
  }
  for (const entry of workspace.words) {
    const word = getWord(entry.wordId)
    words.push({ text: word.native, pinyin: word.pinyin, meaning: word.meaning })
  }
  return [...new Map(words.map(word => [JSON.stringify(word), word])).values()]
}

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
  for (const word of sudokuKnownWords(catalog, workspace)) addContext(word.text, word.pinyin, word.meaning)
  return [...characters].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).map(character => ({
    character, contexts: contexts.get(character) ?? [],
  }))
}

/** Use the actual containing words first, not just standalone curriculum entries. */
export async function resolveSudokuReadings(symbol: SudokuSymbol, standalone: Iterable<string> = []): Promise<string[]> {
  if (symbol.readings?.length) return [...new Set(symbol.readings.map(value => value.normalize('NFC')))]
  const { createPracticePlan } = await import('../assistant/practice-chain')
  const contextual = new Set<string>()
  for (const context of symbol.contexts) {
    const plan = createPracticePlan(context.text, context.pinyin || undefined)
    for (const unit of plan.units) if (unit.text === symbol.character && unit.pinyin) contextual.add(unit.pinyin.normalize('NFC'))
  }
  if (contextual.size) return [...contextual]
  const fallback = new Set([...standalone].map(value => value.normalize('NFC')))
  const plan = createPracticePlan(symbol.character)
  for (const unit of plan.units) if (unit.text === symbol.character && unit.pinyin) fallback.add(unit.pinyin.normalize('NFC'))
  return [...fallback]
}
