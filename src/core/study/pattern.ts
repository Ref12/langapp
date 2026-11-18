/** Helpers for grammar patterns such as "<clause one>，<optional subject> + 还 + <predicate>": slots are <angle> names, "+" separates the parts. */

export type PatternPart = { slot: string } | { text: string } | { plus: true }

/** The parts of a pattern, in order: slot names, literal text, and "+" separators. */
export function patternParts(pattern: string): PatternPart[] {
  const parts: PatternPart[] = []
  for (const piece of pattern.split(/(<[^<>]*>)/)) {
    if (!piece) continue
    if (piece.startsWith('<') && piece.endsWith('>')) { parts.push({ slot: piece.slice(1, -1).trim() }); continue }
    piece.split(/(\+)/).forEach(chunk => {
      if (chunk === '+') parts.push({ plus: true })
      else if (chunk) parts.push({ text: chunk })
    })
  }
  return parts
}

/** Kanji/Han, kana (and the long-vowel mark) and Hangul: what counts as fixed text in zh, ja and ko. */
const FIXED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u30fc]/u

/** The pattern's fixed text with each slot as "…" (`…，还…`, `半…`, `不要…`). Consecutive slots and separators collapse to one "…" (a slot right after a slot and its comma is dropped); the result is trimmed. Empty when the pattern has no fixed text. */
export function grammarAnchor(pattern: string): string {
  const parts = patternParts(pattern)
  if (!parts.some(part => 'text' in part && FIXED.test(part.text))) return ''
  const joined = parts.map(part => 'slot' in part ? '…' : 'text' in part ? part.text.trim() + (/\/\s+$/.test(part.text) ? ' ' : '') : '').join('')
  return joined.replace(/…+/g, '…').replace(/…([，、,])…/g, '…$1').trim()
}
