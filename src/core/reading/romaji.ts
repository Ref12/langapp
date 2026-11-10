// Kana to romaji for display: Hepburn consonants, no macrons, made from the kana reading and never stored.
//   し shi, ち chi, つ tsu, ふ fu, じ ji, じゃ ja, ん n ("n'" before a vowel or y), small っ doubles the next consonant (ch becomes tch), ー repeats the vowel before it.
//   A word's reading is spelled letter for letter, so は is "ha" and へ is "he"; the particles は, へ and を are said wa, e and o, and are written so when the token is a particle
//   (tokensToRomaji). A を is always o. A reading that holds a は or へ said wa or e without being a particle token of its own (こんにちは) is in the overrides, consulted first.

/** Kana (or a phrase of them) to romaji, hand-written romaji first: { reading: romaji }. */
export type RomajiOverrides = Readonly<Record<string, string>>

const SINGLE: Record<string, string> = {}
const rows: [string, string[]][] = [
  ['あいうえお', ['a', 'i', 'u', 'e', 'o']], ['かきくけこ', ['ka', 'ki', 'ku', 'ke', 'ko']], ['がぎぐげご', ['ga', 'gi', 'gu', 'ge', 'go']],
  ['さしすせそ', ['sa', 'shi', 'su', 'se', 'so']], ['ざじずぜぞ', ['za', 'ji', 'zu', 'ze', 'zo']], ['たちつてと', ['ta', 'chi', 'tsu', 'te', 'to']],
  ['だぢづでど', ['da', 'ji', 'zu', 'de', 'do']], ['なにぬねの', ['na', 'ni', 'nu', 'ne', 'no']], ['はひふへほ', ['ha', 'hi', 'fu', 'he', 'ho']],
  ['ばびぶべぼ', ['ba', 'bi', 'bu', 'be', 'bo']], ['ぱぴぷぺぽ', ['pa', 'pi', 'pu', 'pe', 'po']], ['まみむめも', ['ma', 'mi', 'mu', 'me', 'mo']],
  ['やゆよ', ['ya', 'yu', 'yo']], ['らりるれろ', ['ra', 'ri', 'ru', 're', 'ro']], ['わゐゑを', ['wa', 'i', 'e', 'o']],
  ['ゎ', ['wa']], ['ゔ', ['vu']],
]
for (const [kana, romaji] of rows) [...kana].forEach((ch, at) => { SINGLE[ch] = romaji[at] })
SINGLE['ん'] = 'n'
const YOON: Record<string, string> = { き: 'ky', ぎ: 'gy', し: 'sh', じ: 'j', ち: 'ch', ぢ: 'j', に: 'ny', ひ: 'hy', び: 'by', ぴ: 'py', み: 'my', り: 'ry', ゔ: 'vy' }
const SMALL_Y: Record<string, string> = { ゃ: 'a', ゅ: 'u', ょ: 'o' }
const EXTRA: Record<string, string> = {
  しぇ: 'she', じぇ: 'je', ちぇ: 'che', てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du', ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso', ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo', いぇ: 'ye', でゅ: 'dyu', てゅ: 'tyu', ふゅ: 'fyu',
}
const SMALL_VOWEL: Record<string, string> = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' }
const PUNCTUATION: Record<string, string> = { '。': '.', '、': ',', '？': '?', '！': '!', '：': ':', '；': ';', '・': ' ', '「': '"', '」': '"', '『': '"', '』': '"', '（': '(', '）': ')', '　': ' ' }

const toHiragana = (text: string): string => text.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))

/** The romaji of a kana reading (a word, or a few of them), the overrides first. Not a sentence: no particle knows its place here (a を is o, a は is ha). */
export function kanaToRomaji(kana: string, overrides: RomajiOverrides = {}): string {
  const text = toHiragana(kana.normalize('NFC'))
  const entries = Object.entries(overrides).map(([key, value]) => [toHiragana(key), value] as const).sort((a, b) => b[0].length - a[0].length)
  const out: string[] = []
  let doubling = false
  const push = (piece: string) => {
    if (doubling && /^[a-z]/.test(piece) && !/^[aiueo]/.test(piece)) piece = (piece.startsWith('ch') ? 't' : piece[0]) + piece
    doubling = false
    out.push(piece)
  }
  for (let at = 0; at < text.length; at++) {
    const rest = text.slice(at)
    const found = entries.find(([key]) => rest.startsWith(key))
    if (found) { push(found[1]); at += found[0].length - 1; continue }
    const ch = text[at], pair = ch + (text[at + 1] ?? '')
    if (ch === 'っ') { doubling = true; continue }
    if (ch === 'ー') { const last = out.join('').match(/[aiueo]$/); if (last) out.push(last[0]); continue }
    if (ch === 'を') { push(' o '); continue }
    if (EXTRA[pair]) { push(EXTRA[pair]); at++; continue }
    if (YOON[ch] && SMALL_Y[text[at + 1]]) { push(YOON[ch] + SMALL_Y[text[at + 1]]); at++; continue }
    if (SMALL_VOWEL[ch]) { push(SMALL_VOWEL[ch]); continue }
    if (SMALL_Y[ch]) { push('y' + SMALL_Y[ch]); continue }
    if (ch === 'ん') {
      // n' before a vowel or y, so that hon'ya and honya are not confused
      const next = text[at + 1]
      push(next !== undefined && /[あいうえおやゆよ]/.test(next) ? "n'" : 'n')
      continue
    }
    if (SINGLE[ch]) { push(SINGLE[ch]); continue }
    if (PUNCTUATION[ch] !== undefined) { push(PUNCTUATION[ch]); continue }
    push(/[A-Za-z]/.test(ch) ? ch.toLowerCase() : ch)
  }
  return out.join('').replace(/\s+/g, ' ').trim()
}

/** One token of a sentence for its romaji: the kana it is read as, whether it is a particle (grammar token は, へ, を), whether it is punctuation. */
export interface RomajiToken { reading: string; particle?: boolean; punctuation?: boolean }

const PARTICLE_SOUND: Record<string, string> = { は: 'wa', へ: 'e', を: 'o' }

/**
 * The romaji of a sentence from its tokens: a particle は, へ or を is wa, e or o; one space between tokens and none before punctuation;
 * a token that begins with っ (or follows one that ends in it) is a sound cut in two by the token split and is joined to its neighbour.
 */
export function tokensToRomaji(tokens: RomajiToken[], overrides: RomajiOverrides = {}): string {
  let out = ''
  let cut = false // the previous token ended in a small っ
  for (const token of tokens) {
    const reading = token.reading
    if (!reading) continue
    let piece = token.particle && PARTICLE_SOUND[reading] ? PARTICLE_SOUND[reading] : kanaToRomaji(reading, overrides)
    if (!piece) continue
    if (cut && /^[b-df-hj-np-tv-z]/.test(piece)) piece = (piece.startsWith('ch') ? 't' : piece[0]) + piece
    const closing = token.punctuation && /^[.,?!:;)"]/.test(piece)
    if (out && !closing && !cut && !/^[っッ]/.test(reading)) out += ' '
    out += piece
    cut = /[っッ]$/.test(reading)
  }
  return out
}
