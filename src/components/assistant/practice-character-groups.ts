import { isPracticeBoundary, type PracticeUnit } from '../../core/assistant/practice-chain-contracts'

export function practiceCharacterGroups(units: PracticeUnit[]) {
  const characters = units.map(unit => unit.text)
  const groups: { start: number; end: number; text: string; plain: boolean }[] = []
  let start = 0
  for (let end = 1; end <= characters.length; end++) {
    if (isPracticeBoundary(characters, end)) {
      const text = characters.slice(start, end).join('')
      // Keycap emoji can start with punctuation, but remain selectable as a whole.
      const plain = !text.includes('\u20e3') && /^[\p{P}\p{Z}\s][\p{P}\p{Z}\s\p{M}]*$/u.test(text)
      groups.push({ start, end, text, plain })
      start = end
    }
  }
  return groups
}
