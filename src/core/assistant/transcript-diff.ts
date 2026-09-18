import { MAX_DRAFT_LENGTH } from './contracts'

export interface TranscriptDifference { kind: 'match' | 'missing' | 'extra'; text: string }
export interface TranscriptComparison {
  outcome: 'match' | 'different' | 'no-speech' | 'no-reference' | 'too-long'
  differences: TranscriptDifference[]
}
export const transcriptOutcomeLabels: Record<TranscriptComparison['outcome'], string> = {
  match: 'Transcript matches.',
  different: 'Transcript differs.',
  'no-speech': 'No words to compare.',
  'no-reference': 'The translation has no comparable text.',
  'too-long': 'Comparison unavailable: normalized text exceeds the supported limits.',
}

function characters(text: string) {
  return Array.from(text.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}]/gu, ''))
}

// Hirschberg alignment keeps memory linear rather than allocating a transcript-sized matrix.
function prefixLengths(expected: string[], actual: string[]) {
  const lengths = new Uint16Array(actual.length + 1)
  for (const token of expected) {
    let diagonal = 0
    for (let index = 0; index < actual.length; index++) {
      const previous = lengths[index + 1]
      lengths[index + 1] = token === actual[index] ? diagonal + 1 : Math.max(lengths[index], previous)
      diagonal = previous
    }
  }
  return lengths
}

export function compareTranscript(expectedText: string, transcript: string): TranscriptComparison {
  if (expectedText.length > 3000 || transcript.length > MAX_DRAFT_LENGTH) throw new Error('The practice comparison exceeds its text limits.')
  const expected = characters(expectedText)
  const actual = characters(transcript)
  if (expected.length > 3000 || actual.length > MAX_DRAFT_LENGTH) return { outcome: 'too-long', differences: [] }
  const differences: TranscriptDifference[] = []
  const append = (kind: TranscriptDifference['kind'], text: string) => {
    if (!text) return
    const previous = differences.at(-1)
    if (previous?.kind === kind) previous.text += text
    else differences.push({ kind, text })
  }
  const align = (left: string[], right: string[]): void => {
    let prefix = 0
    while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++
    append('match', left.slice(0, prefix).join(''))
    left = left.slice(prefix)
    right = right.slice(prefix)
    if (!left.length) { append('extra', right.join('')); return }
    if (!right.length) { append('missing', left.join('')); return }
    if (left.length === 1) {
      const match = right.indexOf(left[0])
      if (match === -1) { append('missing', left[0]); append('extra', right.join('')); return }
      append('extra', right.slice(0, match).join(''))
      append('match', left[0])
      append('extra', right.slice(match + 1).join(''))
      return
    }
    const middle = Math.floor(left.length / 2)
    const before = prefixLengths(left.slice(0, middle), right)
    const after = prefixLengths(left.slice(middle).reverse(), [...right].reverse())
    let split = 0
    for (let index = 1; index <= right.length; index++) {
      if (before[index] + after[right.length - index] > before[split] + after[right.length - split]) split = index
    }
    align(left.slice(0, middle), right.slice(0, split))
    align(left.slice(middle), right.slice(split))
  }
  align(expected, actual)
  return {
    outcome: !expected.length ? 'no-reference' : !actual.length ? 'no-speech'
      : differences.every(part => part.kind === 'match') ? 'match' : 'different',
    differences,
  }
}
