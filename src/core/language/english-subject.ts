// The subject of an English sentence, set aside: what grading a Japanese or Korean sentence that has no subject compares.
// A sentence with no subject says nothing about who does it, so "I study.", "You study." and "She studies." are one answer. The text is cut into its subject pronoun, the verb (with its agreement) and the rest;
// two sentences match when the rest is the same and the verbs are the same word once the agreement (am / are / is, has / have, does / do, study / studies) is set aside. No English is generated.

export type EnglishPerson = 'i' | 'you' | 'he' | 'she' | 'it' | 'we' | 'they'
const PRONOUNS: readonly string[] = ['i', 'you', 'he', 'she', 'it', 'we', 'they']
const THIRD: readonly string[] = ['he', 'she', 'it']
const ADVERBS = new Set(['always', 'usually', 'often', 'never', 'sometimes', 'also', 'just', 'really', 'still', 'already', 'only', 'not', 'probably', 'now'])
const AUX = new Set(['am', 'are', 'is', 'was', 'were', 'has', 'have', 'does', 'do', 'did', 'can', 'will', 'would', 'could', 'should', 'must', 'may', 'might', 'shall'])
/** Past forms that carry no ending, so that "she ate" and "I ate" are the same verb. */
const IRREGULAR_PAST = new Set(['ate', 'went', 'saw', 'came', 'had', 'got', 'made', 'took', 'read', 'wrote', 'bought', 'met', 'said', 'gave', 'drank', 'slept', 'ran', 'sat', 'knew', 'thought', 'found', 'told', 'felt', 'left', 'heard', 'brought', 'began', 'spoke', 'wore', 'sang', 'swam', 'won', 'lost', 'paid', 'sold', 'taught', 'forgot', 'woke', 'drove', 'rode', 'flew', 'stood', 'understood', 'cut', 'put', 'let', 'hit'])
const CONTRACTIONS: Record<string, string[]> = { "can't": ['can', 'not'], cannot: ['can', 'not'], "won't": ['will', 'not'], "shan't": ['shall', 'not'] }

/** The words of a sentence, lower case, without punctuation and with contractions opened (I'm → i am, doesn't → does not). */
export function englishWords(text: string): string[] {
  const out: string[] = []
  for (const raw of text.normalize('NFKC').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean)) {
    const word = raw.replace(/^'+|'+$/g, '')
    if (CONTRACTIONS[word]) { out.push(...CONTRACTIONS[word]); continue }
    const negative = /^(.+)n't$/.exec(word)
    if (negative) { out.push(negative[1], 'not'); continue }
    const clitic = /^(i|you|he|she|it|we|they)'(m|re|s|ve|ll|d)$/.exec(word)
    if (clitic) { out.push(clitic[1], ({ m: 'am', re: 'are', s: 'is', ve: 'have', ll: 'will', d: 'would' } as Record<string, string>)[clitic[2]]); continue }
    out.push(word)
  }
  return out
}

/** Does the verb agree with the pronoun (am with I, are with you, does with he)? Verbs that do not agree (can, will, did) always do. */
function agrees(pronoun: string, verb: string): boolean {
  const third = THIRD.includes(pronoun)
  switch (verb) {
    case 'am': return pronoun === 'i'
    case 'is': return third
    case 'are': return !third && pronoun !== 'i'
    case 'was': return pronoun === 'i' || third
    case 'were': return !third && pronoun !== 'i'
    case 'has': case 'does': return third
    case 'have': case 'do': return !third
    default: return true
  }
}
const AGREEING: Record<string, string> = { am: 'be', are: 'be', is: 'be', was: 'was', were: 'was', has: 'have', have: 'have', does: 'do', do: 'do' }

/** The verbs a word can stand for once its agreement is set aside: "studies" is study, "goes" is go; a verb that does not fit the pronoun stands for nothing but itself, marked. */
function verbs(pronoun: string, word: string): string[] {
  if (AUX.has(word)) return [agrees(pronoun, word) ? (AGREEING[word] ?? word) : `!${word}`]
  if (!THIRD.includes(pronoun)) return [word]
  if (/ies$/.test(word)) return [word.slice(0, -3) + 'y']
  if (/ed$/.test(word) || IRREGULAR_PAST.has(word)) return [word]
  if (/(s|x|z|ch|sh|o)es$/.test(word)) return [word.slice(0, -2), word.slice(0, -1)]
  if (/s$/.test(word) && !/ss$/.test(word)) return [word.slice(0, -1)]
  return [`!${word}`]
}

export interface EnglishParts { pronoun: EnglishPerson; question: boolean; verbs: string[]; rest: string[] }

/** A sentence cut at its subject pronoun; undefined when it has none (a noun subject, an imperative). */
export function englishParts(text: string): EnglishParts | undefined {
  const words = englishWords(text)
  if (words.length && PRONOUNS.includes(words[0])) {
    const pronoun = words[0] as EnglishPerson
    let at = 1
    while (at < words.length - 1 && ADVERBS.has(words[at]) && !AUX.has(words[at + 1] ?? '')) at++
    if (at >= words.length) return { pronoun, question: false, verbs: [], rest: [] }
    return { pronoun, question: false, verbs: verbs(pronoun, words[at]), rest: [...words.slice(1, at), ...words.slice(at + 1)] }
  }
  if (words.length > 1 && AUX.has(words[0]) && PRONOUNS.includes(words[1])) {
    const pronoun = words[1] as EnglishPerson
    return { pronoun, question: true, verbs: verbs(pronoun, words[0]), rest: words.slice(2) }
  }
  return undefined
}

/** The pronoun an English sentence opens with (I, you, he, she, it, we, they), when it has one. */
export const englishSubject = (text: string): EnglishPerson | undefined => englishParts(text)?.pronoun

/** Are the two sentences the same apart from their subject and the agreement that follows? Both must open with a subject pronoun. */
export function sameApartFromSubject(a: string, b: string): boolean {
  const left = englishParts(a), right = englishParts(b)
  if (!left || !right || left.question !== right.question) return false
  if (left.rest.join(' ') !== right.rest.join(' ')) return false
  return left.verbs.length === 0 ? right.verbs.length === 0 : left.verbs.some(verb => right.verbs.includes(verb))
}

/** The accepted wording the answer matches apart from the subject, when it does. Every wording of the sentence must open with a pronoun for the subject to be open; the answer too. */
export function openSubjectMatch(answer: string, accepted: readonly string[]): string | undefined {
  return accepted.find(text => sameApartFromSubject(answer, text))
}

// Chinese, Japanese and Korean mark neither articles nor number: "The student studies." and "Students study." are one answer.
const KEEP = new Set(['is', 'was', 'this', 'his', 'its', 'us', 'yes', 'as', 'has', 'does', 'always', 'perhaps', 'bus', 'gas', 'class', 'glass', 'dress', 'news', 'sometimes', 'lots', 'thanks', 'less', 'across', 'unless', 'plus', 'chinese', 'japanese', 'korean', 'series'])
const singular = (word: string): string => {
  if (AGREEING[word]) return AGREEING[word]
  if (KEEP.has(word) || word.length < 4 || /ss$/.test(word) || !/s$/.test(word)) return word
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y'
  if (/(s|x|z|ch|sh|o)es$/.test(word)) return word.slice(0, -2)
  return word.slice(0, -1)
}
/** The comparable form of an English sentence for a language without articles or number: no a/an/the, nouns and verbs in the singular, agreement (is/are, was/were, has/have, does/do) set aside. */
export const numberFreeKey = (text: string): string => englishWords(text).filter(word => !['a', 'an', 'the'].includes(word)).map(singular).join(' ')

/** Are the two sentences the same apart from articles and singular/plural (with the verb agreement that follows)? */
export const sameApartFromNumber = (a: string, b: string): boolean => { const key = numberFreeKey(a); return key !== '' && key === numberFreeKey(b) }

/** The accepted wording the answer matches apart from articles and number, when it does. */
export const numberFreeMatch = (answer: string, accepted: readonly string[]): string | undefined => accepted.find(text => sameApartFromNumber(answer, text))

const restKey = (rest: readonly string[]): string => rest.filter(word => !['a', 'an', 'the'].includes(word)).map(singular).join(' ')
/** Same apart from the subject pronoun, articles and number (an implied-subject sentence of a language without number). */
export function sameApartFromSubjectAndNumber(a: string, b: string): boolean {
  const left = englishParts(a), right = englishParts(b)
  if (!left || !right || left.question !== right.question || restKey(left.rest) !== restKey(right.rest)) return false
  return left.verbs.length === 0 ? right.verbs.length === 0 : left.verbs.some(verb => right.verbs.includes(verb))
}
export const openNumberFreeMatch = (answer: string, accepted: readonly string[]): string | undefined => accepted.find(text => sameApartFromSubjectAndNumber(answer, text))
