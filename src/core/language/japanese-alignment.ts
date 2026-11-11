// Which kana of a Japanese word's reading belong to which of its characters (学生 がくせい: 学 がく, 生 せい), built from the word's text, its reading and the kanji reading table (KANJIDIC2, kanji-readings.generated.json).
//   Kana in the text (okurigana, particles inside the word) are matched literally against the reading, hiragana and katakana alike (食べる たべる: 食 = た, べる literal).
//   A kanji takes one of its table readings (on'yomi, or the stem of a kun'yomi) with the usual sound changes at a join: rendaku of the first sound after the first kanji of a run (か→が, さ→ざ, た→だ, は→ば/ぱ…, 国 こく→ごく)
//   and gemination of a final つ/く/き/ち before a か, さ, た or ぱ sound (学校 がく→がっ+こう).
//   The split is accepted only when exactly one fits. Jukujikun (今日 きょう, 大人 おとな, 一人 ひとり, 明日, 上手, 下手) fit none, so the alignment is uncertain (undefined) and callers fall back to the whole word.
//   A lone kanji with no kana beside it takes the whole reading. Without the table (a build that has not loaded it) only that case is certain.
//   々 repeats the kanji before it.

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


/** The kanji reading table: kanji -> [on, kun] in hiragana (src/data/packs/ja/kanji-readings.generated.json). Set by the Japanese build when it has loaded the file. */
export type KanjiReadingTable = Readonly<Record<string, readonly [readonly string[], readonly string[]]>>
let table: KanjiReadingTable | undefined
export function setKanjiReadings(next: KanjiReadingTable | undefined): void { table = next }
export const hasKanjiReadings = (): boolean => table !== undefined
/** The on'yomi and kun'yomi (stem) of a kanji, if the table has it. */
export const kanjiReadingsOf = (kanji: string): { on: readonly string[]; kun: readonly string[] } | undefined => { const entry = table?.[kanji]; return entry && { on: entry[0], kun: entry[1] } }

const VOICED: Record<string, string> = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど' }
const HA = 'はひふへほ'
const BA = 'ばびぶべぼ'
const PA = 'ぱぴぷぺぽ'
const HARD = new Set([...'かきくけこさしすせそたちつてとはひふへほ'])
const GEMINATES = new Set([...'つくきち'])

/** The ways a reading can sound at a join: as it is, with its first sound voiced (rendaku, not for the first kanji of a run), and with its last sound doubled (っ, only when another kanji follows and its sound is hard). */
function variants(reading: string, first: boolean, last: boolean): string[] {
  const out = new Set<string>([reading])
  const chars = [...reading]
  if (!first) {
    const initial = chars[0]
    if (VOICED[initial]) out.add(VOICED[initial] + chars.slice(1).join(''))
    const at = HA.indexOf(initial)
    if (at >= 0) { out.add(BA[at] + chars.slice(1).join('')); out.add(PA[at] + chars.slice(1).join('')) }
  }
  if (!last && chars.length > 1 && GEMINATES.has(chars[chars.length - 1])) for (const form of [...out]) out.add(form.slice(0, -1) + 'っ')
  return [...out]
}
/** Whether a reading begins with a sound that follows a geminated っ. */
const startsHard = (reading: string): boolean => HARD.has(reading[0]) || 'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ'.includes(reading[0])

type Segment = { kanji: string[] } | { kana: string }

function segments(text: string): Segment[] | undefined {
  const out: Segment[] = []
  let previous = ''
  for (const char of text) {
    if (HAN.test(char)) {
      const kanji = char === '\u3005' ? previous : char
      if (!kanji) return undefined
      previous = kanji
      const last = out[out.length - 1]; if (last && 'kanji' in last) last.kanji.push(kanji); else out.push({ kanji: [kanji] })
    }
    else if (KANA.test(char)) { previous = ''; const last = out[out.length - 1]; if (last && 'kana' in last) last.kana += toHiragana(char); else out.push({ kana: toHiragana(char) }) }
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
  if (parts.length === 1 && 'kanji' in parts[0] && parts[0].kanji.length === 1) return [rc.join('')]
  if (!table) return undefined
  const found = new Map<string, string[]>()
  const walk = (at: number, p: number, acc: string[]): void => {
    if (found.size > 1) return
    if (at === parts.length) { if (p === rc.length) found.set(acc.join('\u0000'), acc); return }
    const part = parts[at]
    if ('kana' in part) {
      const literal = [...part.kana]
      if (rc.slice(p, p + literal.length).join('') === part.kana) walk(at + 1, p + literal.length, [...acc, ...literal])
      return
    }
    const run = (k: number, from: number, got: string[]): void => {
      if (found.size > 1) return
      if (k === part.kanji.length) { walk(at + 1, from, [...acc, ...got]); return }
      const entry = table?.[part.kanji[k]]
      if (!entry) return
      const options = new Set<string>()
      for (const base of [...entry[0], ...entry[1]]) for (const form of variants(base, k === 0, k === part.kanji.length - 1)) options.add(form)
      for (const option of options) {
        const units = [...option]
        if (rc.slice(from, from + units.length).join('') !== option) continue
        if (option.endsWith('っ') && k < part.kanji.length - 1) {
          const next = table?.[part.kanji[k + 1]]
          const start = rc[from + units.length]
          if (!next || !start || !startsHard(start) && !PA.includes(start)) continue
        }
        run(k + 1, from + units.length, [...got, option])
      }
    }
    run(0, p, [])
  }
  walk(0, 0, [])
  return found.size === 1 ? [...found.values()][0] : undefined
}

/** How a character is read within a word: undefined when the alignment is uncertain, or when the character stands for different sounds in it. */
export function characterReadingIn(character: string, text: string, reading: string): string | undefined {
  const aligned = alignWordReading(text, reading)
  const chars = [...text.normalize('NFC').trim()]
  if (!aligned || aligned.length !== chars.length) return undefined
  const sounds = new Set(chars.flatMap((char, at) => char === character ? [aligned[at]] : []))
  return sounds.size === 1 ? [...sounds][0] : undefined
}
