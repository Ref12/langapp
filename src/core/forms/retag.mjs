// Re-tags parallel phrases with word forms, by code: a lexical token (w) whose lemma has a class gets the form that produces its surface.
// A word's ending may be written as separate tokens (勉強し + ます, 공부하 + 세요): the form is looked for over the token and the tokens after it.
import { formItemId } from './engine.mjs'

const MAX_FOLLOWING = 3
const isLetter = text => /[\p{L}\p{N}]/u.test(text)

/** Every entry as written in its source (a word normally written in kana keeps its kanji form: 行く, 来る), reference then parallel-authored: Map id -> { target, reading, pos }. */
export function rawVocabulary(references, entries) {
  const out = new Map()
  for (const [id, entry] of references.vocabulary) out.set(id, { target: entry.target, reading: entry.reading ?? '', pos: entry.pos ?? '' })
  for (const entry of entries.vocabulary ?? []) out.set(entry.id, { target: entry.target, reading: entry.reading ?? '', pos: entry.part_of_speech ?? '' })
  return out
}

/** Classes of the entries: Map id -> { class, ambiguous?, candidates? } for every entry with an inflecting class (or an ambiguous one). overrides: { 'target': class }. */
export function classifyEntries(engine, vocabulary, overrides = {}) {
  const out = new Map()
  for (const [id, entry] of vocabulary) {
    const key = entry.target + '|' + (entry.reading ?? '')
    const forced = overrides[key] ?? overrides[entry.target]
    if (forced) { out.set(id, { class: forced, override: true }); continue }
    const detail = engine.classifyDetail(entry.target, entry.pos ?? '', entry.reading ?? '')
    if (detail.class || detail.ambiguous) out.set(id, detail)
  }
  return out
}

/** The noun part of a lemma that is a noun + する / 하다 (勉강), or null. */
export function nounStem(language, lemma) {
  if (language === 'ja' && lemma.endsWith('する') && lemma.length > 2) return lemma.slice(0, -2)
  if (language === 'ko' && lemma.endsWith('하다') && lemma.length > 2) return lemma.slice(0, -2)
  return null
}

/** The lemmas a token may be an inflection of: the entry's own, then the bare する / 하다 (a noun written as its own token) and the verb after the object of a phrase lemma (수업을 듣다, 雨が降る). */
export function lemmaCandidates(engine, lemma, cls, reading) {
  const language = engine.language
  const out = [{ lemma, cls, reading }]
  if (nounStem(language, lemma)) out.push(language === 'ja' ? { lemma: 'する', cls: 'suru', reading: 'する' } : { lemma: '하다', cls: 'hada', reading: '' })
  let tail = null
  if (language === 'ko' && lemma.includes(' ')) tail = lemma.slice(lemma.lastIndexOf(' ') + 1)
  if (language === 'ja') for (const particle of ['が', 'を', 'に', 'で']) { const at = lemma.lastIndexOf(particle); if (at >= 1 && at < lemma.length - 2) { tail = lemma.slice(at + 1); break } }
  if (tail && tail !== lemma) { const tailClass = engine.classify(tail, language === 'ko' ? 'verb' : '', ''); if (tailClass) out.push({ lemma: tail, cls: tailClass, reading: '' }) }
  return out
}

/**
 * Looks at every phrase of the lessons. Returns:
 *   tagged: [{ lesson, phrase, token (index), id (entry), lemma, formLemma, class, form, span (following tokens in the form), surface, grammar, item }]
 *   ambiguous: [{ lesson, phrase, token, lemma, surface, forms }]
 *   unmatched: [{ lesson, phrase, token, lemma, class, written, surface, text, candidates: [{ form, k, expected }] }]
 *   nominal: tokens that are the noun part of a suru / hada word; head: tokens that are the first word of a phrase lemma (수업 of 수업을 듣다); bare: tokens that are the bare word of a な-adjective or noun-like word (no ending)
 */
export function analysePhrases(engine, lessons, vocabulary, classes) {
  const language = engine.language
  const tagged = [], ambiguous = [], unmatched = []
  let nominal = 0, bare = 0, head = 0
  for (const lesson of lessons) for (const phrase of lesson.phrases ?? []) {
    const tokens = phrase.tokens ?? []
    tokens.forEach((token, index) => {
      if (language === 'ko' && (token.g === 'ko-topik1-g001' || token.g === 'ko-topik1-g002') && !token.w && index > 0) {
        const cls = token.g === 'ko-topik1-g001' ? 'copula-ida' : 'copula-anida', lemma = cls === 'copula-ida' ? '이다' : '아니다'
        const forms = engine.analyse(token.t, lemma, cls, { prev: tokens[index - 1].t })
        if (forms.length === 1) tagged.push({ lesson: lesson.number, phrase: phrase.id, token: index, id: null, lemma, formLemma: lemma, formClass: cls, formReading: '', class: cls, form: forms[0], span: 0, surface: token.t, grammar: engine.grammarOf(forms[0], cls), item: null })
        else if (forms.length > 1) ambiguous.push({ lesson: lesson.number, phrase: phrase.id, token: index, lemma, surface: token.t, forms })
        else unmatched.push({ lesson: lesson.number, phrase: phrase.id, token: index, lemma, class: cls, written: token.t, surface: tokens.slice(index - 1, index + 1).map(item => item.t).join(' | '), text: phrase.text, candidates: [] })
        return
      }
      if (!token.w) return
      const info = classes.get(token.w)
      if (!info?.class) return
      const entry = vocabulary.get(token.w)
      const before = tokens[index - 1]
      const tried = []
      for (const candidate of lemmaCandidates(engine, entry.target, info.class, entry.reading ?? '')) {
        const opts = language === 'ja' && candidate.reading ? { reading: candidate.reading } : {}
        let best = null
        for (let k = 0; k <= MAX_FOLLOWING; k++) {
          const span = tokens.slice(index, index + 1 + k)
          if (span.length < 1 + k) break
          if (k > 0 && span.slice(1).some(item => !isLetter(item.t))) break
          const hasWord = span.slice(1).some(item => item.w)
          const surface = span.map(item => item.t).join('')
          let forms = engine.analyse(surface, candidate.lemma, candidate.cls, opts)
          if (language === 'ko' && before && before.t === '안' && !before.w) {
            const withNot = engine.analyse('안' + surface, candidate.lemma, candidate.cls, opts).filter(id => id === 'an-neg')
            forms = withNot.length ? withNot : forms.filter(id => id !== 'an-neg')
          } else forms = forms.filter(id => id !== 'an-neg')
          if (hasWord) forms = forms.filter(id => engine.rules.forms[id]?.multiword)
          if (forms.length) best = { k, surface, forms }
        }
        tried.push(candidate)
        if (!best) continue
        if (best.forms.length > 1) { ambiguous.push({ lesson: lesson.number, phrase: phrase.id, token: index, lemma: entry.target, surface: best.surface, forms: best.forms }); return }
        const form = best.forms[0]
        const item = engine.irregular(candidate.lemma, candidate.cls, form, opts)
        tagged.push({ lesson: lesson.number, phrase: phrase.id, token: index, id: token.w, lemma: entry.target, formLemma: candidate.lemma, formClass: candidate.cls, formReading: candidate.reading ?? '', class: info.class, form, span: best.k, surface: best.surface, grammar: engine.grammarOf(form, candidate.cls), item: item ? formItemId(language, candidate.lemma, form) : null })
        return
      }
      const written = token.t
      const stem = nounStem(language, entry.target)
      if (stem && (written === stem || written.startsWith(stem))) { nominal++; return }
      const group = engine.rules.classes[info.class]?.group
      if (written === entry.target || written === entry.reading || group === 'copula') { bare++; return }
      if (!stem && entry.target.length > written.length && entry.target.includes(written)) { head++; return }
      const candidates = []
      for (let k = 1; k <= MAX_FOLLOWING; k++) {
        const next = tokens[index + k]
        if (!next || !next.g) break
        for (const form of engine.formIds(info.class)) if (engine.grammarOf(form, info.class) === next.g) candidates.push({ form, k, expected: engine.forms(entry.target, info.class, form, language === 'ja' ? { reading: entry.reading } : {})?.surface })
      }
      unmatched.push({ lesson: lesson.number, phrase: phrase.id, token: index, lemma: entry.target, class: info.class, written, surface: tokens.slice(index, index + 3).map(item => item.t).join(' | '), text: phrase.text, candidates })
    })
  }
  return { tagged, ambiguous, unmatched, nominal, bare, head }
}
