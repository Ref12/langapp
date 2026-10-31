import { hasGuide, isHan, type WritingScope } from './writing-route'

/** What the writing overlay sheet is showing. `fromList`: opened from a word list that stays open underneath, so Back reveals it. */
export interface WritingSheetRequest { word: string[]; index: number; scope: WritingScope; remember: boolean; fromList: boolean }

let current: WritingSheetRequest | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())

export const getWritingSheet = (): WritingSheetRequest | undefined => current
export function subscribeWritingSheet(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function closeWritingSheet(): void {
  if (!current) return
  current = undefined
  emit()
}

/** Opens the sheet on the first practicable character of `text` without touching the hash. False when nothing in it can be written. */
export function openWritingSheet(text: string, options: { scope?: WritingScope; fromList?: boolean; remember?: boolean } = {}): boolean {
  const word = Array.from(text)
  const index = word.findIndex(character => isHan(character) && hasGuide(character))
  if (index < 0) return false
  current = { word, index, scope: options.scope ?? 'all', remember: options.remember ?? true, fromList: options.fromList ?? false }
  emit()
  return true
}
