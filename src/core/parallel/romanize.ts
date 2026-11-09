// Revised Romanization of Korean, syllable by syllable (no sound-change rules): a reading aid, shown only when the learner turns it on.
const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
const FINAL = ['', 'k', 'kk', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lk', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'ps', 't', 'tt', 'ng', 't', 't', 'k', 't', 'p', 'h']

export function romanizeKorean(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0)! - 0xac00
    if (code < 0 || code > 11171) { out += char; continue }
    out += INITIAL[Math.floor(code / 588)] + MEDIAL[Math.floor((code % 588) / 28)] + FINAL[code % 28]
  }
  return out
}
