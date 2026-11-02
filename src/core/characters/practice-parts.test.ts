import { describe, expect, it } from 'vitest'
import { allPartsWritten, isLastStep, newWritingRound, nextPart, partIndex, PART_COUNT, previousRound } from './practice'

describe('stepping through the parts of a character', () => {
  it('Next skips an unwritten part, cleanly, through all nine parts', () => {
    let round = newWritingRound()
    const seen = [partIndex(round)]
    for (let next = nextPart({ ...round, completed: 1, misses: [1] }); next; next = nextPart(next)) {
      expect(next.completed).toBe(0)
      expect(next.misses).toEqual([])
      seen.push(partIndex(next))
      round = next
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(isLastStep(round)).toBe(true)
  })
  it('the last part has no next part (goes on to the next character); the first has no previous part', () => {
    expect(nextPart({ ...newWritingRound(), phase: 2, repetition: 2 })).toBeUndefined()
    expect(previousRound(newWritingRound())).toBeUndefined()
  })
  it('records only when all nine parts were written', () => {
    expect(allPartsWritten(new Set([0, 1, 2, 3, 4, 5, 6, 7]))).toBe(false)
    expect(allPartsWritten(new Set(Array.from({ length: PART_COUNT }, (_, i) => i)))).toBe(true)
  })
})
