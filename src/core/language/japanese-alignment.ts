// Which kana of a Japanese word's reading belong to which of its characters (学生 がくせい: 学 が く, 生 せ い), built from the word's text and reading alone: no table, no model.
//   Kana in the text (okurigana, particles inside the word) are matched literally against the reading, hiragana and katakana alike (食べる たべる: 食 = た, べる literal).
//   A single kanji between kana, or alone, takes whatever the reading leaves for it (行く いく: 行 = い; 私 わたし).
//   A run of two or more kanji is split only in the regular on'yomi shape: two sounds (a kana, or a kana with a small や ゆ よ, っ, ん, ー each count) per kanji (学生 がく|せい, 学校 がっ|こう, 勉強 べん|きょう).
//   Anything else is not guessed: 今日 きょう, 大人 おとな, 一人 ひとり, 上手 じょうず, 大丈夫 are irregular or uneven, and the alignment is then uncertain (undefined).
//   The alignment is also uncertain when the text and reading can be matched in more than one way.

const SMALL = /[\u3041\u3043\u3045\u3047\u3049\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30e3\u30e5\u30e7\u30ee]/u
const HAN = /[\p{Script=Han}\u3005]/u
const KANA = /^[\u3041-\u3096\u30a1-\u30f6\u30fcー]$/u
const toHiragana = (text: string): string => text.replace(/[\u30a1-\u30f6]/gu, char => String.fromCharCode(char.charCodeAt(0) - 0x60))

/** The sounds of a kana string: each kana is one, a small kana joins the one before it. */
export function kanaSounds(kana: string): string[] {
  const sounds: string[] = []
  for (const char of kana) { if (sounds.length && SMALL.test(char)) sounds[sounds.length - 1] += char; else sounds.push(char) }
  return sounds
}

type Segment = { kanji: string[] } | { kana: string }

function segments(text: string): Segment[] | undefined {
  const out: Segment[] = []
  for (const char of text) {
    if (HAN.test(char)) { const last = out[out.length - 1]; if (last && 'kanji' in last) last.kanji.push(char); else out.push({ kanji: [char] }) }
    else if (KANA.test(char)) { const last = out[out.length - 1]; if (last && 'kana' in last) last.kana += toHiragana(char); else out.push({ kana: toHiragana(char) }) }
    else return undefined
  }
  return out
}

/** The kana for each character of the word (a kana character stands for itself), or undefined when the alignment is uncertain. */
export function alignWordReading(text: string, reading: string): string[] | undefined {
  const chars = [...text.normalize('NFC').trim()]
  const parts = segments(chars.join(''))
  const sounds = toHiragana(reading.normalize('NFC').replace(/[\s・]/gu, ''))
  const rc = [...sounds]
  if (!parts || !parts.length || !rc.length || !rc.every(char => KANA.test(char))) return undefined
  const found: string[][] = []
  const walk = (at: number, p: number, acc: string[]): void => {
    if (found.length > 1) return
    if (at === parts.length) { if (p === rc.length) found.push(acc); return }
    const part = parts[at]
    if ('kana' in part) {
      const literal = [...part.kana]
      if (rc.slice(p, p + literal.length).join('') === part.kana) walk(at + 1, p + literal.length, [...acc, ...literal])
      return
    }
    const count = part.kanji.length
    for (let end = p + 1; end <= rc.length; end++) {
      const piece = rc.slice(p, end).join('')
      let split: string[] | undefined
      if (count === 1) split = [piece]
      else {
        const units = kanaSounds(piece)
        if (units.length === count * 2) split = part.kanji.map((_, k) => units.slice(k * 2, k * 2 + 2).join(''))
      }
      if (split) walk(at + 1, end, [...acc, ...split])
    }
  }
  walk(0, 0, [])
  return found.length === 1 ? found[0] : undefined
}

/** How a character is read within a word: undefined when the alignment is uncertain, or when the character stands for different sounds in it. */
export function characterReadingIn(character: string, text: string, reading: string): string | undefined {
  const aligned = alignWordReading(text, reading)
  const chars = [...text.normalize('NFC').trim()]
  if (!aligned || aligned.length !== chars.length) return undefined
  const sounds = new Set(chars.flatMap((char, at) => char === character ? [aligned[at]] : []))
  return sounds.size === 1 ? [...sounds][0] : undefined
}
