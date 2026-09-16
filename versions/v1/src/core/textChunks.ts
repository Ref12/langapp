export interface TextChunk {
  start: number
  text: string
}

export function splitTextForAnalysis(
  text: string,
  maximumLength = 120_000,
): TextChunk[] {
  if (maximumLength < 1) throw new Error('Maximum chunk length must be positive.')
  if (text.length <= maximumLength) return [{ start: 0, text }]

  const chunks: TextChunk[] = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(text.length, start + maximumLength)
    if (end < text.length) {
      const minimumSplit = start + Math.floor(maximumLength * 0.55)
      const candidates = [
        text.lastIndexOf('\n\n', end),
        text.lastIndexOf('. ', end),
        text.lastIndexOf('? ', end),
        text.lastIndexOf('! ', end),
        text.lastIndexOf('\n', end),
        text.lastIndexOf(' ', end),
      ].filter((candidate) => candidate >= minimumSplit)
      if (candidates.length) end = Math.max(...candidates) + 1
    }

    const chunk = text.slice(start, end)
    if (chunk.trim()) chunks.push({ start, text: chunk })
    start = end
  }

  return chunks
}
