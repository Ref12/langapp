// How the notes of a result are joined into the sentence that follows "Not the model answer." or "Differences:". A note may already end in a full stop
// (the particle notes do); the sentence around it must not add a second one, for any language.

const ENDS = /[.!?\u3002\uFF01\uFF1F]$/

/** The notes as one sentence ending in exactly one full stop: notes without a stop are joined with "; ", a note that has its own stop is followed by a space. */
export function joinNotes(notes: readonly string[]): string {
  let text = ''
  for (const note of notes.map(item => item.trim()).filter(Boolean)) text = text ? text + (ENDS.test(text) ? ' ' : '; ') + note : note
  return text && !ENDS.test(text) ? text + '.' : text
}
