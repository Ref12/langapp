import { z } from 'zod'

// The small generated index next to the band files (src/data/phrases/index.json, written with them): the shipped phrase count per band and per vocabulary word,
// so a count can be shown without loading the band files. If it cannot be read, loadPhraseIndex resolves undefined and callers show no number.
const indexSchema = z.object({
  schemaVersion: z.literal(1),
  bands: z.record(z.string(), z.object({ count: z.number().int().nonnegative(), words: z.record(z.string(), z.number().int().positive()) })),
})
export interface PhraseIndex { total: number; byWord: ReadonlyMap<string, number> }

export function parsePhraseIndex(raw: unknown): PhraseIndex | undefined {
  const parsed = indexSchema.safeParse(raw)
  if (!parsed.success) return undefined
  let total = 0
  const byWord = new Map<string, number>()
  for (const band of Object.values(parsed.data.bands)) {
    total += band.count
    for (const [word, count] of Object.entries(band.words)) byWord.set(`vocabulary:${word}`, (byWord.get(`vocabulary:${word}`) ?? 0) + count)
  }
  return { total, byWord }
}

let pending: Promise<PhraseIndex | undefined> | undefined
export function loadPhraseIndex(): Promise<PhraseIndex | undefined> {
  pending ??= import('../../data/phrases/index.json').then(module => parsePhraseIndex(module.default)).catch(() => undefined)
  return pending
}

