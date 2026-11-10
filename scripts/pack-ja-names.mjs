// Names for the Japanese pack: short glosses, pattern names (the Chinese convention "<adjective phrase> + 的 + <noun>"), and label slugs. Pure functions, no files.
// A rule gives a result only where it can be trusted; everything else comes from the authoring overlays (curriculum/japanese/authoring/pack-*.json), never from a fallback.
const toHiragana = text => String(text).replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))

export { MAX_GLOSS, shortGloss, glossWord } from './pack-shared.mjs'
const HAN = /\p{Script=Han}/u
// (the short gloss rule and glossWord moved to pack-shared.mjs, where the Korean pack uses them too)

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
const WORDS = { noun: 'n', verb: 'v', sentence: 's', 'い-adjective': 'i-adj', 'な-adjective': 'na-adj', adjective: 'adj', 'ない-form': 'nai-form', expression: 'expr', number: 'num', question: 'wh', subject: 'subj', plain: 'plain', dictionary: 'dict' }
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
      if (base === 'question word') { out.push('wh' + (digits ? digits[2] : '')); continue }
      out.push(base.split(' ').map(word => WORDS[word] ?? slugWords(word)).filter(Boolean).join('-') + (digits ? digits[2] : ''))
      continue
    }
    if (HAN.test(text)) throw new Error('Cannot write the kanji of "' + text + '" as a label: the reading line has to be in kana')
    for (const run of text.split(/[^\p{Script=Hiragana}\p{Script=Katakana}ー]+/u).filter(Boolean)) {
      const fixed = toHiragana(run).replace(/(で|に|と)は/g, '$1わ')
      const word = fixed === 'は' ? 'wa' : fixed === 'を' ? 'o' : fixed === 'へ' ? 'e' : romaji(fixed)
      if (/[^a-z0-9-]/.test(word) || HAN.test(run)) throw new Error('Cannot write "' + run + '" of ' + reading + ' as a label')
      out.push(word)
    }
  }
  return out.join('-').replace(/-+/g, '-')
}


// ---- short texts ----
const isPlaceholder = piece => /^<[^>]*>$/.test(piece)
const isPlaceholderGroup = piece => /^\(.*\)$/.test(piece) && piece.slice(1, -1).split(/\s\+\s|\s\/\s/).every(part => isPlaceholder(part.trim()))
/**
 * The short text of a pattern name: its fixed written part with the placeholders dropped ("<noun> + の + <noun>" is の, "<verb> + (ました / ませんでした)" is ました / ませんでした, "<noun> + が + 欲しい" is がほしい written as が欲しい).
 * A group of alternatives keeps its words without the brackets. null where the rule cannot be trusted: nothing fixed is left, or the fixed words are separated by a placeholder (は ... に ... を), or a group stands between fixed words
 * (の + (後ろ / 前 / 隣) + に); the authoring file gives those.
 */
export function shortTextRule(name) {
  const pieces = String(name).split(/\s\+\s/).map(piece => piece.trim()).filter(Boolean)
  const runs = []
  let open = false
  for (const piece of pieces) {
    if (isPlaceholder(piece) || isPlaceholderGroup(piece)) { open = false; continue }
    if (!open) runs.push([])
    runs.at(-1).push(piece)
    open = true
  }
  if (runs.length !== 1) return null
  const run = runs[0]
  if (run.length > 1 && run.some(piece => piece.startsWith('('))) return null
  return run.map(piece => piece.replace(/^\((.*)\)$/, '$1')).join('')
}
