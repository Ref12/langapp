// Names for the Korean pack: Revised Romanization for label slugs, pattern names in the convention of the Japanese pack ("<noun> + 은/는") and their short texts.
// A rule gives a result only where it can be trusted; everything else comes from the authoring overlays (curriculum/korean/authoring/pack-*.json), never from a fallback.
const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
const FINAL = ['', 'k', 'kk', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lk', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'ps', 't', 'tt', 'ng', 't', 't', 'k', 't', 'p', 'h']

/** Revised Romanization letter by letter (no sound changes): only a stable spelling for label slugs, never shown to a learner. Anything but a Hangul syllable, a letter or a digit becomes a dash. */
export function slugOfKorean(text) {
  let out = ''
  for (const char of String(text)) {
    const code = char.codePointAt(0) - 0xac00
    if (code >= 0 && code <= 11171) out += INITIAL[Math.floor(code / 588)] + MEDIAL[Math.floor((code % 588) / 28)] + FINAL[code % 28]
    else out += /[A-Za-z0-9]/.test(char) ? char.toLowerCase() : '-'
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '')
}

const LATIN = { 'V/A': '<verb or adjective>', N: '<noun>', V: '<verb>', A: '<adjective>' }
// category words of the source patterns, longest first (a whole word only)
const CATEGORY = [['단위 명사', '<counter>'], ['시간 표현', '<time expression>'], ['문장 성분', '<sentence part>'], ['의문사', '<question word>'], ['형용사', '<adjective>'], ['수사', '<number>'], ['명사', '<noun>'], ['동사', '<verb>'], ['주어', '<subject>'], ['서술어', '<predicate>'], ['수량', '<quantity>'], ['금액', '<amount>'], ['연도', '<year>']]
const NOT_PLAIN = /[A-Za-z]/

/** The name of a source pattern (N이에요 / N예요, V-(으)ㄹ까요?) in the convention: English placeholders in angle brackets, Korean as written, a plus sign between the parts; null when the rule cannot give a good one (the overlay then has to). */
export function patternNameRule(pattern) {
  const text = String(pattern).trim()
  if (!/[\uac00-\ud7a3\u3130-\u318f]/.test(text)) return null
  let name = text.replace(/(^|[\s+/(;])(V\/A|N|V|A)(?=[^A-Za-z]|$)/g, (_all, before, key) => before + LATIN[key])
  for (const [word, placeholder] of CATEGORY) name = name.replace(new RegExp('(^|[\\s+/(;])' + word + '(?=[\\s+/);]|$)', 'g'), (_all, before) => before + placeholder)
  name = name.replace(/\s\/\s-(?=[\uac00-\ud7a3\u3130-\u318f(])/g, ' / ').replace(/\s*\+\s*/g, ' + ').replace(/(>)-(?=[\uac00-\ud7a3\u3130-\u318f(])/g, '$1 + ').replace(/ \+ [-~]+/g, ' + ').replace(/([\s/])-(?=[\uac00-\ud7a3\u3130-\u318f(])/g, '$1')
  name = name.replace(/(<[^>]*>) (?=[\uac00-\ud7a3\u3130-\u318f<])/g, '$1 + ').replace(/([\uac00-\ud7a3\u3130-\u318f)?]) (?=<)/g, '$1 + ').replace(/(<[^>]*>)(?=[\uac00-\ud7a3\u3130-\u318f(])/g, '$1 + ')
  name = name.replace(/\s+/g, ' ').replace(/ \+ \+ /g, ' + ').trim()
  if (NOT_PLAIN.test(name.replace(/<[^>]*>/g, ''))) return null
  return name
}

/** The short text of a name (what a list shows after "(gr.)"): its fixed Korean part with the placeholders and the plus signs dropped; null when nothing is left. */
export function shortTextRule(name) {
  const rest = String(name).replace(/<[^>]*>/g, ' ').replace(/\s\+\s/g, ' ').replace(/\s+/g, ' ').trim()
  return rest || null
}

const SHORT = { '<noun>': 'n', '<verb>': 'v', '<adjective>': 'adj', '<verb or adjective>': 'va', '<number>': 'num', '<counter>': 'ctr', '<subject>': 'subj', '<predicate>': 'pred', '<question word>': 'wh', '<time expression>': 'time', '<quantity>': 'qty', '<amount>': 'amt', '<year>': 'year', '<sentence part>': 'part', '<place>': 'place', '<name>': 'name' }
/** The label slug of a pattern name: placeholders abbreviated, Korean letter by letter in Revised Romanization. Throws on a placeholder it does not know. */
export function patternSlug(name) {
  return name.split(/(<[^>]*>)/).map(piece => {
    if (!piece.startsWith('<')) return slugOfKorean(piece)
    if (!SHORT[piece]) throw new Error('No label abbreviation for the placeholder ' + piece)
    return '-' + SHORT[piece] + '-'
  }).join('').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

/** The English part-of-speech labels of the Korean pack (one list). The lesson source mixes languages (명사, 단위 명사, counter noun, ...): every value maps to one of these. */
export const POS_LABELS = ['noun', 'verb', 'adjective', 'adverb', 'numeral', 'counter', 'pronoun', 'determiner', 'expression']
const POS_OF = {
  noun: 'noun', 명사: 'noun', 'bound noun': 'noun', verb: 'verb', 동사: 'verb', 'verb phrase': 'verb', adjective: 'adjective', 형용사: 'adjective', 'descriptive verb': 'adjective',
  adverb: 'adverb', 'interrogative adverb': 'adverb', numeral: 'numeral', number: 'numeral', 수사: 'numeral', counter: 'counter', 'counter noun': 'counter', '단위 명사': 'counter',
  pronoun: 'pronoun', 'interrogative pronoun': 'pronoun', determiner: 'determiner', expression: 'expression', phrase: 'expression', 'time expression': 'expression', 인사말: 'expression', interjection: 'expression',
}
/** The English label of a source part of speech; throws on one the list does not know. */
export function posLabel(value) {
  const label = POS_OF[String(value ?? '').trim()]
  if (!label) throw new Error('No English part-of-speech label for "' + value + '": add it to POS_OF in scripts/pack-ko-names.mjs')
  return label
}
