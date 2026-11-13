// Builds src/core/language/data/zh-polyphones.generated.json: what the Chinese speech step (src/core/language/speech-chinese.ts) substitutes.
//
//   node scripts/build-zh-polyphones.mjs          write the file
//   node scripts/build-zh-polyphones.mjs --check  fail when the file is out of date
//
// Offline, from the app's own data: the catalog words (src/data/v2, with their pinyin) and the shipped phrase bank (src/data/phrases, pinyin aligned to the characters).
//  - A polyphonic character is one the data reads two or more ways that differ in syllable or tone (a neutral tone is not a way of its own). SKIP below lists function words the voices handle well.
//  - For each reading the data shows, the substitute is the most common character (lowest HSK band, then most uses) that has exactly that one reading in pinyin-pro (the app's pinyin dependency,
//    which lists every reading of a character) and is not polyphonic itself. PREFER names the owner's examples; one is used when it passes the same test.
//  - words: the multi-character catalog words that contain a polyphonic character, with their reading, for text that comes without readings (the band order decides when a word has two).
import { readFileSync, writeFileSync } from 'node:fs'
import { pinyin } from 'pinyin-pro'

const SKIP = new Set([...'了的地得着么都和一不'])
const PREFER = { 'hái': '孩', 'huán': '环', 'háng': '杭', 'xíng': '形', 'cháng': '常', 'zhǎng': '掌', 'zhòng': '众', 'chóng': '虫', 'lè': '勒', 'yuè': '月' }
// Words the catalog does not list but whose reading is fixed (a character that is only read one way in them).
const EXTRA_WORDS = { '还书': 'huán shū', '还钱': 'huán qián', '还给': 'huán gěi', '还款': 'huán kuǎn', '归还': 'guī huán', '偿还': 'cháng huán', '行人': 'xíng rén', '银行': 'yín háng', '步行': 'bù xíng' }
const HAN = /\p{Script=Han}/u
const root = new URL('../', import.meta.url)
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const TONES = { '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 }
const syllableKey = text => {
  const s = text.normalize('NFD').toLowerCase()
  let tone = 0
  for (const mark of s) if (TONES[mark]) tone = TONES[mark]
  return { key: s.normalize('NFC'), tone }
}
const syllablesOf = text => text.trim().split(/\s+/).filter(Boolean).map(s => s.normalize('NFC').toLowerCase())
const valid = s => /^[a-zü\u0300-\u036f]+$/u.test(s.normalize('NFD').replace(/\u0308/g, 'u')) && s.length < 9

const uses = new Map() // char -> Map(syllable -> count)
const bandOf = new Map() // char -> lowest band it is in a word of
const words = new Map() // word -> [pinyin by band order...]
const note = (char, syllable, band) => {
  const bySyllable = uses.get(char) ?? new Map()
  uses.set(char, bySyllable)
  bySyllable.set(syllable, (bySyllable.get(syllable) ?? 0) + 1)
  if (!bandOf.has(char) || bandOf.get(char) > band) bandOf.set(char, band)
}
const align = (text, pinyinText, band, intoWords) => {
  const chars = [...text].filter(c => HAN.test(c))
  const syllables = syllablesOf(pinyinText)
  if (chars.length !== syllables.length || !syllables.every(valid)) return
  chars.forEach((char, at) => note(char, syllables[at], band))
  if (intoWords && chars.length > 1 && chars.length === [...text].length) { const list = words.get(text) ?? []; words.set(text, list); if (!list.includes(syllables.join(' '))) list.push(syllables.join(' ')) }
}
for (let band = 1; band <= 6; band++) {
  for (const entry of read('src/data/v2/hsk-' + band + '.generated.json').vocabulary) for (const reading of entry.pr.split(/\s*(?:[/;,，、]|\bor\b)\s*/)) align(entry.ch, reading, band, true)
  for (const phrase of read('src/data/phrases/hsk-' + band + '.json').phrases) align(phrase.zh, phrase.py, band, false)
}

const noToneKey = s => syllableKey(s)
const polyphones = new Map() // char -> syllables the data reads it as (tone 1-4 only)
for (const [char, bySyllable] of uses) {
  if (SKIP.has(char)) continue
  const readings = [...bySyllable.keys()].filter(s => noToneKey(s).tone !== 0)
  if (new Set(readings).size >= 2) polyphones.set(char, readings)
}
const proReadings = char => [...new Set(pinyin(char, { multiple: true, type: 'array', toneType: 'symbol' }).map(s => s.normalize('NFC').toLowerCase()))]
const total = char => [...(uses.get(char)?.values() ?? [])].reduce((a, b) => a + b, 0)

const candidates = [...uses.keys()].filter(c => !polyphones.has(c) && !SKIP.has(c) && bandOf.has(c) && proReadings(c).length === 1 && uses.get(c).size === 1)
const bySyllable = new Map()
for (const c of candidates) { const s = proReadings(c)[0]; if (noToneKey(s).tone === 0) continue; const list = bySyllable.get(s) ?? []; bySyllable.set(s, list); list.push(c) }
for (const list of bySyllable.values()) list.sort((a, b) => bandOf.get(a) - bandOf.get(b) || total(b) - total(a) || a.localeCompare(b, 'zh'))

const substitutes = {}
const missing = []
for (const [char, readings] of [...polyphones].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
  for (const syllable of [...new Set(readings)].sort()) {
    const options = bySyllable.get(syllable) ?? []
    const preferred = PREFER[syllable] && options.includes(PREFER[syllable]) ? PREFER[syllable] : undefined
    const pick = preferred ?? (PREFER[syllable] && proReadings(PREFER[syllable]).length === 1 && !polyphones.has(PREFER[syllable]) ? PREFER[syllable] : undefined) ?? options[0]
    if (pick) (substitutes[char] ??= {})[syllable] = pick
    else missing.push(char + ' ' + syllable)
  }
}
const table = {}
for (const [char, entry] of Object.entries(substitutes)) table[char] = entry
const wordTable = {}
for (const [word, list] of [...words, ...Object.entries(EXTRA_WORDS).map(([w, p]) => [w, [p]])].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
  if (words.has(word) && EXTRA_WORDS[word]) continue
  if (![...word].some(c => table[c])) continue
  wordTable[word] = list[0]
}
for (const [word, pinyinText] of Object.entries(EXTRA_WORDS)) if ([...word].some(c => table[c])) wordTable[word] = pinyinText
const sortedWords = Object.fromEntries(Object.entries(wordTable).sort((a, b) => a[0].localeCompare(b[0], 'zh')))
const output = JSON.stringify({ schemaVersion: 1, skipped: [...SKIP].join(''), substitutes: table, words: sortedWords, withoutSubstitute: missing }, null, 1) + '\n'
const target = new URL('src/core/language/data/zh-polyphones.generated.json', root)
if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(target, 'utf8') } catch { /* missing */ }
  if (current !== output) { console.error('zh-polyphones.generated.json is out of date: run node scripts/build-zh-polyphones.mjs'); process.exit(1) }
} else writeFileSync(target, output)
console.log('polyphonic characters ' + Object.keys(table).length + ', substitutes ' + Object.values(table).reduce((n, e) => n + Object.keys(e).length, 0) + ', words ' + Object.keys(sortedWords).length + ', without substitute ' + missing.length)
