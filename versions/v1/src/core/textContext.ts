import type { EnglishWordSelection } from './domain'

interface SentenceRange {
  start: number
  end: number
}

function sentenceRanges(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = []
  const boundary = /[.!?]+(?:["')\]]+)?(?:\s+|$)/g
  let start = 0

  for (const match of text.matchAll(boundary)) {
    const matchStart = match.index
    const end = matchStart + match[0].length
    if (text.slice(start, end).trim()) ranges.push({ start, end })
    start = end
  }

  if (text.slice(start).trim()) ranges.push({ start, end: text.length })
  return ranges.length ? ranges : [{ start: 0, end: text.length }]
}

export function contextAroundSelection(
  text: string,
  selection: EnglishWordSelection,
  surroundingSentences = 2,
): string {
  const ranges = sentenceRanges(text)
  const selectedSentence = Math.max(
    ranges.findIndex(
      (range) =>
        selection.start >= range.start && selection.start < range.end,
    ),
    0,
  )
  const first = Math.max(0, selectedSentence - surroundingSentences)
  const last = Math.min(
    ranges.length - 1,
    selectedSentence + surroundingSentences,
  )
  const contextStart = ranges[first].start
  const contextEnd = ranges[last].end
  const context = text.slice(contextStart, contextEnd)
  const localStart = selection.start - contextStart
  const localEnd = selection.end - contextStart

  return `${context.slice(0, localStart)}<selected-word>${context.slice(
    localStart,
    localEnd,
  )}</selected-word>${context.slice(localEnd)}`.trim()
}
