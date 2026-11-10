// What the language packs share (scripts/generate-pack-ja.mjs, scripts/generate-pack-ko.mjs): the label registry and its sealed list, the corrections of the lesson source, the content-gap check, short glosses and the file writer.
// Nothing here knows a language: the generators pass their file names and wording in.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeAtomic } from './parallel-lessons-files.mjs'

export const MAX_GLOSS = 40

export function readJson(file, fallback) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback }
export const unique = list => [...new Set(list)]
export const tokenText = tokens => tokens.map(token => token.t + '(' + (token.w ?? token.g ?? '') + ')').join(' ')
const LABEL = /^[a-z][a-z0-9]*(?:--?[a-z0-9]+)*$/


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

// ---- label registry ----
export const clean = slug => slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')

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

/** The registry against the sealed list and the entries now in the pack: no label disappears, no sealed label changes. known = { vocabulary: Set of ids, grammar: Set of ids }. */
export function checkLabels(registry, sealed, known) {
  for (const kind of ['vocabulary', 'grammar']) {
        for (const id of Object.keys(registry[kind] ?? {})) if (!known[kind].has(id)) throw new Error('The registered label of ' + kind + ' ' + id + ' (' + registry[kind][id] + ') would disappear: the entry is no longer in the pack. Entries are never removed.')
    for (const [id, label] of Object.entries(sealed[kind] ?? {})) {
      if (registry[kind]?.[id] === undefined) throw new Error('The sealed label of ' + kind + ' ' + id + ' (' + label + ') is missing from the registry. Labels are never removed.')
      if (registry[kind][id] !== label) throw new Error('The label of ' + kind + ' ' + id + ' would change from ' + label + ' to ' + registry[kind][id] + '. Sealed labels never change; append a new entry instead.')
    }
  }
}

// ---- corrections ----
/** A phrase written whole (a rewrite or an added phrase): every word token is in its word list and every grammar token in its grammar list, so the tags cannot drift from the tokens. */
function checkWholePhrase(where, phrase, needsReading = true) {
  if (!Array.isArray(phrase.tokens) || !phrase.tokens.length) throw new Error(where + ': needs tokens')
  if (needsReading && (typeof phrase.reading !== 'string' || !phrase.reading)) throw new Error(where + ': needs a reading')
  if (!Array.isArray(phrase.words) || !Array.isArray(phrase.grammar)) throw new Error(where + ': needs words and grammar lists')
  for (const token of phrase.tokens) {
    if (typeof token.t !== 'string' || !token.t) throw new Error(where + ': a token has no text')
    if (token.w && token.g) throw new Error(where + ': token ' + token.t + ' is both a word and a grammar unit')
    if (token.w && !phrase.words.includes(token.w)) throw new Error(where + ': the word ' + token.w + ' of token ' + token.t + ' is not in its words list')
    if (token.g && !phrase.grammar.includes(token.g)) throw new Error(where + ': the grammar unit ' + token.g + ' of token ' + token.t + ' is not in its grammar list')
  }
}

/**
 * Applies the corrections of the lesson source to the lessons in memory, before anything is derived. The sources are never edited.
 * corrections = { phrases, writings, added, moves, removals, additions } (the files pack-phrase-corrections.json, pack-added-phrases.json and pack-lesson-corrections.json, see docs/audits/2026-11-10-ja-wording.md section 9).
 * Order: added phrases, phrase corrections, the lessons' lists (moves, removals, additions), writings. Each operation throws, naming the lesson or phrase, when what it refers to is not there.
 * Returns what it changed, for the audit.
 */
export function applyCorrections(lessons, corrections, { files, language = 'Japanese', reading = true, joinText = true }) {
  const { ADDED_PHRASES_FILE, CORRECTIONS_FILE, LESSON_CORRECTIONS_FILE } = files
  const changed = []
  const byNumber = new Map(lessons.map(lesson => [lesson.number, lesson]))
  const lessonOf = (where, number) => { const lesson = byNumber.get(number); if (!lesson) throw new Error(where + ': there is no lesson ' + number); return lesson }
  const byId = new Map(lessons.flatMap(lesson => (lesson.phrases ?? []).map(phrase => [String(phrase.id), phrase])))
  const lastId = Math.max(0, ...[...byId.keys()].map(Number))
  // 1. phrases the Chinese lesson does not have (Japanese-only): appended to the lesson's phrases, marked extra
  for (const add of corrections.added ?? []) {
    const where = ADDED_PHRASES_FILE + ': phrase ' + add.id
    const lesson = lessonOf(where, add.lesson)
    if (!Number.isInteger(add.id) || add.id <= lastId) throw new Error(where + ' must be a new id after the last one (' + lastId + ')')
    if (byId.has(String(add.id))) throw new Error(where + ' is added twice')
    if (add.extra !== true) throw new Error(where + ' must be marked extra: true (a ' + language + '-only phrase)')
    if (add.zh !== undefined || add.zh_ref !== undefined) throw new Error(where + ' is ' + language + '-only: no zh or zh_ref')
    if (typeof add.en !== 'string' || !add.en) throw new Error(where + ': needs an English translation')
    const phrase = { id: add.id, text: '', reading: add.reading, en: add.en, tokens: add.tokens, words: add.words, grammar: add.grammar, source: 'ai', checked: add.checked === true, extra: true, added: true }
    checkWholePhrase(where, phrase, reading)
    phrase.text = joinText ? phrase.tokens.map(token => token.t).join('') : add.text
    lesson.phrases = [...(lesson.phrases ?? []), phrase]
    byId.set(String(add.id), phrase)
    changed.push({ phrase: String(add.id), before: '(added to lesson ' + add.lesson + ')', after: tokenText(phrase.tokens) })
  }
  // 2. corrections of one phrase
  for (const [id, fix] of Object.entries(corrections.phrases ?? {})) {
    const phrase = byId.get(id)
    if (!phrase) throw new Error(CORRECTIONS_FILE + ' corrects an unknown phrase ' + id)
    const before = tokenText(phrase.tokens)
    if (fix.rewrite) {
      if (fix.tokens || fix.merge || fix.words || fix.grammar) throw new Error(CORRECTIONS_FILE + ': phrase ' + id + ' is rewritten as a whole, it takes no other operation')
      const whole = { ...phrase, ...(joinText ? {} : { text: fix.rewrite.text }), ...(fix.rewrite.en ? { en: fix.rewrite.en } : {}), tokens: fix.rewrite.tokens, reading: fix.rewrite.reading, words: fix.rewrite.words, grammar: fix.rewrite.grammar }
      checkWholePhrase(CORRECTIONS_FILE + ': rewrite of phrase ' + id, whole, reading)
      Object.assign(phrase, whole, { rewritten: true })
    }
    for (const { at, ...token } of fix.tokens ?? []) { if (!phrase.tokens[at]) throw new Error(CORRECTIONS_FILE + ': phrase ' + id + ' has no token ' + at); phrase.tokens[at] = token }
    if (fix.merge) {
      const { at, count, ...token } = fix.merge
      const joined = phrase.tokens.slice(at, at + count).map(item => item.t).join('')
      if (joined !== token.t) throw new Error(CORRECTIONS_FILE + ': phrase ' + id + ' tokens ' + at + '..' + (at + count - 1) + ' are ' + joined + ', not ' + token.t)
      phrase.tokens.splice(at, count, token)
    }
    for (const [from, to] of Object.entries(fix.words ?? {})) {
      if (!(phrase.words ?? []).includes(from)) throw new Error(CORRECTIONS_FILE + ': phrase ' + id + ' does not list the word ' + from)
      phrase.words = to ? unique(phrase.words.map(word => word === from ? to : word)) : phrase.words.filter(word => word !== from)
    }
    if (fix.grammar) {
      const list = [...(phrase.grammar ?? [])]
      for (const unit of fix.grammar.remove ?? []) { if (!list.includes(unit)) throw new Error(CORRECTIONS_FILE + ': phrase ' + id + ' does not list the pattern ' + unit); list.splice(list.indexOf(unit), 1) }
      for (const unit of fix.grammar.add ?? []) { if (list.includes(unit)) throw new Error(CORRECTIONS_FILE + ': phrase ' + id + ' already lists the pattern ' + unit); list.push(unit) }
      phrase.grammar = list
    }
    changed.push({ phrase: id, before, after: tokenText(phrase.tokens) })
  }
  // 3. the lessons' own lists. A word row moves with its fields; a lesson's grammar_taught is derived from its phrases and grammar_intro (refreshReadability), so a pattern moves in grammar_intro.
  for (const move of corrections.moves ?? []) {
    const what = move.word ?? move.grammar, where = LESSON_CORRECTIONS_FILE + ': moving ' + what + ' from lesson ' + move.from + ' to lesson ' + move.to
    if (!what || (move.word && move.grammar)) throw new Error(where + ': name exactly one of word or grammar')
    const from = lessonOf(where, move.from), to = lessonOf(where, move.to)
    if (move.word) {
      const row = (from.words ?? []).find(item => item.entry === move.word)
      if (!row) throw new Error(where + ': lesson ' + move.from + ' does not list that word')
      if ((to.words ?? []).some(item => item.entry === move.word)) throw new Error(where + ': lesson ' + move.to + ' lists it already')
      from.words = from.words.filter(item => item !== row)
      to.words = [...(to.words ?? []), row]
    } else {
      if (!(from.grammar_intro ?? []).includes(move.grammar)) throw new Error(where + ': lesson ' + move.from + ' does not list that pattern')
      from.grammar_intro = from.grammar_intro.filter(id => id !== move.grammar)
      to.grammar_intro = unique([...(to.grammar_intro ?? []), move.grammar])
    }
    changed.push({ phrase: 'lesson ' + move.from, before: what + ' listed here', after: 'listed in lesson ' + move.to })
  }
  for (const removal of corrections.removals ?? []) {
    const what = removal.word ?? removal.grammar, where = LESSON_CORRECTIONS_FILE + ': removing ' + what + ' from lesson ' + removal.lesson
    if (!what || (removal.word && removal.grammar)) throw new Error(where + ': name exactly one of word or grammar')
    const lesson = lessonOf(where, removal.lesson)
    if (removal.word) {
      if (!(lesson.words ?? []).some(item => item.entry === removal.word)) throw new Error(where + ': the lesson does not list that word')
      lesson.words = lesson.words.filter(item => item.entry !== removal.word)
    } else {
      if (!(lesson.grammar_intro ?? []).includes(removal.grammar)) throw new Error(where + ': the lesson does not list that pattern')
      lesson.grammar_intro = lesson.grammar_intro.filter(id => id !== removal.grammar)
    }
    changed.push({ phrase: 'lesson ' + removal.lesson, before: what + ' listed here', after: 'removed from the list' })
  }
  for (const addition of corrections.additions ?? []) {
    const what = addition.word?.entry ?? addition.grammar, where = LESSON_CORRECTIONS_FILE + ': adding ' + what + ' to lesson ' + addition.lesson
    if (!what || (addition.word && addition.grammar)) throw new Error(where + ': name exactly one of word (a row with an entry) or grammar')
    const lesson = lessonOf(where, addition.lesson)
    if (addition.word) {
      if ((lesson.words ?? []).some(item => item.entry === what)) throw new Error(where + ': the lesson lists that word already')
      if (!addition.word.form || !addition.word.gloss) throw new Error(where + ': a word row needs form and gloss')
      lesson.words = [...(lesson.words ?? []), { status: 'word', zh: [], extra: true, ...addition.word }]
    } else {
      if ((lesson.grammar_intro ?? []).includes(what)) throw new Error(where + ': the lesson lists that pattern already')
      lesson.grammar_intro = [...(lesson.grammar_intro ?? []), what]
    }
    changed.push({ phrase: 'lesson ' + addition.lesson, before: '', after: what + ' added to the list' })
  }
  // 4. the headword's writing
  for (const [entry, map] of Object.entries(corrections.writings ?? {})) for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) for (const token of phrase.tokens) {
    if (token.w === entry && map[token.t] !== undefined) {
      changed.push({ phrase: String(phrase.id), before: token.t, after: map[token.t] })
      token.t = map[token.t]
    }
  }
  if (joinText) for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) phrase.text = phrase.tokens.map(token => token.t).join('')
  return changed
}

// ---- content gaps ----
/**
 * The content gaps of the lessons, per lesson (pure: the lessons after the corrections, the form tags of analyseForms, the first lesson that teaches each pattern):
 * patterns the lesson lists that none of its phrases use, forms used before their pattern is taught, forms a listed pattern teaches that no phrase uses, words introduced that no phrase uses.
 * Every item carries its id (the key of the accepted-gaps list) and its title (the line of the report).
 */
export function computeGaps(lessons, { tags, taught, formsOfPattern, patternTitle, wordTitle, lessonsWithoutGrammar = false }) {
  return lessons.map(lesson => {
    const mine = lesson.phrases ?? []
    const usedGrammar = new Set(mine.flatMap(p => p.grammar ?? []))
    const usedWords = new Set(mine.flatMap(p => p.words ?? []))
    const taggedForms = [...tags.values()].filter(tag => tag.lesson === lesson.number)
    const intro = lesson.grammar_intro ?? []
    const later = new Map()
    for (const tag of taggedForms) {
      const at = tag.grammar ? taught.grammar.get(tag.grammar) ?? Infinity : 0
      if (at <= lesson.number) continue
      const key = tag.form + '|' + tag.grammar
      if (!later.has(key)) later.set(key, { id: tag.form + ':' + tag.grammar, form: tag.form, pattern: patternTitle(tag.grammar), lesson: Number.isFinite(at) ? at : null, phrases: new Set() })
      later.get(key).phrases.add(tag.phrase)
    }
    const sortById = (x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0
    return {
      lesson: lesson.number,
      patternsWithoutPhrase: intro.filter(id => !usedGrammar.has(id)).map(id => ({ id, title: patternTitle(id) })).sort(sortById),
      formsTaughtLater: [...later.values()].map(item => ({ ...item, phrases: [...item.phrases].sort((x, y) => x - y) })).sort(sortById),
      formsListedUnused: intro.filter(id => formsOfPattern.has(id) && ![...formsOfPattern.get(id)].some(form => taggedForms.some(tag => tag.form === form && tag.grammar === id))).map(id => ({ id, pattern: patternTitle(id), forms: [...formsOfPattern.get(id)].sort() })).sort(sortById),
      wordsWithoutPhrase: (lesson.words ?? []).filter(row => !usedWords.has(row.entry)).map(row => ({ id: row.entry, title: wordTitle(row.entry, lesson.number) })),
      // opt-in (the Korean pack): a lesson that teaches no grammar point at all
      ...(lessonsWithoutGrammar ? { lessonWithoutGrammar: (lesson.grammar_taught ?? []).length ? [] : [{ id: 'no-grammar', title: 'teaches no grammar point' }] } : {}),
    }
  })
}

const GAP_KINDS = { pattern: 'patternsWithoutPhrase', 'form-later': 'formsTaughtLater', 'form-unused': 'formsListedUnused', word: 'wordsWithoutPhrase', 'no-grammar': 'lessonWithoutGrammar' }
/** Every gap as { lesson, kind, id } (kind: pattern, form-later, form-unused, word). */
export const gapList = gaps => gaps.flatMap(lesson => Object.entries(GAP_KINDS).flatMap(([kind, key]) => (lesson[key] ?? []).map(item => ({ lesson: lesson.lesson, kind, id: item.id }))))
/** Compares the gaps with the hand-written accepted list ([{ lesson, kind, id, reason }]): { unaccepted: gaps not in the list, stale: list entries that are no gap (or have no reason) }. */
export function checkGaps(gaps, accepted = []) {
  const key = item => item.lesson + ' ' + item.kind + ' ' + item.id
  const gapKeys = new Set(gapList(gaps).map(key)), listed = new Set(accepted.map(key))
  return {
    unaccepted: gapList(gaps).filter(item => !listed.has(key(item))),
    stale: accepted.filter(item => !gapKeys.has(key(item)) || typeof item.reason !== 'string' || !item.reason.trim()),
  }
}

/** The content gaps as markdown (docs/audits/2026-11-10-japanese-lesson-content-gaps.md); an accepted gap says so, with its reason. */
export function gapsMarkdown(pack, { language, command, lead }) {
  const reasonOf = (lesson, kind, id) => { const hit = (pack.accepted ?? []).find(item => item.lesson === lesson && item.kind === kind && item.id === id); return hit ? ' (accepted: ' + hit.reason + ')' : '' }
  const out = ['# ' + language + ' lessons: content gaps', '', 'Written by `' + command + ' --report`. ' + lead, '']
  const total = key => pack.gaps.reduce((sum, lesson) => sum + lesson[key].length, 0)
  out.push('## Totals', '',
    '- patterns a lesson says it teaches that none of its phrases use: ' + total('patternsWithoutPhrase') + ' (in ' + pack.gaps.filter(l => l.patternsWithoutPhrase.length).length + ' lessons)',
    '- forms a lesson uses whose pattern is taught only in a later lesson: ' + total('formsTaughtLater') + ' (in ' + pack.gaps.filter(l => l.formsTaughtLater.length).length + ' lessons)',
    '- forms a lesson lists that none of its phrases use: ' + total('formsListedUnused') + ' (in ' + pack.gaps.filter(l => l.formsListedUnused.length).length + ' lessons)',
    '- words a lesson introduces that none of its phrases use: ' + total('wordsWithoutPhrase') + ' (in ' + pack.gaps.filter(l => l.wordsWithoutPhrase.length).length + ' lessons)',
    '- patterns used by no phrase at all, left out of the catalog: ' + pack.skippedGrammar.length, '')
  if (pack.skippedGrammar.length) out.push('## Patterns used by no phrase (left out of the catalog)', '', ...pack.skippedGrammar.map(item => '- `' + item.id + '` ' + item.name), '')
  out.push('## Per lesson', '')
  for (const lesson of pack.gaps) {
    const lines = []
    if (lesson.patternsWithoutPhrase.length) lines.push('- Patterns taught but used by none of its phrases: ' + lesson.patternsWithoutPhrase.map(item => item.title + reasonOf(lesson.lesson, 'pattern', item.id)).join('; '))
    for (const item of lesson.formsTaughtLater) lines.push('- Form `' + item.form + '` (phrases ' + item.phrases.join(', ') + ') uses ' + item.pattern + ', taught in ' + (item.lesson ? 'lesson ' + item.lesson : 'no lesson') + reasonOf(lesson.lesson, 'form-later', item.id))
    for (const item of lesson.formsListedUnused) lines.push('- Lists ' + item.pattern + ' (forms ' + item.forms.map(f => '`' + f + '`').join(', ') + ') but no phrase uses those forms' + reasonOf(lesson.lesson, 'form-unused', item.id))
    if (lesson.wordsWithoutPhrase.length) lines.push('- Words introduced but used by none of its phrases: ' + lesson.wordsWithoutPhrase.map(item => item.title + reasonOf(lesson.lesson, 'word', item.id)).join('; '))
    if (lesson.lessonWithoutGrammar?.length) lines.push('- Teaches no grammar point' + reasonOf(lesson.lesson, 'no-grammar', 'no-grammar'))
    if (lines.length) out.push('### Lesson ' + lesson.lesson, '', ...lines, '')
  }
  if (!pack.gaps.some(lesson => Object.values(GAP_KINDS).some(key => (lesson[key] ?? []).length))) out.push('No gaps.', '')
  return out.join('\n') + '\n'
}

/** The sealed file with every label of the registry added; a sealed label is never changed. */
export function sealText(base, { REGISTRY_FILE, SEALED_FILE, command }) {
  const registry = readJson(join(base, REGISTRY_FILE), { vocabulary: {}, grammar: {} })
  const sealed = readJson(join(base, SEALED_FILE), { vocabulary: {}, grammar: {} })
  const next = { version: 1, note: 'Labels that are final: the registry may only add to them. ' + command + ' --check fails when one changes or disappears. Written by --seal, which never changes an existing pair.', vocabulary: { ...(sealed.vocabulary ?? {}) }, grammar: { ...(sealed.grammar ?? {}) } }
  for (const kind of ['vocabulary', 'grammar']) for (const [id, label] of Object.entries(registry[kind] ?? {})) {
    if (next[kind][id] !== undefined && next[kind][id] !== label) throw new Error('Sealed label of ' + id + ' would change')
    next[kind][id] = label
  }
  return JSON.stringify(next, null, 1) + '\n'
}

/** Writes the generated files that differ (or, with check, only lists them); returns the paths that were stale. */
export function writeFiles(base, files, check) {
  const stale = []
  for (const [path, text] of files) {
    const file = join(base, path)
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue
    stale.push(path)
    if (!check) writeAtomic(file, text)
  }
  return stale
}
