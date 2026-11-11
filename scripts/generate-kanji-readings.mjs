// Writes src/data/packs/ja/kanji-readings.generated.json: the on'yomi and kun'yomi of every kanji the Japanese app ships stroke data for, from KANJIDIC2 (EDRDG; CC-BY-SA 4.0).
//   node scripts/generate-kanji-readings.mjs [path-to-kanjidic2.xml[.gz]]     (no path: downloads https://www.edrdg.org/kanjidic/kanjidic2.xml.gz)
// Each entry is [on, kun]: both in hiragana, in KANJIDIC2's order. A kun'yomi is its stem: the okurigana after "." is dropped (た.べる -> た, おお.きい -> おお) and the affix hyphens too (-び -> び).
// The alignment (src/core/language/japanese-alignment.ts) matches okurigana literally from the word's own text, so only the stem is needed.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const URL_ = 'https://www.edrdg.org/kanjidic/kanjidic2.xml.gz'
const OUT = resolve(root, 'src/data/packs/ja/kanji-readings.generated.json')
// Readings the words use that KANJIDIC2 lists no entry for: 日 is に in 日本 (the whole of its on'yomi ニチ is not said); 父 母 兄 姉 are とう かあ にい ねえ in お父さん, お母さん, お兄さん, お姉さん (the kun'yomi ちち, はは, あに, あね lengthened).
const SUPPLEMENT = { 日: { on: ['に'] }, 父: { on: ['とう'] }, 母: { on: ['かあ'] }, 兄: { on: ['にい'] }, 姉: { on: ['ねえ'] } }

// Affix readings that only make irregular words look regular: 人 -り is the り of 一人 ひとり and 二人 ふたり, which are read as wholes (jukujikun), so it is not taken as a reading of 人; likewise 手 ず (on'yomi ズ) in 上手 じょうず.
const SUPPRESS = { 人: ['り'], 手: ['ず'] }

const arg = process.argv[2]
let raw = arg ? readFileSync(arg) : Buffer.from(await (await fetch(URL_)).arrayBuffer())
const sha256 = createHash('sha256').update(raw).digest('hex')
if (raw[0] === 0x1f && raw[1] === 0x8b) raw = gunzipSync(raw)
const xml = raw.toString('utf8')
const header = key => xml.match(new RegExp('<' + key + '>([^<]*)</' + key + '>'))?.[1]

const toHiragana = text => text.replace(/[\u30a1-\u30f6]/gu, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
const unique = list => [...new Set(list)]
const table = new Map()
for (const block of xml.split('<character>').slice(1)) {
  const literal = block.match(/<literal>([^<]+)<\/literal>/)?.[1]
  if (!literal) continue
  const on = [...block.matchAll(/<reading r_type="ja_on">([^<]+)<\/reading>/g)].map(match => toHiragana(match[1]).replace(/[-.]/g, ''))
  const kun = [...block.matchAll(/<reading r_type="ja_kun">([^<]+)<\/reading>/g)].map(match => match[1].split('.')[0].replace(/-/g, '')).filter(Boolean)
  table.set(literal, [unique(on), unique(kun)])
}

const strokes = JSON.parse(readFileSync(resolve(root, 'public/characters/japanese/index.generated.json'), 'utf8')).characters
const kanji = Object.keys(strokes).filter(char => /\p{Script=Han}/u.test(char) && char !== '\u3005' && char !== '\u3007').sort((a, b) => a.codePointAt(0) - b.codePointAt(0))
const kanjiReadings = {}
const missing = []
for (const char of kanji) {
  const entry = table.get(char)
  if (!entry) { missing.push(char); continue }
  const extra = SUPPLEMENT[char]?.on ?? []
  const keep = reading => !SUPPRESS[char]?.includes(reading)
  kanjiReadings[char] = [unique([...entry[0], ...extra]).filter(keep), entry[1].filter(keep)]
}
if (missing.length) { console.error('Not in KANJIDIC2: ' + missing.join(' ')); process.exitCode = 1 }
const out = {
  schemaVersion: 1,
  source: 'KANJIDIC2 (EDRDG, https://www.edrdg.org/wiki/index.php/KANJIDIC_Project), CC-BY-SA 4.0',
  databaseVersion: header('database_version'),
  sourceSha256: sha256,
  note: 'kanji -> [on, kun], hiragana; a kun is its stem without okurigana.',
  kanji: kanjiReadings,
}
writeFileSync(OUT, JSON.stringify(out) + '\n')
console.log(Object.keys(kanjiReadings).length + ' kanji, ' + (JSON.stringify(out).length) + ' bytes (KANJIDIC2 ' + out.databaseVersion + ')')
