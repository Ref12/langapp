// Writes the Korean language pack's data (src/data/packs/ko) from the authoring data under curriculum/korean:
//   parallel/entries.yaml + zh-lessons.yaml + the imported TOPIK references (read through scripts/parallel-lessons-files.mjs),
//   authoring/pack-glosses.json (short glosses where a lesson row has none), authoring/pack-gloss-overrides.json (glosses written by hand),
//   authoring/pack-pattern-names.json (pattern names the rule in pack-ko-names.mjs cannot make), authoring/pack-pattern-short-texts.json, authoring/pack-forms.json (names of the word forms),
//   authoring/pack-headwords.json (a headword written differently from the source's), authoring/pack-labels.json (the label registry, append-only) and pack-labels-sealed.json (labels that may never change),
//   authoring/pack-phrase-corrections.json, pack-lesson-corrections.json, pack-added-phrases.json (corrections of the lesson source) and pack-accepted-gaps.json (content gaps accepted for a later stage, each with a reason).
// The language-free parts (label registry and sealed list, corrections, gap check, writer, short glosses) are in scripts/pack-shared.mjs, shared with generate-pack-ja.mjs.
// Nothing is read from the Chinese lesson data, and no Chinese field (zh, senses) goes into the pack.
// (No npm script: package.json is hashed into public/characters/chinese/derived-source.generated.zip, so editing it makes characters:check fail. Run it with node.)
// Usage: node scripts/generate-pack-ko.mjs [--check] [--root DIR]
//        node scripts/generate-pack-ko.mjs --report [FILE]   the content gaps of the lessons (markdown, to FILE or stdout)
//        node scripts/generate-pack-ko.mjs --seal            add the registry's labels to the sealed file (never changes a sealed one)
import { existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFormsRules } from './forms-data.mjs'
import { patternNameRule, patternSlug, posLabel, shortTextRule, slugOfKorean } from './pack-ko-names.mjs'
import { applyCorrections as applyCorrectionsShared, checkGaps, checkLabels, computeGaps, gapsMarkdown as gapsMarkdownShared, glossWord, issueLabels, MAX_GLOSS, readJson, sealText as sealShared, shortGloss, writeFiles } from './pack-shared.mjs'
import { entryIndex, loadReferences, readParallel, refreshReadability, root as defaultRoot, writeAtomic } from './parallel-lessons-files.mjs'

export const PACK_DIR = 'src/data/packs/ko'
const AUTHORING = 'curriculum/korean/authoring/'
export const REGISTRY_FILE = AUTHORING + 'pack-labels.json'
export const SEALED_FILE = AUTHORING + 'pack-labels-sealed.json'
export const GLOSSES_FILE = AUTHORING + 'pack-glosses.json'
export const GLOSS_OVERRIDES_FILE = AUTHORING + 'pack-gloss-overrides.json'
export const NAMES_FILE = AUTHORING + 'pack-pattern-names.json'
export const SHORT_TEXTS_FILE = AUTHORING + 'pack-pattern-short-texts.json'
export const FORMS_FILE = AUTHORING + 'pack-forms.json'
export const HEADWORDS_FILE = AUTHORING + 'pack-headwords.json'
export const CORRECTIONS_FILE = AUTHORING + 'pack-phrase-corrections.json'
export const LESSON_CORRECTIONS_FILE = AUTHORING + 'pack-lesson-corrections.json'
export const ADDED_PHRASES_FILE = AUTHORING + 'pack-added-phrases.json'
export const ACCEPTED_GAPS_FILE = AUTHORING + 'pack-accepted-gaps.json'
export const GAPS_REPORT_FILE = 'docs/audits/2026-11-10-korean-lesson-content-gaps.md'
export const GROUP_PREFIX = 'ko-lesson-'
export const ALIGNMENT = 'lessons-1'
const MAX_EXAMPLES = 3
const PUNCTUATION = /^[\p{P}\p{S}\s]+$/u
const COMMAND = 'node scripts/generate-pack-ko.mjs'

/** The corrections of the lesson source (see pack-shared.mjs), with this pack's file names in the messages. A Korean phrase keeps its own text: its tokens carry no spaces between words. */
export const applyCorrections = (lessons, corrections) => applyCorrectionsShared(lessons, corrections, { files: { ADDED_PHRASES_FILE, CORRECTIONS_FILE, LESSON_CORRECTIONS_FILE }, language: 'Korean', reading: false, joinText: false })

/**
 * The segments of a phrase: its tokens, with a space segment where the sentence has a space between two tokens, so that the segments render to exactly the sentence's text.
 * The source's tokens may leave out a space inside a word (안녕히가세요 for 안녕히 가세요): the token then takes the text as the sentence writes it. tokenSegment(token, written) makes the segment.
 * Throws when the tokens do not add up to the text, spaces apart.
 */
export function segmentsWithSpaces(phrase, tokenSegment) {
  const text = phrase.text, out = []
  let at = 0
  for (const token of phrase.tokens) {
    const gap = at
    while (/\s/.test(text[at] ?? '')) at++
    if (at > gap) out.push({ punctuation: text.slice(gap, at) })
    const start = at
    for (const char of token.t.replace(/\s+/g, '')) {
      while (/\s/.test(text[at] ?? '') && at > start) at++
      if (text[at] !== char) throw new Error('Phrase ' + phrase.id + ': the tokens do not add up to the text at "' + token.t + '" (' + text + ')')
      at++
    }
    out.push(tokenSegment(token, text.slice(start, at)))
  }
  if (text.slice(at).trim()) throw new Error('Phrase ' + phrase.id + ': the tokens stop before the end of the text (' + text + ')')
  if (at < text.length) out.push({ punctuation: text.slice(at) })
  return out
}

export function buildKoPack(base = defaultRoot) {
  const data = readParallel('ko', base)
  const references = loadReferences('ko', base)
  const lessons = [...data.lessons.lessons].sort((a, b) => a.number - b.number)
  const corrected = applyCorrections(lessons, {
    ...readJson(join(base, CORRECTIONS_FILE), {}),
    added: readJson(join(base, ADDED_PHRASES_FILE), { phrases: [] }).phrases,
    ...(({ moves, removals, additions }) => ({ moves, removals, additions }))(readJson(join(base, LESSON_CORRECTIONS_FILE), {})),
  })
  const taught = refreshReadability(lessons)
  for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) if ((phrase.added || phrase.rewritten) && phrase.readyAt > lesson.number) throw new Error('Phrase ' + phrase.id + ' (lesson ' + lesson.number + ', ' + (phrase.added ? 'added' : 'rewritten') + ') uses something taught only in lesson ' + phrase.readyAt)
  const rules = loadFormsRules('ko', base)
  const index = entryIndex(references, data.entries)
  const headwords = readJson(join(base, HEADWORDS_FILE), { headwords: {} }).headwords
  for (const [id, headword] of Object.entries(headwords)) {
    const entry = index.vocabulary.get(id)
    if (!entry) throw new Error(HEADWORDS_FILE + ' names an unknown word ' + id)
    if (!headword.ch) throw new Error(HEADWORDS_FILE + ': ' + id + ' needs a headword (ch)')
    index.vocabulary.set(id, { ...entry, target: headword.ch })
  }
  const glosses = readJson(join(base, GLOSSES_FILE), { glosses: {} }).glosses
  const overrides = readJson(join(base, GLOSS_OVERRIDES_FILE), { glosses: {} }).glosses
  const registry = readJson(join(base, REGISTRY_FILE), { version: 1, vocabulary: {}, grammar: {} })
  const names = readJson(join(base, NAMES_FILE), { names: {} }).names
  const shortTexts = readJson(join(base, SHORT_TEXTS_FILE), { shortTexts: {} }).shortTexts
  for (const id of [...Object.keys(names), ...Object.keys(shortTexts)]) if (!index.grammar.has(id)) throw new Error(NAMES_FILE + ' or ' + SHORT_TEXTS_FILE + ' names an unknown pattern ' + id)
  /** The name of a pattern in the convention (overlay first, then the rule), and the label slug of it. */
  const nameOf = id => {
    const e = index.grammar.get(id)
    if (!e) throw new Error('No definition for the grammar entry ' + id)
    const name = names[id]?.name ?? patternNameRule(e.pattern)
    if (!name) throw new Error('No name for the pattern ' + id + ' (' + e.pattern + '): the rule cannot make one, add it to ' + NAMES_FILE)
    return name
  }

  // ---- vocabulary: one item per (entry, meaning). The meaning is what the lesson teaches: its row's gloss, else the copied short gloss, else the dictionary's first sense. ----
  const posOf = (entry, row) => posLabel(row.pos ?? index.vocabulary.get(entry).pos)
  const itemGloss = (entry, row, number) => {
    if (!index.vocabulary.get(entry)) throw new Error('No definition for the word entry ' + entry)
    const forced = overrides[entry + '@' + number] ?? overrides[entry]
    const raw = row.gloss ?? glosses[entry] ?? (index.vocabulary.get(entry).english ?? '').split(' | ')[0]
    const gloss = forced ?? shortGloss(raw, { verb: posOf(entry, row) === 'verb' })
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
      const item = { id: have.length ? row.entry + '#' + (have.length + 1) : row.entry, entry: row.entry, gloss, lesson: lesson.number, ps: posOf(row.entry, row) }
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
  const skippedGrammar = new Set()
  const addGrammar = id => { if (id && !seenGrammar.has(id)) { seenGrammar.add(id); grammarIds.push(id) } }
  for (const lesson of lessons) {
    const g = lessonUnits.get(lesson.number).g
    for (const id of lesson.grammar_taught ?? []) { if (!seenGrammar.has(id)) g.push(id); addGrammar(id) } // a pattern no sentence shows stays in its lesson (it is a content gap, accepted for stage 4)
  }
  for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) [...(phrase.grammar ?? []), ...phrase.tokens.filter(token => token.g).map(token => token.g)].forEach(addGrammar)
  const lateGrammar = grammarIds.filter(id => !lessons.some(l => (l.grammar_taught ?? []).includes(id)))
  if (lateGrammar.length) throw new Error('Phrases use units no lesson teaches: ' + lateGrammar.join(', '))

  const vocabLabels = issueLabels('vocabulary', items.map(item => ({ id: item.id, slug: slugOfKorean(index.vocabulary.get(item.entry).target), gloss: item.gloss })), registry)
  const grammarLabels = issueLabels('grammar', grammarIds.map(id => ({ id, slug: patternSlug(nameOf(id)), gloss: index.grammar.get(id).english })), registry)
  checkLabels(registry, readJson(join(base, SEALED_FILE), { vocabulary: {}, grammar: {} }), { vocabulary: new Set(items.map(item => item.id)), grammar: new Set(grammarIds) })
  const word = (entry, number) => vocabLabels.labels[itemAt(entry, number).id], pattern = id => grammarLabels.labels[id]

  // ---- phrase tokens as example segments (a word or grammar token is one segment; a space between tokens is a space segment) ----
  const phraseData = []
  for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) {
    const segments = segmentsWithSpaces(phrase, (token, written) => {
      if (!token.w && !token.g) {
        if (!PUNCTUATION.test(token.t)) throw new Error('Phrase ' + phrase.id + ': token "' + token.t + '" is neither a word, a grammar unit nor punctuation')
        return { punctuation: written }
      }
      if (token.w) {
        const entry = index.vocabulary.get(token.w)
        if (!entry) throw new Error('Phrase ' + phrase.id + ': unknown word ' + token.w)
        return { word: word(token.w, lesson.number), ...(written !== entry.target ? { text: written, reading: written } : {}) }
      }
      return { grammar: pattern(token.g), text: written, reading: written }
    })
    const wordIds = [...new Set([...(phrase.words ?? []), ...phrase.tokens.filter(token => token.w).map(token => token.w)])]
    const grammarOfPhrase = [...new Set([...(phrase.grammar ?? []), ...phrase.tokens.filter(token => token.g).map(token => token.g)])]
    if (!wordIds.length) throw new Error('Phrase ' + phrase.id + ' has no word')
    phraseData.push({ lesson: lesson.number, phrase, segments, words: [...new Set(wordIds.map(entry => word(entry, lesson.number)))], grammar: grammarOfPhrase.map(pattern), wordIds, grammarIds: grammarOfPhrase, readyAt: phrase.readyAt })
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
    const covers = p => new Set([...p.wordIds.map(entry => 'w:' + itemAt(entry, p.lesson).id), ...p.grammarIds.map(id => 'g:' + id)].filter(u => newUnits.has(u)))
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
    const tagged = phraseData.filter(p => p.grammarIds.includes(id)).sort((a, b) => a.readyAt - b.readyAt || a.phrase.text.length - b.phrase.text.length || a.phrase.id - b.phrase.id)
    // a pattern that no sentence shows (a gap, accepted for stage 4) gets the shortest sentence of the lesson that teaches it, so the card has something to show
    const own = phraseData.filter(p => lessons.find(l => l.number === p.lesson).grammar_taught.includes(id)).sort((a, b) => a.phrase.text.length - b.phrase.text.length || a.phrase.id - b.phrase.id)
    const shown = tagged[0] ?? own[0]
    if (!shown) throw new Error('No sentence to show the grammar unit ' + id + ' (' + e.pattern + ')')
    const { id: _id, ...ex } = exampleOf(shown)
    const name = nameOf(id)
    const st = shortTexts[id] ?? shortTextRule(name)
    if (!st) throw new Error('No short text for the pattern ' + id + ' (' + name + '): the rule cannot make one, add it to ' + SHORT_TEXTS_FILE)
    return { id, pt: name, pr: name, ds: e.english, st, lb: pattern(id), ex }
  })
  const vocabulary = items.map(item => {
    const e = index.vocabulary.get(item.entry)
    return { id: item.id, ch: e.target, pr: e.target, ds: item.gloss, lb: vocabLabels.labels[item.id], ps: item.ps }
  })

  // ---- the forms table: the names of the forms and the pattern unit that teaches each (the forms are used by Practice in a later stage) ----
  const formNames = readJson(join(base, FORMS_FILE), { forms: {} }).forms
  for (const id of Object.keys(formNames)) if (!rules.forms[id]) throw new Error(FORMS_FILE + ' names an unknown form ' + id)
  const formsTable = Object.entries(rules.forms).map(([id, spec]) => {
    const named = formNames[id]
    if (!named?.name) throw new Error('The form ' + id + ' has no learner-facing name in ' + FORMS_FILE)
    const kinds = ['verb', 'adjective']
    const patterns = spec.grammar && seenGrammar.has(spec.grammar) ? Object.fromEntries(kinds.map(kind => [kind, pattern(spec.grammar)])) : {}
    return { id, name: named.name, ...(named.ending ? { ending: named.ending } : {}), kinds, joined: [], patterns }
  })

  const band = { schemaVersion: 1, band: '1', alignment: ALIGNMENT, vocabulary, grammar, groups }
  const catalogIndex = { schemaVersion: 1, bands: [{ band: '1', alignment: ALIGNMENT, vocabulary: vocabulary.length, grammar: grammar.length, groups: groups.length }] }
  const phrases = phraseData.map(p => ({
    id: p.phrase.id, zh: p.phrase.text, py: p.phrase.text, en: p.phrase.en, words: p.words, ...(p.grammar.length ? { grammar: p.grammar } : {}),
    source: p.phrase.source, checked: p.phrase.checked === true, readyAt: p.readyAt, tokens: p.segments,
  }))
  const perWord = {}
  for (const p of phrases) for (const w of p.words) perWord[w] = (perWord[w] ?? 0) + 1
  const sorted = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  const phraseIndex = { schemaVersion: 1, bands: { 1: { count: phrases.length, words: sorted(perWord) } } }
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

  // ---- the content gaps: patterns no phrase of the lesson shows, words no phrase of the lesson uses, lessons that teach no grammar ----
  const accepted = readJson(join(base, ACCEPTED_GAPS_FILE), { accepted: [] }).accepted
  const gaps = computeGaps(lessons, {
    tags: new Map(), taught, formsOfPattern: new Map(), lessonsWithoutGrammar: true,
    patternTitle: id => '`' + id + '` ' + (grammarIds.includes(id) || names[id] || patternNameRule(index.grammar.get(id)?.pattern ?? '') ? nameOf(id) : id),
    wordTitle: (entry, number) => '`' + entry + '` ' + index.vocabulary.get(entry).target + ' (' + itemAt(entry, number).gloss + ')',
  })
  const gapProblems = checkGaps(gaps, accepted)
  return { files, band, phrases, formsTable, corrected, gapProblems, accepted, items, gaps, skippedGrammar: [...skippedGrammar].sort().map(id => ({ id, name: nameOf(id) })), report: { vocabulary: vocabulary.length, grammar: grammar.length, groups: groups.length, phrases: phrases.length, unitsPerGroup: [Math.min(...sizes), Math.max(...sizes)], skippedGrammar: [...skippedGrammar].sort(), examplesPerGroup: [Math.min(...groups.map(g => g.examples.length)), Math.max(...groups.map(g => g.examples.length))], newLabels: Object.keys(vocabLabels.added).length + Object.keys(grammarLabels.added).length, forms: formsTable.length } }
}

/** The content gaps as markdown (docs/audits/2026-11-10-korean-lesson-content-gaps.md): the work list of stage 4. An accepted gap says so, with its reason. */
export const gapsMarkdown = pack => gapsMarkdownShared(pack, { language: 'Korean', command: COMMAND, lead: "A gap is a place where a lesson's list and its sentences do not meet. `--check` fails for a gap that is neither closed nor in the accepted list (`curriculum/korean/authoring/pack-accepted-gaps.json`, one reason each). Every gap below is accepted for now with the reason \"stage 4\": this list is the work list of stage 4 of docs/audits/2026-11-10-korean-plan.md." })

/** The sealed file with every label of the registry added; a sealed label is never changed. */
export const sealText = (base = defaultRoot) => sealShared(base, { REGISTRY_FILE, SEALED_FILE, command: COMMAND })

export function main(argv = process.argv.slice(2)) {
  const args = [...argv]
  const take = flag => { const at = args.indexOf(flag); if (at < 0) return undefined; args.splice(at, 1); return true }
  const check = take('--check'), seal = take('--seal')
  const rootAt = args.indexOf('--root')
  const base = rootAt >= 0 ? resolve(args.splice(rootAt, 2)[1]) : defaultRoot
  const reportAt = args.indexOf('--report')
  let reportFile
  if (reportAt >= 0) { reportFile = args[reportAt + 1] && !args[reportAt + 1].startsWith('--') ? args.splice(reportAt, 2)[1] : (args.splice(reportAt, 1), '') }
  if (args.length) throw new Error('Usage: ' + COMMAND + ' [--check] [--root DIR] | --report [FILE] | --seal')
  if (seal) { writeAtomic(join(base, SEALED_FILE), sealText(base)); console.log('Sealed the labels of ' + REGISTRY_FILE); return }
  const pack = buildKoPack(base)
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
  const stale = writeFiles(base, pack.files, check)
  console.log('Korean pack data ' + (check ? 'checked' : 'generated') + ': ' + JSON.stringify(pack.report))
  if (check && stale.length) { for (const path of stale) console.error('Stale Korean pack data: ' + relative(base, join(base, path))); throw new Error('Run "node scripts/generate-pack-ko.mjs" to regenerate the Korean pack data.') }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
