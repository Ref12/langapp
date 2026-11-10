import { describe, expect, it } from 'vitest'
import { joinNotes } from './note-text'

describe('joining the notes of a result', () => {
  it('a note that ends in a full stop gets no second one', () => {
    expect(joinNotes(['は marks the topic, but here the sentence needs が, which marks the subject, often new information.'])).toBe('は marks the topic, but here the sentence needs が, which marks the subject, often new information.')
    expect(joinNotes(['A particle is missing, extra or in the wrong place.'])).toBe('A particle is missing, extra or in the wrong place.')
  })
  it('a note without one gets exactly one; several are joined', () => {
    expect(joinNotes(['they are optional here'])).toBe('they are optional here.')
    expect(joinNotes(['one', 'two'])).toBe('one; two.')
    expect(joinNotes(['one.', 'two'])).toBe('one. two.')
  })
  it('never ends in two stops, for any note', () => {
    for (const notes of [['a.'], ['a'], ['a.', 'b.'], ['a', 'b.'], ['a?'], ['  a.  ']]) expect(joinNotes(notes)).not.toMatch(/\.\.$/)
  })
  it('empty notes give nothing', () => { expect(joinNotes([])).toBe(''); expect(joinNotes(['', ' '])).toBe('') })
})
