/** Which subtitle lines to offer for study. */
export interface TimedLine { start: number }

/** Lines starting within `seconds` after `time` (indices into `lines`). */
export function nextInterval(lines: readonly TimedLine[], time: number, seconds: number): number[] {
  const out: number[] = []
  lines.forEach((line, index) => { if (line.start >= time && line.start < time + seconds) out.push(index) })
  return out
}

/** The next `count` line indices starting at `from`. */
export function nextLines(lines: readonly TimedLine[], from: number, count: number): number[] {
  const start = Math.max(0, from)
  return lines.slice(start, start + Math.max(0, count)).map((_, offset) => start + offset)
}
