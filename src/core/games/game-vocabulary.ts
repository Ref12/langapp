import { z } from 'zod'
import { getWord } from '../../data/mandarin'
import type { Workspace } from '../model'
import { glosses } from '../questions'
import { requireUnit, type Catalog } from '../study/catalog'

export const faceSchema = z.enum(['character', 'pinyin', 'meaning'])
export type TileFace = z.infer<typeof faceSchema>
export const pairModeSchema = z.enum(['mixed', 'character-meaning', 'character-pinyin', 'pinyin-meaning'])
export type PairMode = z.infer<typeof pairModeSchema>
export const gameWordSchema = z.object({
  id: z.string().min(1), character: z.string().min(1).max(6),
  pinyin: z.string().min(1).max(24), meaning: z.string().min(1).max(32),
}).strict()
export type GameWord = z.infer<typeof gameWordSchema>

const representations: Record<Exclude<PairMode, 'mixed'>, [TileFace, TileFace]> = {
  'character-meaning': ['character', 'meaning'],
  'character-pinyin': ['character', 'pinyin'],
  'pinyin-meaning': ['pinyin', 'meaning'],
}
export function pairFaces(mode: PairMode, index: number): [TileFace, TileFace] {
  return mode === 'mixed' ? Object.values(representations)[index % 3] : representations[mode]
}

function normalized(face: TileFace, text: string): string {
  const value = text.normalize('NFKC').toLowerCase().trim()
  return face === 'pinyin' ? value.replace(/\s/g, '') : value.replace(/\s+/g, ' ')
}

export function distinctWords(words: readonly GameWord[]): GameWord[] {
  const seen = { character: new Set<string>(), pinyin: new Set<string>(), meaning: new Set<string>() }
  const ids = new Set<string>()
  const meanings = new Set<string>()
  return words.filter(word => {
    const parts = glosses(word.meaning)
    if (!gameWordSchema.safeParse(word).success || parts.length === 0 || ids.has(word.id)
      || faceSchema.options.some(face => seen[face].has(normalized(face, word[face])))
      || parts.some(part => meanings.has(part))) return false
    faceSchema.options.forEach(face => seen[face].add(normalized(face, word[face])))
    ids.add(word.id)
    parts.forEach(part => meanings.add(part))
    return true
  })
}

export function introducedGameWords(catalog: Catalog, workspace: Workspace): GameWord[] {
  const vocabulary: GameWord[] = []
  for (const entry of workspace.knowledge) {
    const unit = requireUnit(catalog, entry.ref)
    if (unit.kind === 'vocabulary') vocabulary.push({ id: unit.ref, character: unit.record.ch, pinyin: unit.record.pr, meaning: unit.record.ds })
  }
  for (const state of workspace.words) {
    const word = getWord(state.wordId)
    vocabulary.push({ id: word.id, character: word.native, pinyin: word.pinyin, meaning: word.meaning })
  }
  return distinctWords(vocabulary)
}
