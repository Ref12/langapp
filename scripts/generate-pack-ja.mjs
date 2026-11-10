// Writes the Japanese language pack's data (src/data/packs/ja) from the authoring data under curriculum/japanese:
//   parallel/entries.yaml + zh-lessons.yaml + the imported JLPT references (read through scripts/parallel-lessons-files.mjs), authoring/pack-glosses.json (short glosses),
//   authoring/pack-labels.json (the label registry: id -> lb, only ever appended to).
// Nothing is read from src/data/parallel or src/core/parallel, and no Chinese field (zh, senses) goes into the pack.
// (No npm script: package.json is hashed into public/characters/chinese/derived-source.generated.zip, so editing it makes characters:check fail and public/ is off limits in this step.)
// Usage: node scripts/generate-pack-ja.mjs [--check] [--root DIR]
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyseForms, entryIndex, loadReferences, readParallel, refreshReadability, root as defaultRoot, writeAtomic } from './parallel-lessons-files.mjs'

export const PACK_DIR = 'src/data/packs/ja'
export const REGISTRY_FILE = 'curriculum/japanese/authoring/pack-labels.json'
export const GLOSSES_FILE = 'curriculum/japanese/authoring/pack-glosses.json'
export const GROUP_PREFIX = 'ja-lesson-'
export const ALIGNMENT = 'lessons-1'
const LABEL = /^[a-z][a-z0-9]*(?:--?[a-z0-9]+)*$/
const MAX_EXAMPLES = 3

// ---- romanisation (modified Hepburn, ASCII only; ー repeats the vowel, long vowels are written as typed) ----
const HIRA = 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔ'
const ROMA = 'a|a|i|i|u|u|e|e|o|o|ka|ga|ki|gi|ku|gu|ke|ge|ko|go|sa|za|shi|ji|su|zu|se|ze|so|zo|ta|da|chi|ji|*|tsu|zu|te|de|to|do|na|ni|nu|ne|no|ha|ba|pa|hi|bi|pi|fu|bu|pu|he|be|pe|ho|bo|po|ma|mi|mu|me|mo|ya|ya|yu|yu|yo|yo|ra|ri|ru|re|ro|wa|wa|i|e|o|n|vu'.split('|')
const SINGLE = Object.fromEntries([...HIRA].map((ch, at) => [ch, ROMA[at]]))
const SMALL_VOWEL = { 'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o' }
const SMALL_Y = { 'ゃ': 'a', 'ゅ': 'u', 'ょ': 'o' }
const DIGRAPH_EXTRA = { 'しぇ': 'she', 'じぇ': 'je', 'ちぇ': 'che', 'てぃ': 'ti', 'でぃ': 'di', 'とぅ': 'tu', 'どぅ': 'du', 'ふぁ': 'fa', 'ふぃ': 'fi', 'ふぇ': 'fe', 'ふぉ': 'fo', 'うぃ': 'wi', 'うぇ': 'we', 'うぉ': 'wo', 'つぁ': 'tsa', 'つぃ': 'tsi', 'つぇ': 'tse', 'つぉ': 'tso', 'ゔぁ': 'va', 'ゔぃ': 'vi', 'ゔぇ': 've', 'ゔぉ': 'vo', 'いぇ': 'ye', 'でゅ': 'dyu', 'てゅ': 'tyu', 'ふゅ': 'fyu' }
const YOON_BASE = { 'き': 'ky', 'ぎ': 'gy', 'し': 'sh', 'じ': 'j', 'ち': 'ch', 'ぢ': 'j', 'に': 'ny', 'ひ': 'hy', 'び': 'by', 'ぴ': 'py', 'み': 'my', 'り': 'ry', 'ゔ': 'vy' }
export const toHiragana = text => String(text).replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
export function romaji(kana) {
  const text = toHiragana(kana)
  const out = []
  let pendingSokuon = false
  for (let at = 0; at < text.length; at++) {
    const ch = text[at], next = text[at + 1]
    let piece
    if (ch === 'ー') { const last = out.join('').match(/[aiueo]$/); piece = last ? last[0] : ''; }
    else if (ch === 'っ') { pendingSokuon = true; continue }
    else if (DIGRAPH_EXTRA[ch + next]) { piece = DIGRAPH_EXTRA[ch + next]; at++ }
    else if (YOON_BASE[ch] && SMALL_Y[next]) { piece = YOON_BASE[ch] + SMALL_Y[next]; if (piece === 'shu' || piece === 'sha' || piece === 'sho' || piece === 'cha' || piece === 'chu' || piece === 'cho' || piece === 'ja' || piece === 'ju' || piece === 'jo') { /* already plain */ } at++ }
    else if (SINGLE[ch] && SINGLE[ch] !== '*') piece = SINGLE[ch]
    else if (/[a-z0-9]/i.test(ch)) piece = ch.toLowerCase()
    else piece = '-'
    if (pendingSokuon && piece && piece !== '-') piece = (piece.startsWith('ch') ? 't' : piece[0]) + piece
    pendingSokuon = false
    out.push(piece)
  }
  return out.join('')
}
const STOP = new Set(['to', 'a', 'an', 'the', 'be', 'of', 'one', 'in', 'on', 'for', 'and', 'or', 'with', 'is', 'are', 'your', 'my'])
function glossWord(text) {
  const clean = String(text).toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  for (const part of clean.split(/[;,|/]/)) {
    const words = part.match(/[a-z0-9]+/g) ?? []
    const word = words.find(w => !STOP.has(w))
    if (word) return word
  }
  return (clean.match(/[a-z0-9]+/g) ?? [])[0] ?? 'x'
}
const GRAMMAR_WORDS = [['形容詞', 'adj'], ['動詞', 'v'], ['助数詞', 'counter'], ['疑問詞', 'wh'], ['普通形', 'plain'], ['時間', 'time'], ['場所', 'place'], ['乗り物', 'vehicle'], ['主語', 'subj'], ['語幹', 'stem'], ['辞書形', 'dict'], ['可能形', 'potential'], ['ない形', 'nai'], ['曜日', 'weekday'], ['数', 'num'], ['文', 's'], ['人', 'person']]
function grammarSlug(pattern) {
  let rest = pattern, out = '', prev = ''
  while (rest.length) {
    const hit = GRAMMAR_WORDS.find(([kanji]) => rest.startsWith(kanji))
    if (hit) { out += '-' + hit[1] + '-'; rest = rest.slice(hit[0].length); continue }
    const ch = rest[0]; rest = rest.slice(1)
    const particle = { 'は': 'wa', 'を': 'o', 'へ': 'e' }[ch]
    if (/[\u3040-\u30ff]/.test(ch)) out += (/[a-z0-9]$/.test(out) && !/[\u3040-\u30ff]/.test(prev) ? '-' : '') + (particle ?? romaji(ch))
    else if (/[a-z0-9]/i.test(ch)) out += (/[a-z0-9]$/.test(out) && /[\u3040-\u30ff]/.test(prev) ? '-' : '') + ch.toLowerCase()
    else out += '-'
    prev = ch
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '')
}
const clean = slug => slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')

/** Issues the label of every id: the registered one, else readingSlug--glossWord (made unique with -2, -3 ... after the first), appended to the registry. */
export function issueLabels(kind, items, registry) {
  const known = registry[kind] ?? {}
  const taken = new Set(Object.values(known))
  const labels = {}, added = {}
  for (const item of items) {
    if (known[item.id]) { labels[item.id] = known[item.id]; continue }
    let slug = clean(item.slug)
    if (!/^[a-z]/.test(slug)) slug = slug ? 'x' + slug : 'x'
    let label = slug + '--' + clean(glossWord(item.gloss)), n = 1
    const base = label
    while (taken.has(label)) label = base + '-' + (++n)
    if (!LABEL.test(label)) throw new Error('Label "' + label + '" for ' + item.id + ' does not satisfy unitLabelSchema.')
    taken.add(label)
    labels[item.id] = label
    added[item.id] = label
  }
  return { labels, added }
}

// ---- reading alignment: the phrase reading split over its tokens ----
const PUNCTUATION = /^[\p{P}\p{S}\s]+$/u
const KANA = /^[\u3040-\u30ffー]+$/
const hasKana = ch => /[\u3040-\u30ffー]/.test(ch)
function splitReading(tokens, reading, known) {
  const memo = new Map()
  const walk = (at, pos) => {
    if (at === tokens.length) return pos === reading.length ? [] : null
    const key = at + ':' + pos
    if (memo.has(key)) return memo.get(key)
    const t = tokens[at].t
    let found = null
    const exact = PUNCTUATION.test(t) ? [t, ''] : [...new Set([known[at], KANA.test(t) ? t : undefined, KANA.test(t) ? toHiragana(t) : undefined].filter(Boolean))]
    for (const candidate of exact) {
      if (reading.startsWith(candidate, pos)) { const tail = walk(at + 1, pos + candidate.length); if (tail) { found = [candidate, ...tail]; break } }
    }
    if (!found && !KANA.test(t)) {
      const lead = [...t].findIndex(ch => !hasKana(ch)), head = lead > 0 ? t.slice(0, lead) : ''
      const tail = [...t].reverse().findIndex(ch => !hasKana(ch)), foot = tail > 0 ? t.slice(t.length - tail) : ''
      for (let length = 1; pos + length <= reading.length && !found; length++) {
        const piece = reading.slice(pos, pos + length)
        if ((head && !toHiragana(piece).startsWith(toHiragana(head))) || (foot && !toHiragana(piece).endsWith(toHiragana(foot)))) continue
        const rest = walk(at + 1, pos + length)
        if (rest) found = [piece, ...rest]
      }
    }
    memo.set(key, found)
    return found
  }
  return walk(0, 0)
}

function readJson(file, fallback) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback }

/** The whole pack in memory: { files: Map(relative path -> text), report }. */
export function buildJaPack(base = defaultRoot) {
  const data = readParallel('ja', base)
  const references = loadReferences('ja', base)
  const lessons = [...data.lessons.lessons].sort((a, b) => a.number - b.number)
  const taught = refreshReadability(lessons)
  const forms = analyseForms('ja', lessons, taught, data, references, base) // also sets each phrase's readyAt (irregular form items included)
  const index = entryIndex(references, data.entries)
  const glosses = readJson(join(base, GLOSSES_FILE), { glosses: {} }).glosses
  const registry = readJson(join(base, REGISTRY_FILE), { version: 1, vocabulary: {}, grammar: {} })

  // vocabulary and grammar, in lesson order
  const wordIds = [], seenWords = new Set(), grammarIds = [], seenGrammar = new Set()
  const addWord = id => { if (id && !seenWords.has(id)) { seenWords.add(id); wordIds.push(id) } }
  const addGrammar = id => { if (id && !seenGrammar.has(id)) { seenGrammar.add(id); grammarIds.push(id) } }
  const lessonUnits = new Map()
  const demonstrated = new Set(lessons.flatMap(lesson => (lesson.phrases ?? []).flatMap(phrase => phrase.grammar ?? [])))
  const skippedGrammar = new Set()
  for (const lesson of lessons) {
    const w = [], g = []
    for (const word of lesson.words ?? []) { if (!seenWords.has(word.entry)) w.push(word.entry); addWord(word.entry) }
    for (const id of lesson.grammar_taught ?? []) { if (!demonstrated.has(id)) { skippedGrammar.add(id); continue } if (!seenGrammar.has(id)) g.push(id); addGrammar(id) }
    lessonUnits.set(lesson.number, { w, g })
  }
  for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) { (phrase.words ?? []).forEach(addWord); (phrase.grammar ?? []).forEach(addGrammar) }
  const lateWords = wordIds.filter(id => !lessons.some(l => (l.words ?? []).some(w => w.entry === id)))
  const lateGrammar = grammarIds.filter(id => !lessons.some(l => (l.grammar_taught ?? []).includes(id)))
  if (lateWords.length || lateGrammar.length) throw new Error('Phrases use units no lesson teaches: ' + [...lateWords, ...lateGrammar].join(', '))

  const glossFor = id => {
    const entry = index.vocabulary.get(id)
    if (!entry) throw new Error('No definition for the word entry ' + id)
    return glosses[id] ?? entry.english.split(' | ')[0].replace(/^1\.\s*/, '')
  }
  const vocabLabels = issueLabels('vocabulary', wordIds.map(id => { const e = index.vocabulary.get(id); return { id, slug: romaji(e.reading || e.target), gloss: glossFor(id) } }), registry)
  const grammarLabels = issueLabels('grammar', grammarIds.map(id => {
    const e = index.grammar.get(id)
    if (!e) throw new Error('No definition for the grammar entry ' + id)
    return { id, slug: grammarSlug(e.pattern) || id.replace(/^ja-/, ''), gloss: e.english }
  }), registry)
  for (const kind of ['vocabulary', 'grammar']) for (const id of Object.keys(registry[kind] ?? {})) if (!(kind === 'vocabulary' ? seenWords : seenGrammar).has(id)) throw new Error('The registered label of ' + kind + ' ' + id + ' (' + registry[kind][id] + ') would disappear: the entry is no longer in the pack. Entries are never removed.')
  const word = id => vocabLabels.labels[id], pattern = id => grammarLabels.labels[id]

  // phrase tokens as example segments
  let fallbacks = 0
  const tokensOf = (lesson, phrase) => phrase.tokens.map((token, at) => {
    const tag = forms.tags.get(lesson.number + ':' + phrase.id + ':' + at)
    return tag ? { ...token, form: tag.form, ...(tag.span ? { span: tag.span } : {}) } : token
  })
  const phraseData = []
  for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) {
    const tokens = tokensOf(lesson, phrase)
    if (tokens.map(t => t.t).join('') !== phrase.text) throw new Error('Phrase ' + phrase.id + ': the tokens do not add up to the text')
    const reading = phrase.reading ?? phrase.text
    const known = tokens.map(t => t.w ? index.vocabulary.get(t.w)?.reading || undefined : undefined).map((r, at) => tokens[at].w && index.vocabulary.get(tokens[at].w).target !== tokens[at].t ? undefined : r)
    const parts = splitReading(tokens, reading, known)
    if (!parts) throw new Error('Phrase ' + phrase.id + ': the reading ' + reading + ' cannot be split over the tokens')
    const segments = tokens.map((token, at) => {
      if (!token.w && !token.g) {
        if (!PUNCTUATION.test(token.t)) throw new Error('Phrase ' + phrase.id + ': token "' + token.t + '" is neither a word, a grammar unit nor punctuation')
        parts[at] = token.t
        return { punctuation: token.t }
      }
      const tags = { ...(token.form ? { form: token.form } : {}), ...(token.span ? { span: token.span } : {}) }
      if (token.w) {
        const entry = index.vocabulary.get(token.w)
        const own = token.t !== entry.target, pr = entry.reading || entry.target
        return { word: word(token.w), ...(own ? { text: token.t } : {}), ...(own || parts[at] !== pr ? { reading: parts[at] } : {}), ...tags }
      }
      return { grammar: pattern(token.g), text: token.t, reading: parts[at], ...tags }
    })
    phraseData.push({ lesson: lesson.number, phrase, segments, py: parts.join(''), words: [...new Set(phrase.words ?? [])].map(word), grammar: [...new Set(phrase.grammar ?? [])].map(pattern), readyAt: phrase.readyAt })
  }
  const byId = new Map(phraseData.map(p => [p.phrase.id, p]))

  // the example of each group: the lesson's own phrases that need nothing later, chosen to cover the lesson's new units, shortest first
  const exampleOf = p => ({ id: 'phrase-' + p.phrase.id, segments: p.segments, translation: p.phrase.en, grammar: p.grammar })
  const groups = lessons.map(lesson => {
    const units = lessonUnits.get(lesson.number)
    const newUnits = new Set([...units.w.map(id => 'w:' + id), ...units.g.map(id => 'g:' + id)])
    const own = phraseData.filter(p => p.lesson === lesson.number)
    const usable = own.filter(p => p.readyAt <= lesson.number)
    let pool = usable.length >= 2 ? usable : own
    if (pool.length < 2) pool = [...pool, ...phraseData.filter(p => p.lesson < lesson.number && p.readyAt <= lesson.number).reverse()]
    const covers = p => new Set([...(p.phrase.words ?? []).map(id => 'w:' + id), ...(p.phrase.grammar ?? []).map(id => 'g:' + id)].filter(u => newUnits.has(u)))
    const picked = [], uncovered = new Set(newUnits)
    while (picked.length < MAX_EXAMPLES) {
      const choices = pool.filter(p => !picked.includes(p)).map(p => ({ p, gain: [...covers(p)].filter(u => uncovered.has(u)).length }))
        .sort((a, b) => b.gain - a.gain || a.p.phrase.text.length - b.p.phrase.text.length || a.p.phrase.id - b.p.phrase.id)
      if (!choices.length || (picked.length >= 2 && choices[0].gain === 0)) break
      picked.push(choices[0].p)
      for (const u of covers(choices[0].p)) uncovered.delete(u)
    }
    return {
      id: GROUP_PREFIX + String(lesson.number).padStart(4, '0'),
      units: [...units.w.map(id => ({ kind: 'vocabulary', ref: word(id) })), ...units.g.map(id => ({ kind: 'grammar', ref: pattern(id) }))],
      examples: picked.map(exampleOf),
    }
  })

  // one demonstrating phrase per grammar record: the earliest-ready, then shortest phrase tagged with it
  const grammar = grammarIds.map(id => {
    const e = index.grammar.get(id)
    const tagged = phraseData.filter(p => (p.phrase.grammar ?? []).includes(id)).sort((a, b) => a.readyAt - b.readyAt || a.phrase.text.length - b.phrase.text.length || a.phrase.id - b.phrase.id)
    if (!tagged.length) throw new Error('No phrase demonstrates the grammar unit ' + id + ' (' + e.pattern + ')')
    const { id: _id, ...ex } = exampleOf(tagged[0])
    return { id, pt: e.pattern, pr: e.pattern, ds: e.english, lb: pattern(id), ex }
  })
  const vocabulary = wordIds.map(id => { const e = index.vocabulary.get(id); return { id, ch: e.target, pr: e.reading || e.target, ds: glossFor(id), lb: word(id) } })

  const band = { schemaVersion: 1, band: '1', alignment: ALIGNMENT, vocabulary, grammar, groups }
  const catalogIndex = { schemaVersion: 1, bands: [{ band: '1', alignment: ALIGNMENT, vocabulary: vocabulary.length, grammar: grammar.length, groups: groups.length }] }
  const phrases = phraseData.map(p => ({
    id: p.phrase.id, zh: p.phrase.text, py: p.py, en: p.phrase.en, words: p.words, ...(p.grammar.length ? { grammar: p.grammar } : {}),
    source: p.phrase.source, checked: p.phrase.checked === true, readyAt: p.readyAt, tokens: p.segments,
  }))
  const perWord = {}
  for (const p of phrases) for (const w of p.words) perWord[w] = (perWord[w] ?? 0) + 1
  const phraseIndex = { schemaVersion: 1, bands: { 1: { count: phrases.length, words: Object.fromEntries(Object.entries(perWord).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) } } }
  const newRegistry = { version: 1, vocabulary: { ...(registry.vocabulary ?? {}), ...vocabLabels.added }, grammar: { ...(registry.grammar ?? {}), ...grammarLabels.added } }
  const sorted = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  newRegistry.vocabulary = sorted(newRegistry.vocabulary); newRegistry.grammar = sorted(newRegistry.grammar)

  const json = value => JSON.stringify(value) + '\n'
  const files = new Map([
    [PACK_DIR + '/index.generated.json', json(catalogIndex)],
    [PACK_DIR + '/band-1.generated.json', json(band)],
    [PACK_DIR + '/phrases-index.json', json(phraseIndex)],
    [PACK_DIR + '/phrases-band-1.json', json({ schemaVersion: 2, band: '1', phrases })],
    [REGISTRY_FILE, JSON.stringify(newRegistry, null, 1) + '\n'],
  ])
  const sizes = groups.map(g => g.units.length)
  return { files, band, phrases, report: { vocabulary: vocabulary.length, grammar: grammar.length, groups: groups.length, phrases: phrases.length, unitsPerGroup: [Math.min(...sizes), Math.max(...sizes)], skippedGrammar: [...skippedGrammar].sort(), examplesPerGroup: [Math.min(...groups.map(g => g.examples.length)), Math.max(...groups.map(g => g.examples.length))], newLabels: Object.keys(vocabLabels.added).length + Object.keys(grammarLabels.added).length, fallbacks } }
}

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check')
  const at = argv.indexOf('--root')
  const base = at >= 0 ? resolve(argv[at + 1]) : defaultRoot
  const unknown = argv.filter((arg, index) => arg !== '--check' && arg !== '--root' && argv[index - 1] !== '--root')
  if (unknown.length) throw new Error('Usage: node scripts/generate-pack-ja.mjs [--check] [--root DIR]')
  const { files, report } = buildJaPack(base)
  const stale = []
  for (const [path, text] of files) {
    const file = join(base, path)
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue
    stale.push(path)
    if (!check) writeAtomic(file, text)
  }
  console.log('Japanese pack data ' + (check ? 'checked' : 'generated') + ': ' + JSON.stringify(report))
  if (check && stale.length) { for (const path of stale) console.error('Stale Japanese pack data: ' + relative(base, join(base, path))); throw new Error('Run "node scripts/generate-pack-ja.mjs" to regenerate the Japanese pack data.') }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
