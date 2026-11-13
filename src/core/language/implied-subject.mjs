// Which Japanese and Korean sentences state no subject. Decided from the tokens (word ids and grammar tags), never from the raw text:
// a sentence has a subject when a person or pronoun word is followed by the topic or subject particle (私は, 彼女が, 저는, 학생이). A time or place topic (木曜日は) is not a subject.
// Shared by the pack generators (they write the flag into the phrase bank), scripts/mark-implied-subject.mjs and the app (a sentence without the flag, such as a catalog example, is decided here).

/** @typedef {{ word?: string, grammar?: string, punctuation?: string, text?: string, reading?: string, form?: string }} Token */
/** @typedef {'ja' | 'ko'} SubjectLanguage */

/** The word ids (before the "--") of people and pronouns that can be the subject. */
const PEOPLE = {
  ja: new Set(['watashi', 'watashitachi', 'anata', 'kare', 'kanojo', 'kanojotachi', 'sorera', 'minasan', 'minna', 'dare', 'hito', 'otoko', 'onna', 'sensei', 'gakusei', 'daigakusei', 'shougakusei', 'doukyuusei', 'tomodachi', 'kodomo', 'kazoku', 'haha', 'otousan', 'oniisan', 'ane', 'otouto', 'imouto', 'musume', 'musuko', 'isha', 'san']),
  ko: new Set(['jeo', 'uri', 'nugu', 'geudeul', 'saram', 'geu-saram', 'myeong', 'yeoreobun', 'haksaeng', 'daehaksaeng', 'junghaksaeng', 'seonsaengnim', 'chingu', 'ban-chingu', 'yeojachingu', 'namjachingu', 'ai', 'gajok', 'ttal', 'adeul', 'uisa', 'eomma', 'appa', 'eonni', 'oppa', 'hyeong', 'namdongsaeng', 'yeodongsaeng', 'yeoja', 'ireum-ssi']),
}
/** The pronouns among them: a sentence that differs from another only by one of these as its subject differs only in who does it (a noun subject such as 学生は is another meaning). */
const PRONOUNS = {
  ja: new Set(['watashi', 'watashitachi', 'anata', 'kare', 'kanojo', 'kanojotachi', 'minasan']),
  ko: new Set(['jeo', 'uri', 'geudeul', 'geu-saram', 'yeoreobun']),
}
/** "He" in Korean is the word 그, which the data tags like the demonstrative: only at the start of the sentence. */
const BARE_PRONOUN = { ja: new Set(), ko: new Set(['geu--before']) }
/** The tags of the topic and subject particles (は, が; 은/는, 이/가). */
const SUBJECT_PARTICLES = {
  ja: { tags: new Set(['n-wa--topic', 'n-ga--subject', 'n-wa--what-about']), texts: new Set(['は', 'が']) },
  ko: { tags: new Set(['n-eun-neun--as', 'n-i-ga--n']), texts: new Set(['은', '는', '이', '가']) },
}
/** A plural ending: Japanese たち only follows people; Korean 들 follows the word before it. */
const PLURAL = { ja: { tag: 'n-tachi--add', alone: true }, ko: { tag: 'n-deul--plural', alone: false } }
const base = id => String(id).split('--')[0]
const isSpace = token => token.punctuation !== undefined && token.punctuation.trim() === ''
const isPerson = (language, token, first, pronounsOnly) => !!token && token.word !== undefined && ((pronounsOnly ? PRONOUNS : PEOPLE)[language].has(base(token.word)) || (first && BARE_PRONOUN[language].has(token.word)))

/**
 * Where the first subject (person or pronoun followed by the subject or topic particle) sits: the index range [from, to] in the tokens, particle included; undefined when there is none.
 * @param {SubjectLanguage} language
 * @param {readonly Token[] | undefined} tokens
 * @param {boolean} [pronounsOnly] only a pronoun counts as the subject
 * @returns {{ from: number, to: number } | undefined}
 */
export function subjectSpan(language, tokens, pronounsOnly = false) {
  const rule = SUBJECT_PARTICLES[language]
  const list = tokens ?? []
  for (let at = 1; at < list.length; at++) {
    const token = list[at]
    if (!token.grammar || !rule.tags.has(token.grammar) || !rule.texts.has(token.text ?? '')) continue
    let from = at - 1
    while (from > 0 && isSpace(list[from])) from--
    if (list[from].grammar === PLURAL[language].tag) {
      if (PLURAL[language].alone) { return { from: Math.max(0, from - 1), to: at } }
      from--
      while (from > 0 && isSpace(list[from])) from--
    }
    const first = list.slice(0, from).every(isSpace)
    if (isPerson(language, list[from], first, pronounsOnly)) return { from, to: at }
  }
  return undefined
}

/** Does the token list name a person or pronoun as its subject or topic? */
export const hasSubject = (language, tokens) => subjectSpan(language, tokens) !== undefined
/** True when the sentence states no subject, so its English subject is open. */
export const impliedSubject = (language, tokens) => !hasSubject(language, tokens)

const keyOf = token => [token.word ?? '', token.grammar ?? '', token.punctuation ?? '', token.form ?? '', token.text ?? ''].join('|')
/** The sentence as a list of token keys (spaces left out), for comparing two sentences by their words and endings. */
export const tokenKeys = tokens => (tokens ?? []).filter(token => !isSpace(token)).map(keyOf)
/** The token keys of the sentence with its first pronoun subject taken out; undefined when it has none. */
export function keysWithoutSubject(language, tokens) {
  const span = subjectSpan(language, tokens, true)
  if (!span) return undefined
  return tokenKeys([...(tokens ?? []).slice(0, span.from), ...(tokens ?? []).slice(span.to + 1)])
}
