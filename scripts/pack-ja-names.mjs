// Names for the Japanese pack: short glosses, pattern names (the Chinese convention "<adjective phrase> + 的 + <noun>"), and label slugs. Pure functions, no files.
// A rule gives a result only where it can be trusted; everything else comes from the authoring overlays (curriculum/japanese/authoring/pack-*.json), never from a fallback.
const toHiragana = text => String(text).replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))

export const MAX_GLOSS = 40
const HAN = /\p{Script=Han}/u

// ---- glosses ----
/** One gloss in the Chinese data's style: no brackets, at most three alternatives, a verb's first alternative starts with "to ", at most 40 characters. null when the rule cannot make one. */
export function shortGloss(text, { verb = false } = {}) {
  let parts = String(text ?? '').replace(/^\d+\.\s*/, '').split(' | ')[0]
    .replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').split(/\s*;\s*/).map(part => part.trim().replace(/\s+/g, ' ')).filter(Boolean)
  parts = parts.filter((part, at) => parts.findIndex(other => other.toLowerCase() === part.toLowerCase()) === at).slice(0, 3)
  if (!parts.length) return null
  if (verb && !/^to /i.test(parts[0])) parts[0] = 'to ' + parts[0]
  while (parts.length > 1 && parts.join('; ').length > MAX_GLOSS) parts.pop()
  const gloss = parts.join('; ')
  return gloss.length > MAX_GLOSS ? null : gloss
}

// ---- pattern names ----
const PLACEHOLDERS = [['い形容詞', '<い-adjective>'], ['な形容詞', '<な-adjective>'], ['形容詞', '<adjective>'], ['動詞', '<verb>'], ['疑問詞', '<question word>'], ['助数詞', '<counter>'], ['時間表現', '<time expression>'], ['時刻', '<time>'], ['場所', '<place>'], ['乗り物', '<vehicle>'], ['主語', '<subject>'], ['数', '<number>'], ['文', '<sentence>'], ['人', '<person>'], ['普通形', '<plain form>']]
const NOT_PLAIN = /[\p{Script=Han}／／（）()？、。～〜「」・]/u

/** The name of an old pattern (動詞ます, Nです) in the new convention, or null when the rule cannot give a good one (the overlay then has to). */
export function patternNameRule(pattern) {
  const parts = []
  let rest = String(pattern).trim(), kana = ''
  const flush = () => { if (kana) parts.push(kana); kana = '' }
  while (rest.length) {
    if (rest[0] === '＋') { flush(); rest = rest.slice(1); continue }
    const noun = rest.match(/^N(\d?)(?![A-Za-z])/)
    if (noun) { flush(); parts.push(noun[1] ? '<noun ' + noun[1] + '>' : '<noun>'); rest = rest.slice(noun[0].length); continue }
    const hit = PLACEHOLDERS.find(([word]) => rest.startsWith(word))
    if (hit) { flush(); parts.push(hit[1]); rest = rest.slice(hit[0].length); continue }
    kana += rest[0]; rest = rest.slice(1)
  }
  flush()
  const name = parts.join(' + ')
  const japanese = parts.filter(part => !part.startsWith('<')).join('')
  if (!parts.length || NOT_PLAIN.test(japanese) || /[A-Za-z]/.test(japanese)) return null
  return name
}

/** The reading line of a name: the Japanese parts in kana. A name without kanji reads the same. Throws on a kanji it cannot read (the overlay gives the reading then). */
export function readingOfName(name, readings = {}) {
  const out = name.split(/(<[^>]*>)/).map(piece => piece.startsWith('<') ? piece : piece.replace(/\p{Script=Han}+/gu, run => {
    if (readings[run] === undefined) throw new Error('No reading for "' + run + '" in the pattern name ' + name)
    return readings[run]
  })).join('')
  return out
}

// ---- label slugs ----
const ABBREVIATIONS = { noun: 'n', verb: 'v', sentence: 's', 'い-adjective': 'i-adj', 'な-adjective': 'na-adj', adjective: 'adj', 'time expression': 'time-expr', number: 'num', 'question word': 'wh', subject: 'subj', 'plain form': 'plain', counter: 'counter' }
const slugWords = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** The label slug of a pattern's reading line: placeholders abbreviated, kana whole words in Hepburn (particles は を へ as wa o e). No fallback: a character that cannot be written throws. */
export function patternSlug(reading, romaji) {
  const out = []
  for (const piece of reading.split(/\s\+\s|(?=<)|(?<=>)/)) {
    const text = piece.trim()
    if (!text) continue
    if (text.startsWith('<')) {
      const inner = text.slice(1, -1), digits = inner.match(/^(.*?)\s*(\d+)$/)
      const base = digits ? digits[1] : inner
      out.push((ABBREVIATIONS[base] ?? slugWords(base)) + (digits ? digits[2] : ''))
      continue
    }
    for (const run of text.split(/[^\p{Script=Hiragana}\p{Script=Katakana}ー]+/u).filter(Boolean)) {
      const fixed = toHiragana(run).replace(/(で|に|と)は/g, '$1わ')
      const word = fixed === 'は' ? 'wa' : fixed === 'を' ? 'o' : fixed === 'へ' ? 'e' : romaji(fixed)
      if (/[^a-z0-9-]/.test(word) || HAN.test(run)) throw new Error('Cannot write "' + run + '" of ' + reading + ' as a label')
      out.push(word)
    }
  }
  return out.join('-').replace(/-+/g, '-')
}

const WEAK = new Set(["i'm", "i'll", 'it', 'its', "it's", 'you', 'your', 'i', 'me', 'my', 'we', 'no', 'not', 'one', 'someone', 'something', 's', 'that', 'this', 'there'])
const STOP = new Set(['to', 'a', 'an', 'the', 'be', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'is', 'are'])
/** The English word that ends a label: the first meaningful word of the gloss, skipping little words and pronouns where another word exists. */
export function glossWord(text) {
  const clean = String(text).toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  const pieces = clean.split(/[;,|/]/).map(part => (part.match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []).filter(word => !STOP.has(word)))
  for (const words of pieces) { const word = words.find(item => !WEAK.has(item)); if (word) return word }
  for (const words of pieces) if (words[0]) return words[0]
  return 'x'
}
