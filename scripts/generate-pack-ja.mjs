// Writes the Japanese language pack's data (src/data/packs/ja) from the authoring data under curriculum/japanese:
//   parallel/entries.yaml + zh-lessons.yaml + the imported JLPT references (read through scripts/parallel-lessons-files.mjs),
//   authoring/pack-glosses.json (short glosses where a lesson row has none), authoring/pack-gloss-overrides.json (glosses written by hand),
//   authoring/pack-pattern-names.json (pattern names the rule in pack-ja-names.mjs cannot make), authoring/pack-forms.json (names of the word forms),
//   authoring/pack-headwords.json (kanji headwords for verbs the source lists in kana, so a built form matches the sentences),
//   authoring/pack-labels.json (the label registry: id -> lb, append-only since the reissue of step 3.2) and authoring/pack-labels-sealed.json (the labels that may never change).
// Nothing is read from src/data/parallel (removed) or the old parallel screens, and no Chinese field (zh, senses) goes into the pack.
// (No npm script: package.json is hashed into public/characters/chinese/derived-source.generated.zip, so editing it makes characters:check fail and public/ is off limits in this step.)
// Usage: node scripts/generate-pack-ja.mjs [--check] [--root DIR]
//        node scripts/generate-pack-ja.mjs --report [FILE]   the content gaps of the lessons (markdown, to FILE or stdout)
//        node scripts/generate-pack-ja.mjs --seal            add the registry's labels to the sealed file (never changes a sealed one)
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { impliedSubject } from '../src/core/language/implied-subject.mjs'
import { createForms } from '../src/core/forms/engine.mjs'
import { loadFormsRules } from './forms-data.mjs'
import { patternNameRule, patternSlug, readingOfName, shortTextRule } from './pack-ja-names.mjs'
import { applyCorrections as applyCorrectionsShared, checkGaps, checkLabels, computeGaps, gapList, gapsMarkdown as gapsMarkdownShared, issueLabels, MAX_GLOSS, readJson, sealText as sealShared, shortGloss, writeFiles } from './pack-shared.mjs'
export { checkGaps, computeGaps, gapList, issueLabels } // the pure parts moved to pack-shared.mjs; the tests of this generator still import them from here
import { analyseForms, entryIndex, loadReferences, readParallel, refreshReadability, root as defaultRoot, writeAtomic } from './parallel-lessons-files.mjs'

export const PACK_DIR = 'src/data/packs/ja'
export const REGISTRY_FILE = 'curriculum/japanese/authoring/pack-labels.json'
export const GLOSSES_FILE = 'curriculum/japanese/authoring/pack-glosses.json'
export const READINGS_FILE = 'curriculum/japanese/authoring/pack-phrase-readings.json'
export const GLOSS_OVERRIDES_FILE = 'curriculum/japanese/authoring/pack-gloss-overrides.json'
export const NAMES_FILE = 'curriculum/japanese/authoring/pack-pattern-names.json'
export const FORMS_FILE = 'curriculum/japanese/authoring/pack-forms.json'
export const HEADWORDS_FILE = 'curriculum/japanese/authoring/pack-headwords.json'
export const CORRECTIONS_FILE = 'curriculum/japanese/authoring/pack-phrase-corrections.json'
export const SHORT_TEXTS_FILE = 'curriculum/japanese/authoring/pack-pattern-short-texts.json'
export const EXPLANATIONS_FILE = 'curriculum/japanese/authoring/pack-pattern-explanations.json'
export const LESSON_CORRECTIONS_FILE = 'curriculum/japanese/authoring/pack-lesson-corrections.json'
export const ADDED_PHRASES_FILE = 'curriculum/japanese/authoring/pack-added-phrases.json'
export const ACCEPTED_GAPS_FILE = 'curriculum/japanese/authoring/pack-accepted-gaps.json'
export const SEALED_FILE = 'curriculum/japanese/authoring/pack-labels-sealed.json'
export const GROUP_PREFIX = 'ja-lesson-'
export const ALIGNMENT = 'lessons-1'
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

// ---- reading alignment: the phrase reading split over its tokens ----
const PUNCTUATION = /^[\p{P}\p{S}\s]+$/u
const KANA = /^[\u3040-\u30ffー]+$/
const hasKana = ch => /[\u3040-\u30ffー]/.test(ch)
function splitReading(tokens, reading, known) {
  // the split with the most tokens read as they are known to read (the entry's reading, a kana token as written), then the shortest pieces for the rest
  const memo = new Map()
  const walk = (at, pos) => {
    if (at === tokens.length) return pos === reading.length ? { score: 0, parts: [] } : null
    const key = at + ':' + pos
    if (memo.has(key)) return memo.get(key)
    const t = tokens[at].t
    let best = null
    const take = (piece, bonus) => {
      const rest = walk(at + 1, pos + piece.length)
      if (rest && (!best || rest.score + bonus > best.score)) best = { score: rest.score + bonus, parts: [piece, ...rest.parts] }
    }
    const exact = PUNCTUATION.test(t) ? [t, ''] : [...new Set([known[at], KANA.test(t) ? t : undefined, KANA.test(t) ? toHiragana(t) : undefined].flat().filter(Boolean))]
    for (const candidate of exact) if (reading.startsWith(candidate, pos)) take(candidate, 1)
    if (!KANA.test(t)) {
      const lead = [...t].findIndex(ch => !hasKana(ch)), head = lead > 0 ? t.slice(0, lead) : ''
      const tail = [...t].reverse().findIndex(ch => !hasKana(ch)), foot = tail > 0 ? t.slice(t.length - tail) : ''
      for (let length = 1; pos + length <= reading.length; length++) {
        const piece = reading.slice(pos, pos + length)
        if ((head && !toHiragana(piece).startsWith(toHiragana(head))) || (foot && !toHiragana(piece).endsWith(toHiragana(foot)))) continue
        take(piece, 0)
      }
    }
    memo.set(key, best)
    return best
  }
  return walk(0, 0)?.parts ?? null
}


/** The corrections of the lesson source (see pack-shared.mjs), with this pack's file names in the messages. */
export const applyCorrections = (lessons, corrections) => applyCorrectionsShared(lessons, corrections, { files: { ADDED_PHRASES_FILE, CORRECTIONS_FILE, LESSON_CORRECTIONS_FILE }, language: 'Japanese', reading: true })



/** The kinds of word a form applies to, by class group (copula: the な-adjectives and the nouns). */
const kindsOfGroup = group => group === 'copula' ? ['na-adj', 'noun'] : [group]
/** The kind of word a class is (verb, i-adj, na-adj, noun). */
const kindOfClass = (rules, cls) => { const group = rules.classes[cls]?.group; return group === 'copula' ? cls : group }
/**
 * THE TOKEN RULE. A form is one token with its word when the word itself changes or a bound ending is attached to it (the whole surface is one segment); it stays two tokens when the word is
 * unchanged and what follows is a separate word. By kind: a verb joins in every form but the dictionary form (ます, ません, ました, ませんでした, ましょう, たい, たいです, て, てください, ています, ない…, the potential);
 * an い-adjective joins in every form but the plain one (寒い) and the polite one (寒い + です), because くない, かった, く, くて, すぎます change the word; a noun or な-adjective never joins (学生 + です, 静か + な)
 * except with すぎます, which is a bound ending.
 */
export const joinsWord = (kind, formId) => kind === 'verb' ? formId !== 'dict' : kind === 'i-adj' ? formId !== 'adj-plain' && formId !== 'adj-polite' : formId === 'adj-sugi'

const isKanjiText = text => /\p{Script=Han}/u.test(text)

/** nameOf(id): { name, reading } of a pattern unit, from the overlay or the rule; throws when neither has one (the unit is in the pack then). */
function patternNamer(base, index) {
  const overlay = readJson(join(base, NAMES_FILE), { names: {} }).names
  for (const id of Object.keys(overlay)) if (!index.grammar.has(id)) throw new Error(NAMES_FILE + ' names an unknown pattern ' + id)
  const memo = new Map()
  return id => {
    if (memo.has(id)) return memo.get(id)
    const entry = index.grammar.get(id), given = overlay[id]
    if (!entry) throw new Error('No definition for the grammar entry ' + id)
    const name = given?.name ?? patternNameRule(entry.pattern)
    if (!name) throw new Error('No name for the pattern ' + id + ' (' + entry.pattern + '): the rule cannot make one, add it to ' + NAMES_FILE)
    const reading = given?.reading ?? (isKanjiText(name) ? null : name)
    if (reading === null) throw new Error('The name of ' + id + ' (' + name + ') has kanji: give its reading in ' + NAMES_FILE)
    if (isKanjiText(reading) || name.match(/<[^>]*>/g)?.join('') !== reading.match(/<[^>]*>/g)?.join('')) throw new Error('The reading of ' + id + ' (' + reading + ') does not match its name ' + name)
    const named = { name, reading }
    memo.set(id, named)
    return named
  }
}

/** The whole pack in memory: { files: Map(relative path -> text), report, gaps }. */
export function buildJaPack(base = defaultRoot) {
  const data = readParallel('ja', base)
  const references = loadReferences('ja', base)
  const lessons = [...data.lessons.lessons].sort((a, b) => a.number - b.number)
  const corrected = applyCorrections(lessons, {
    ...readJson(join(base, CORRECTIONS_FILE), {}),
    added: readJson(join(base, ADDED_PHRASES_FILE), { phrases: [] }).phrases,
    ...(({ moves, removals, additions }) => ({ moves, removals, additions }))(readJson(join(base, LESSON_CORRECTIONS_FILE), {})),
  })
  const taught = refreshReadability(lessons)
  const forms = analyseForms('ja', lessons, taught, data, references, base) // also sets each phrase's readyAt (irregular form items included)
  for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) if ((phrase.added || phrase.rewritten) && phrase.readyAt > lesson.number) throw new Error('Phrase ' + phrase.id + ' (lesson ' + lesson.number + ', ' + (phrase.added ? 'added' : 'rewritten') + ') uses something taught only in lesson ' + phrase.readyAt)
  const rules = loadFormsRules('ja', base)
  const engine = createForms(rules)
  const index = entryIndex(references, data.entries)
  const ownHeadwords = existsSync(join(base, HEADWORDS_FILE))
  const headwordFile = readJson(ownHeadwords ? join(base, HEADWORDS_FILE) : join(defaultRoot, HEADWORDS_FILE), { headwords: {} })
  const headwords = headwordFile.headwords
  const classOverlay = headwordFile.classes ?? {} // a word's class where the source's part of speech gives none (授業を受ける is listed as an expression) // a test's temporary root uses the repository's overlay, for the words it has
  for (const [id, headword] of Object.entries(headwords)) {
    const entry = index.vocabulary.get(id)
    if (!entry) { if (ownHeadwords) throw new Error(HEADWORDS_FILE + ' names an unknown word ' + id); continue }
    if (entry.target !== headword.pr) { if (ownHeadwords) throw new Error(HEADWORDS_FILE + ': ' + id + ' is listed as ' + entry.target + ', not in kana as ' + headword.pr); continue }
    if (!headword.ch || !headword.pr) throw new Error(HEADWORDS_FILE + ': ' + id + ' needs a headword (ch) and its reading (pr)')
    index.vocabulary.set(id, { ...entry, target: headword.ch, reading: headword.pr })
  }
  const glosses = readJson(join(base, GLOSSES_FILE), { glosses: {} }).glosses
  const overrides = readJson(join(base, GLOSS_OVERRIDES_FILE), { glosses: {} }).glosses
  const registry = readJson(join(base, REGISTRY_FILE), { version: 1, vocabulary: {}, grammar: {} })
  const readingFixes = readJson(join(base, READINGS_FILE), { readings: {} }).readings
  const nameOf = patternNamer(base, index)
  // a short text written by hand (where the rule cannot make one), the plain explanations, and the name of the form a pattern teaches (for a name that is only placeholders)
  const shortTexts = readJson(join(base, SHORT_TEXTS_FILE), { shortTexts: {} }).shortTexts
  const explanations = readJson(join(base, EXPLANATIONS_FILE), { explanations: {} }).explanations
  for (const id of [...Object.keys(shortTexts), ...Object.keys(explanations)]) if (!index.grammar.has(id)) throw new Error(SHORT_TEXTS_FILE + ' or ' + EXPLANATIONS_FILE + ' names an unknown pattern ' + id)
  const missingExplanations = [] // patterns with no plain explanation: the old wording stays as their fallback and --check fails
  const formNameOfPattern = new Map()
  {
    const names = readJson(existsSync(join(base, FORMS_FILE)) ? join(base, FORMS_FILE) : join(defaultRoot, FORMS_FILE), { forms: {} }).forms
    for (const [formId, spec] of Object.entries(rules.forms)) for (const kind of new Set(spec.group.flatMap(kindsOfGroup))) {
      const unit = engine.grammarOf(formId, { verb: 'ichidan', 'i-adj': 'i-adj', 'na-adj': 'na-adj', noun: 'noun' }[kind])
      if (unit && names[formId]?.name && !formNameOfPattern.has(unit)) formNameOfPattern.set(unit, names[formId].name)
    }
  }

  // ---- vocabulary: one item per (entry, meaning). The meaning is what the lesson teaches: its row's gloss, else the copied short gloss, else the dictionary's first sense. ----
  const isVerbEntry = entry => rules.classes[forms.classes.get(entry)?.class]?.group === 'verb'
  const itemGloss = (entry, row, number) => {
    if (!index.vocabulary.get(entry)) throw new Error('No definition for the word entry ' + entry)
    const forced = overrides[entry + '@' + number] ?? overrides[entry]
    const raw = row.gloss ?? glosses[entry] ?? (index.vocabulary.get(entry).english ?? '').split(' | ')[0]
    const gloss = forced ?? shortGloss(raw, { verb: isVerbEntry(entry) })
    if (!gloss || gloss.length > MAX_GLOSS) throw new Error('No good gloss for ' + entry + ' (' + raw + '): write one in ' + GLOSS_OVERRIDES_FILE)
    return gloss
  }
  const items = [], itemsOfEntry = new Map(), lessonUnits = new Map()
  for (const lesson of lessons) {
    const fresh = []
    for (const row of lesson.words ?? []) {
      const gloss = itemGloss(row.entry, row, lesson.number)
      const have = itemsOfEntry.get(row.entry) ?? []
      if (have.some(item => item.gloss.toLowerCase() === gloss.toLowerCase())) continue
      const item = { id: have.length ? row.entry + '#' + (have.length + 1) : row.entry, entry: row.entry, gloss, lesson: lesson.number }
      have.push(item); itemsOfEntry.set(row.entry, have); items.push(item); fresh.push(item)
    }
    lessonUnits.set(lesson.number, { w: fresh, g: [] })
  }
  /** The item a phrase of lesson N means by an entry: the latest meaning introduced by lesson N (the first one when the lesson comes before them all). */
  const itemAt = (entry, number) => {
    const have = itemsOfEntry.get(entry)
    if (!have) throw new Error('Phrases use the word entry ' + entry + ' that no lesson teaches')
    return [...have].reverse().find(item => item.lesson <= number) ?? have[0]
  }

  // ---- grammar, in lesson order ----
  const grammarIds = [], seenGrammar = new Set()
  const demonstrated = new Set(lessons.flatMap(lesson => (lesson.phrases ?? []).flatMap(phrase => phrase.grammar ?? [])))
  const skippedGrammar = new Set()
  const addGrammar = id => { if (id && !seenGrammar.has(id)) { seenGrammar.add(id); grammarIds.push(id) } }
  for (const lesson of lessons) {
    const g = lessonUnits.get(lesson.number).g
    for (const id of lesson.grammar_taught ?? []) { if (!demonstrated.has(id)) { skippedGrammar.add(id); continue } if (!seenGrammar.has(id)) g.push(id); addGrammar(id) }
  }
  for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) (phrase.grammar ?? []).forEach(addGrammar)
  const lateGrammar = grammarIds.filter(id => !lessons.some(l => (l.grammar_taught ?? []).includes(id)))
  if (lateGrammar.length) throw new Error('Phrases use units no lesson teaches: ' + lateGrammar.join(', '))

  const vocabLabels = issueLabels('vocabulary', items.map(item => { const e = index.vocabulary.get(item.entry); return { id: item.id, slug: romaji(e.reading || e.target), gloss: item.gloss } }), registry)
  const grammarLabels = issueLabels('grammar', grammarIds.map(id => {
    const e = index.grammar.get(id)
    if (!e) throw new Error('No definition for the grammar entry ' + id)
    return { id, slug: patternSlug(nameOf(id).reading, romaji), gloss: e.english }
  }), registry)
  checkLabels(registry, readJson(join(base, SEALED_FILE), { vocabulary: {}, grammar: {} }), { vocabulary: new Set(items.map(item => item.id)), grammar: new Set(grammarIds) })
  const word = (entry, number) => vocabLabels.labels[itemAt(entry, number).id], pattern = id => grammarLabels.labels[id]

  // ---- phrase tokens as example segments; a joined form is one segment (see joinsWord) ----
  const joinedTag = (lesson, phrase, at) => {
    const tag = forms.tags.get(lesson + ':' + phrase.id + ':' + at)
    return tag && joinsWord(kindOfClass(rules, tag.formClass), tag.form) ? tag : null
  }
  const phraseData = []
  const stats = { tagged: forms.tags.size, merged: 0, absorbed: 0, apart: 0, byForm: {}, missingGrammar: [] }
  for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) {
    const tokens = phrase.tokens
    if (tokens.map(t => t.t).join('') !== phrase.text) throw new Error('Phrase ' + phrase.id + ': the tokens do not add up to the text')
    const reading = (phrase.rewritten ? undefined : readingFixes[phrase.id]) ?? phrase.reading ?? phrase.text // a phrase rewritten whole brings its own reading
    // what a word token may read as: the entry's reading, or for an inflected token (休み of 休む) the reading's stem plus the token's own kana tail
    const known = tokens.map(token => {
      const entry = token.w ? index.vocabulary.get(token.w) : null
      if (!entry?.reading) return undefined
      if (entry.target === token.t) return entry.reading
      const kanji = entry.target.match(/^[^\u3040-\u30ffー]+/)?.[0]
      const okurigana = kanji ? entry.target.slice(kanji.length) : ''
      if (!kanji || !token.t.startsWith(kanji) || !entry.reading.endsWith(okurigana)) return undefined
      return entry.reading.slice(0, entry.reading.length - okurigana.length) + token.t.slice(kanji.length)
    })
    const parts = splitReading(tokens, reading, known)
    if (!parts) throw new Error('Phrase ' + phrase.id + ': the reading ' + reading + ' cannot be split over the tokens')
    const segments = [], mergedGrammar = []
    for (let at = 0; at < tokens.length; at++) {
      const token = tokens[at]
      if (!token.w && !token.g) {
        if (!PUNCTUATION.test(token.t)) throw new Error('Phrase ' + phrase.id + ': token "' + token.t + '" is neither a word, a grammar unit nor punctuation')
        parts[at] = token.t
        segments.push({ punctuation: token.t })
        continue
      }
      const tag = token.w ? joinedTag(lesson.number, phrase, at) : null
      if (token.w && forms.tags.has(lesson.number + ':' + phrase.id + ':' + at) && !tag) stats.apart++
      if (tag) {
        const span = tag.span ?? 0
        for (let k = 1; k <= span; k++) if (forms.tags.has(lesson.number + ':' + phrase.id + ':' + (at + k))) throw new Error('Phrase ' + phrase.id + ': a form starts inside another one')
        segments.push({ word: word(token.w, lesson.number), text: tokens.slice(at, at + 1 + span).map(t => t.t).join(''), reading: parts.slice(at, at + 1 + span).join(''), form: tag.form })
        stats.merged++; stats.absorbed += span; stats.byForm[tag.form] = (stats.byForm[tag.form] ?? 0) + 1
        if (tag.grammar && !(phrase.grammar ?? []).includes(tag.grammar) && seenGrammar.has(tag.grammar)) { stats.missingGrammar.push(phrase.id + ':' + tag.grammar); mergedGrammar.push(tag.grammar) }
        at += span
        continue
      }
      if (token.w) {
        const entry = index.vocabulary.get(token.w)
        const own = token.t !== entry.target, pr = entry.reading || entry.target
        segments.push({ word: word(token.w, lesson.number), ...(own ? { text: token.t } : {}), ...(own || parts[at] !== pr ? { reading: parts[at] } : {}) })
      } else segments.push({ grammar: pattern(token.g), text: token.t, reading: parts[at] })
    }
    phraseData.push({ lesson: lesson.number, phrase, segments, py: parts.join(''), words: [...new Set((phrase.words ?? []).map(entry => word(entry, lesson.number)))], grammar: [...new Set([...(phrase.grammar ?? []), ...mergedGrammar])].map(pattern), readyAt: phrase.readyAt })
  }

  // the example of each group: the lesson's own phrases that need nothing later, chosen to cover the lesson's new units, shortest first
  const exampleOf = p => ({ id: 'phrase-' + p.phrase.id, segments: p.segments, translation: p.phrase.en, grammar: p.grammar })
  const groups = lessons.map(lesson => {
    const units = lessonUnits.get(lesson.number)
    const newUnits = new Set([...units.w.map(item => 'w:' + item.id), ...units.g.map(id => 'g:' + id)])
    const own = phraseData.filter(p => p.lesson === lesson.number)
    const usable = own.filter(p => p.readyAt <= lesson.number)
    let pool = usable.length >= 2 ? usable : own
    if (pool.length < 2) pool = [...pool, ...phraseData.filter(p => p.lesson < lesson.number && p.readyAt <= lesson.number).reverse()]
    const covers = p => new Set([...(p.phrase.words ?? []).map(entry => 'w:' + itemAt(entry, p.lesson).id), ...(p.phrase.grammar ?? []).map(id => 'g:' + id)].filter(u => newUnits.has(u)))
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
      units: [...units.w.map(item => ({ kind: 'vocabulary', ref: vocabLabels.labels[item.id] })), ...units.g.map(id => ({ kind: 'grammar', ref: pattern(id) }))],
      examples: picked.map(exampleOf),
    }
  })

  // one demonstrating phrase per grammar record: the earliest-ready, then shortest phrase tagged with it
  const grammar = grammarIds.map(id => {
    const e = index.grammar.get(id)
    const tagged = phraseData.filter(p => (p.phrase.grammar ?? []).includes(id)).sort((a, b) => a.readyAt - b.readyAt || a.phrase.text.length - b.phrase.text.length || a.phrase.id - b.phrase.id)
    if (!tagged.length) throw new Error('No phrase demonstrates the grammar unit ' + id + ' (' + e.pattern + ')')
    const { id: _id, ...ex } = exampleOf(tagged[0])
    const name = nameOf(id).name
    const onlyPlaceholders = /^(<[^>]*>)( \+ <[^>]*>)*$/.test(name)
    const st = shortTexts[id] ?? shortTextRule(name) ?? (onlyPlaceholders ? (/^<[^>]*>$/.test(name) ? formNameOfPattern.get(id) : undefined) ?? name.replace(/[<>]/g, '') : undefined)
    if (!st) throw new Error('No short text for the pattern ' + id + ' (' + name + '): the rule cannot make one, add it to ' + SHORT_TEXTS_FILE)
    const plain = explanations[id]
    if (!plain) missingExplanations.push(id)
    return { id, pt: name, pr: nameOf(id).reading, ds: plain ?? e.english, st, lb: pattern(id), ex }
  })
  const vocabulary = items.map(item => {
    const e = index.vocabulary.get(item.entry), cl = forms.classes.get(item.entry)?.class
    const cls = cl ?? (rules.classes[classOverlay[item.entry]] ? classOverlay[item.entry] : undefined)
    return { id: item.id, ch: e.target, pr: e.reading || e.target, ds: item.gloss, lb: vocabLabels.labels[item.id], ...(cls ? { cl: cls } : {}) }
  })

  // ---- the forms table: the names of the forms and the pattern unit that teaches each ----
  const formNames = readJson(existsSync(join(base, FORMS_FILE)) ? join(base, FORMS_FILE) : join(defaultRoot, FORMS_FILE), { forms: {} }).forms // a test's temporary root uses the repository's names
  const REPRESENTATIVE = { verb: 'ichidan', 'i-adj': 'i-adj', 'na-adj': 'na-adj', noun: 'noun' }
  for (const id of Object.keys(formNames)) if (!rules.forms[id]) throw new Error(FORMS_FILE + ' names an unknown form ' + id)
  const formsTable = Object.entries(rules.forms).map(([id, spec]) => {
    const named = formNames[id]
    if (!named?.name) throw new Error('The form ' + id + ' has no learner-facing name in ' + FORMS_FILE)
    const kinds = [...new Set(spec.group.flatMap(kindsOfGroup))]
    const patternsByKind = {}
    for (const kind of kinds) { const unit = engine.grammarOf(id, REPRESENTATIVE[kind]); if (unit && seenGrammar.has(unit)) patternsByKind[kind] = pattern(unit) }
    return { id, name: named.name, ...(named.ending ? { ending: named.ending } : {}), kinds, joined: kinds.filter(kind => joinsWord(kind, id)), patterns: patternsByKind, ...(named.apart ? { apart: named.apart } : {}) }
  })

  // ---- the headword check: a conjugated token must be what its headword builds ----
  const recordOf = new Map(vocabulary.map(item => [item.lb, item]))
  const mismatches = { differs: [], split: [], own: [] }
  for (const p of phraseData) for (const segment of p.segments) {
    const item = segment.word ? recordOf.get(segment.word) : undefined
    if (!item) continue
    if (segment.form) {
      const built = item.cl ? engine.forms(item.ch, item.cl, segment.form, { reading: item.pr }) : null
      if (built && built.surface === segment.text && built.reading === segment.reading) continue
      // a headword of several words (雨が降る, 運転する) is built whole while a sentence has it in pieces: the token is the end of what is built
      const kind = built && built.surface.endsWith(segment.text) && built.reading.endsWith(segment.reading) ? 'split' : 'differs'
      mismatches[kind].push({ phrase: p.phrase.id, word: item.ch, form: segment.form, token: segment.text, built: built?.surface ?? null })
    } else if (segment.text !== undefined && segment.text !== item.ch) mismatches.own.push({ phrase: p.phrase.id, word: item.ch, token: segment.text })
  }
  const band = { schemaVersion: 1, band: '1', alignment: ALIGNMENT, vocabulary, grammar, groups }
  const catalogIndex = { schemaVersion: 1, bands: [{ band: '1', alignment: ALIGNMENT, vocabulary: vocabulary.length, grammar: grammar.length, groups: groups.length }] }
  const phrases = phraseData.map(p => ({
    id: p.phrase.id, zh: p.phrase.text, py: p.py, en: p.phrase.en, words: p.words, ...(p.grammar.length ? { grammar: p.grammar } : {}),
    source: p.phrase.source, checked: p.phrase.checked === true, readyAt: p.readyAt, ...(impliedSubject('ja', p.segments) ? { impliedSubject: true } : {}), tokens: p.segments,
  }))
  const perWord = {}
  for (const p of phrases) for (const w of p.words) perWord[w] = (perWord[w] ?? 0) + 1
  const phraseIndex = { schemaVersion: 1, bands: { 1: { count: phrases.length, words: Object.fromEntries(Object.entries(perWord).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) } } }
  const sorted = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  const newRegistry = { version: 1, vocabulary: sorted({ ...(registry.vocabulary ?? {}), ...vocabLabels.added }), grammar: sorted({ ...(registry.grammar ?? {}), ...grammarLabels.added }) }

  const json = value => JSON.stringify(value) + '\n'
  const files = new Map([
    [PACK_DIR + '/index.generated.json', json(catalogIndex)],
    [PACK_DIR + '/band-1.generated.json', json(band)],
    [PACK_DIR + '/forms.generated.json', json({ schemaVersion: 1, forms: formsTable })],
    [PACK_DIR + '/phrases-index.json', json(phraseIndex)],
    [PACK_DIR + '/phrases-band-1.json', json({ schemaVersion: 2, band: '1', phrases })],
    [REGISTRY_FILE, JSON.stringify(newRegistry, null, 1) + '\n'],
  ])
  const sizes = groups.map(g => g.units.length)

  // ---- the content gaps (--report) ----
  const formsOfPattern = new Map()
  for (const [id, spec] of Object.entries(rules.forms)) for (const kind of spec.group.flatMap(kindsOfGroup).filter(item => item !== 'noun')) { const unit = engine.grammarOf(id, REPRESENTATIVE[kind]); if (unit) { if (!formsOfPattern.has(unit)) formsOfPattern.set(unit, new Set()); formsOfPattern.get(unit).add(id) } }
  const titleOf = id => { try { return nameOf(id).name } catch { return index.grammar.get(id)?.pattern ?? id } }
  const patternTitle = id => '`' + id + '` ' + titleOf(id)
  const accepted = readJson(join(base, ACCEPTED_GAPS_FILE), { accepted: [] }).accepted
  const gaps = computeGaps(lessons, {
    tags: forms.tags, taught, formsOfPattern,
    patternTitle, wordTitle: (entry, number) => '`' + entry + '` ' + index.vocabulary.get(entry).target + ' (' + itemAt(entry, number).gloss + ')',
  })
  const gapProblems = checkGaps(gaps, accepted)
  return { files, band, phrases, formsTable, corrected, gapProblems, accepted, missingExplanations, mismatches, items, gaps, skippedGrammar: [...skippedGrammar].sort().map(id => ({ id, name: titleOf(id) })), stats, report: { vocabulary: vocabulary.length, grammar: grammar.length, groups: groups.length, phrases: phrases.length, unitsPerGroup: [Math.min(...sizes), Math.max(...sizes)], skippedGrammar: [...skippedGrammar].sort(), examplesPerGroup: [Math.min(...groups.map(g => g.examples.length)), Math.max(...groups.map(g => g.examples.length))], newLabels: Object.keys(vocabLabels.added).length + Object.keys(grammarLabels.added).length, forms: formsTable.length, merged: stats.merged } }
}

/** The content gaps as markdown (docs/audits/2026-11-10-japanese-lesson-content-gaps.md); an accepted gap says so, with its reason. */
export const gapsMarkdown = pack => gapsMarkdownShared(pack, { language: 'Japanese', command: 'node scripts/generate-pack-ja.mjs', lead: "A gap is a place where a lesson's list and its sentences do not meet. `--check` fails for a gap that is neither closed nor in the accepted list (`curriculum/japanese/authoring/pack-accepted-gaps.json`, one reason each); step 3.4b closed the gaps of the first version of this report." })

/** The sealed file with every label of the registry added; a sealed label is never changed. */
export const sealText = (base = defaultRoot) => sealShared(base, { REGISTRY_FILE, SEALED_FILE, command: 'node scripts/generate-pack-ja.mjs' })

export function main(argv = process.argv.slice(2)) {
  const args = [...argv]
  const take = flag => { const at = args.indexOf(flag); if (at < 0) return undefined; args.splice(at, 1); return true }
  const check = take('--check'), seal = take('--seal')
  const rootAt = args.indexOf('--root')
  const base = rootAt >= 0 ? resolve(args.splice(rootAt, 2)[1]) : defaultRoot
  const reportAt = args.indexOf('--report')
  let reportFile
  if (reportAt >= 0) { reportFile = args[reportAt + 1] && !args[reportAt + 1].startsWith('--') ? args.splice(reportAt, 2)[1] : (args.splice(reportAt, 1), '') }
  if (args.length) throw new Error('Usage: node scripts/generate-pack-ja.mjs [--check] [--root DIR] | --report [FILE] | --seal')
  if (seal) { writeAtomic(join(base, SEALED_FILE), sealText(base)); console.log('Sealed the labels of ' + REGISTRY_FILE); return }
  const pack = buildJaPack(base)
  if (reportFile !== undefined) {
    const text = gapsMarkdown(pack)
    if (reportFile) writeAtomic(resolve(base, reportFile), text); else process.stdout.write(text)
    return
  }
  if (check && (pack.gapProblems.unaccepted.length || pack.gapProblems.stale.length)) {
    for (const item of pack.gapProblems.unaccepted) console.error('Content gap not accepted: lesson ' + item.lesson + ', ' + item.kind + ' ' + item.id)
    for (const item of pack.gapProblems.stale) console.error('Accepted gap that is no gap, or has no reason: lesson ' + item.lesson + ', ' + item.kind + ' ' + item.id)
    throw new Error('The lessons have content gaps that are not in ' + ACCEPTED_GAPS_FILE + ' (close them in the lesson source corrections, or accept them there with a reason).')
  }
  if (check && pack.missingExplanations.length) throw new Error('No plain explanation (' + EXPLANATIONS_FILE + ') for: ' + pack.missingExplanations.join(', '))
  const { files, report } = pack
  const stale = writeFiles(base, files, check)
  const words = list => [...new Set(list.map(item => item.word + (item.token ? ' (' + item.token + ')' : '')))].join(', ')
  if (pack.mismatches.split.length) console.log('Headword check, compound headwords written in pieces in sentences (' + pack.mismatches.split.length + ' tokens): ' + words(pack.mismatches.split))
  if (pack.mismatches.own.length) console.log('Headword check, tokens written differently from the headword, no form involved (' + pack.mismatches.own.length + ' tokens): ' + words(pack.mismatches.own))
  console.log('Japanese pack data ' + (check ? 'checked' : 'generated') + ': ' + JSON.stringify(report))
  if (pack.mismatches.differs.length) { for (const item of pack.mismatches.differs.slice(0, 20)) console.error('Headword check: phrase ' + item.phrase + ' writes ' + item.word + ' (' + item.form + ') as ' + item.token + ' but the headword builds ' + item.built); throw new Error('Headword check: ' + pack.mismatches.differs.length + ' tokens differ from what their headword builds. Fix the headword in ' + HEADWORDS_FILE + '.') }
  if (check && stale.length) { for (const path of stale) console.error('Stale Japanese pack data: ' + relative(base, join(base, path))); throw new Error('Run "node scripts/generate-pack-ja.mjs" to regenerate the Japanese pack data.') }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
