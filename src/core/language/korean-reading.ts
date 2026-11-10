// Korean readings: spelling -> pronunciation (the standard sound changes) -> Revised Romanization.
// A lesson word takes its official pronunciation (NIKL, via scripts/pack-ko-pronunciations.mjs); a few words that no rule gets right are in EXCEPTIONS; every other word goes through the rules.
// RR writes what is said, not the tense sounds: 학생 [학쌩] is haksaeng, so a tense initial after a final consonant is written plain.
import officialData from '../../data/korean-pronunciations.generated.json'

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
const VOWELS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ']
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

const R_INITIAL: Record<string, string> = { ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm', ㅂ: 'b', ㅃ: 'pp', ㅅ: 's', ㅆ: 'ss', ㅇ: '', ㅈ: 'j', ㅉ: 'jj', ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h' }
const R_VOWEL: Record<string, string> = { ㅏ: 'a', ㅐ: 'ae', ㅑ: 'ya', ㅒ: 'yae', ㅓ: 'eo', ㅔ: 'e', ㅕ: 'yeo', ㅖ: 'ye', ㅗ: 'o', ㅘ: 'wa', ㅙ: 'wae', ㅚ: 'oe', ㅛ: 'yo', ㅜ: 'u', ㅝ: 'wo', ㅞ: 'we', ㅟ: 'wi', ㅠ: 'yu', ㅡ: 'eu', ㅢ: 'ui', ㅣ: 'i' }
// A final is said as one of seven sounds; written as RR does at the end of a syllable.
const R_FINAL: Record<string, string> = { ㄱ: 'k', ㄴ: 'n', ㄷ: 't', ㄹ: 'l', ㅁ: 'm', ㅂ: 'p', ㅇ: 'ng' }

/** A final cluster: the part that stays and the part that moves to a following vowel (the second element of ㄺ is ㄱ: 읽어 [일거]). */
const CLUSTER: Record<string, [string, string]> = { ㄳ: ['ㄱ', 'ㅅ'], ㄵ: ['ㄴ', 'ㅈ'], ㄶ: ['ㄴ', 'ㅎ'], ㄺ: ['ㄹ', 'ㄱ'], ㄻ: ['ㄹ', 'ㅁ'], ㄼ: ['ㄹ', 'ㅂ'], ㄽ: ['ㄹ', 'ㅅ'], ㄾ: ['ㄹ', 'ㅌ'], ㄿ: ['ㄹ', 'ㅍ'], ㅀ: ['ㄹ', 'ㅎ'], ㅄ: ['ㅂ', 'ㅅ'] }
/** What a cluster is said as before a consonant or at the end of a word. */
const CLUSTER_SAID: Record<string, string> = { ㄳ: 'ㄱ', ㄵ: 'ㄴ', ㄶ: 'ㄴ', ㄺ: 'ㄱ', ㄻ: 'ㅁ', ㄼ: 'ㄹ', ㄽ: 'ㄹ', ㄾ: 'ㄹ', ㄿ: 'ㅂ', ㅀ: 'ㄹ', ㅄ: 'ㅂ' }
const NEUTRAL: Record<string, string> = { ㄲ: 'ㄱ', ㅋ: 'ㄱ', ㅅ: 'ㄷ', ㅆ: 'ㄷ', ㅈ: 'ㄷ', ㅊ: 'ㄷ', ㅌ: 'ㄷ', ㅎ: 'ㄷ', ㅍ: 'ㅂ' }
const ASPIRATED: Record<string, string> = { ㄱ: 'ㅋ', ㄷ: 'ㅌ', ㅈ: 'ㅊ', ㅂ: 'ㅍ' }
const TENSE: Record<string, string> = { ㄱ: 'ㄲ', ㄷ: 'ㄸ', ㅂ: 'ㅃ', ㅅ: 'ㅆ', ㅈ: 'ㅉ' }
const NASAL: Record<string, string> = { ㄱ: 'ㅇ', ㄷ: 'ㄴ', ㅂ: 'ㅁ' }
const PLAIN: Record<string, string> = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' }

interface Syllable { l: string; v: string; t: string; /** Said tense only because of a rule (값이 [갑씨]): RR writes it plain. */ plain?: boolean }
const isSyllable = (char: string) => { const code = char.codePointAt(0)! - 0xac00; return code >= 0 && code <= 11171 }
function split(char: string): Syllable {
  const code = char.codePointAt(0)! - 0xac00
  return { l: INITIALS[Math.floor(code / 588)], v: VOWELS[Math.floor((code % 588) / 28)], t: FINALS[code % 28] }
}

/** Words whose sound no rule gives (a ㄴ added between the parts of a compound, a word said as two): spelling -> pronunciation. Lesson words are in the official list instead. */
const EXCEPTIONS: Record<string, string> = {
  멋있다: '머딛따', 맛없다: '마덥따', 멋없다: '머덥따', 밟다: '밥따', 넓죽하다: '넙쭈카다', 몇월: '며둴', 십육: '심뉵', 백육: '뱅뉵', 천육: '천뉵',
}
const OFFICIAL: Record<string, string> = officialData as Record<string, string>
const lookup = (word: string): string | undefined => EXCEPTIONS[word] ?? OFFICIAL[word]

/** The sound of one word (a run of Hangul syllables) by the rules: liaison, ㅎ, final simplification, palatalization, nasalization, ㄹ assimilation, tensification. */
function applyRules(word: string): Syllable[] {
  const syllables = Array.from(word).map(split)
  // 십육, 백육: a ㄴ comes in before 육 after a number word that ends in a consonant (이십육 [이심뉵]).
  for (let index = 1; index < syllables.length; index++) {
    const before = syllables[index - 1]
    const here = syllables[index]
    if (here.l === 'ㅇ' && here.v === 'ㅠ' && here.t === 'ㄱ' && before.t !== '' && before.t !== 'ㅇ' && ['십', '백', '천'].includes(String.fromCodePoint(0xac00 + (INITIALS.indexOf(before.l) * 21 + VOWELS.indexOf(before.v)) * 28 + FINALS.indexOf(before.t)))) here.l = 'ㄴ'
  }
  for (let index = 0; index < syllables.length - 1; index++) {
    const cur = syllables[index]
    const next = syllables[index + 1]
    if (cur.t === '') continue
    if (next.l === 'ㅇ') {
      // A vowel follows: the final moves over to it.
      if (cur.t === 'ㅇ') continue
      let moved: string
      if (CLUSTER[cur.t]) {
        const [stays, second] = CLUSTER[cur.t]
        if (second === 'ㅎ') { moved = stays; cur.t = '' } else { cur.t = stays; moved = second === 'ㅅ' ? 'ㅆ' : second; if (second === 'ㅅ') next.plain = true }
      } else if (cur.t === 'ㅎ') { cur.t = ''; continue } else { moved = cur.t; cur.t = '' }
      if (next.v === 'ㅣ' && moved === 'ㄷ') moved = 'ㅈ'
      else if (next.v === 'ㅣ' && moved === 'ㅌ') moved = 'ㅊ'
      next.l = moved
      continue
    }
    // A consonant follows. A cluster is said as one letter (ㄺ keeps its ㄹ before ㄱ: 읽고 [일꼬]); a ㅎ goes on to the next letter or is silent.
    const raw = cur.t
    const [stay, last] = CLUSTER[raw] ?? ['', raw]
    let t = CLUSTER[raw] ? (raw === 'ㄺ' && next.l === 'ㄱ' ? 'ㄹ' : CLUSTER_SAID[raw]) : raw
    if (last === 'ㅎ') {
      t = stay
      if (next.l === 'ㅅ') next.l = 'ㅆ'
      else if (ASPIRATED[next.l]) next.l = ASPIRATED[next.l]
      else if (raw === 'ㅎ' && (next.l === 'ㄴ' || next.l === 'ㅁ')) t = 'ㄴ'
    } else if (next.l === 'ㅎ') {
      const stop = last === 'ㅈ' ? 'ㅈ' : NEUTRAL[last] ?? last
      if (ASPIRATED[stop]) {
        next.l = next.v === 'ㅣ' && last === 'ㄷ' ? 'ㅊ' : ASPIRATED[stop]
        t = stay
      }
    }
    t = NEUTRAL[t] ?? t
    if (NASAL[t] && (next.l === 'ㄴ' || next.l === 'ㅁ' || next.l === 'ㄹ')) { if (next.l === 'ㄹ') next.l = 'ㄴ'; t = NASAL[t] }
    else if ((t === 'ㅁ' || t === 'ㅇ') && next.l === 'ㄹ') next.l = 'ㄴ'
    else if (t === 'ㄴ' && next.l === 'ㄹ') t = 'ㄹ'
    else if (t === 'ㄹ' && next.l === 'ㄴ') next.l = 'ㄹ'
    else if (NASAL[t] && TENSE[next.l]) next.l = TENSE[next.l]
    cur.t = t
  }
  const last = syllables[syllables.length - 1]
  if (last) {
    if (CLUSTER[last.t]) last.t = CLUSTER_SAID[last.t]
    last.t = NEUTRAL[last.t] ?? last.t
  }
  return syllables
}

const compose = (s: Syllable) => String.fromCodePoint(0xac00 + (INITIALS.indexOf(s.l) * 21 + VOWELS.indexOf(s.v)) * 28 + FINALS.indexOf(s.t))

/** The sound of a Hangul word as Hangul syllables: 학생 -> 학쌩. */
export function pronounceKoreanWord(word: string): string {
  const known = lookup(word)
  return known ?? applyRules(word).map(compose).join('')
}

/** Revised Romanization of syllables as they are said: a tense sound that the spelling does not have is written plain (학쌩 haksaeng, but 날씨 nalssi), ㄹ before or after a ㄹ is l. */
function transliterate(syllables: Syllable[], spelled?: Syllable[]): string {
  let out = ''
  syllables.forEach((s, index) => {
    const before = syllables[index - 1]
    let initial = R_INITIAL[s.l]
    if (s.l === 'ㄹ' && before?.t === 'ㄹ') initial = 'l'
    if (s.plain && PLAIN[s.l]) initial = R_INITIAL[PLAIN[s.l]]
    else if (PLAIN[s.l] && before && before.t !== '' && spelled?.[index] && spelled[index].l === PLAIN[s.l]) initial = R_INITIAL[PLAIN[s.l]]
    out += initial + R_VOWEL[s.v] + (s.t ? R_FINAL[NEUTRAL[s.t] ?? s.t] ?? '' : '')
  })
  return out
}

/** Revised Romanization of a Hangul pronunciation exactly as given (no sound changes applied): the form the official pronunciations are compared in. */
export function romanizePronunciation(pronounced: string, spelling?: string): string {
  const parts: string[] = []
  let run: Syllable[] = []
  const flush = () => { if (run.length) { parts.push(transliterate(run, spelling && Array.from(spelling).length === run.length && Array.from(spelling).every(isSyllable) ? Array.from(spelling).map(split) : undefined)); run = [] } }
  for (const char of pronounced.replace(/\u02d0/g, '')) { if (isSyllable(char)) run.push(split(char)); else { flush(); parts.push(char) } }
  flush()
  return parts.join('')
}

/** Revised Romanization of Korean text as it is said: the rules word by word (a word is a run of Hangul between other characters), the official or listed pronunciation where the word has one. Other characters stay as written. */
export function romanizeKorean(text: string): string {
  const whole = lookup(text.trim())
  if (whole) return romanizePronunciation(whole, text.trim())
  // A bare consonant letter, as in the pattern (으)ㄹ까요, is its letter name.
  const withLetters = text.replace(/[\u3131-\u314e]/g, letter => ({ ㄹ: 'l', ㅇ: 'ng' } as Record<string, string>)[letter] ?? R_INITIAL[letter] ?? letter)
  return withLetters.replace(/[\uac00-\ud7a3]+/g, run => { const known = lookup(run); return known ? romanizePronunciation(known, run) : transliterate(applyRules(run), Array.from(run).map(split)) })
}

/** The same by the rules alone, ignoring the official list and the exceptions (what a word that is not in a lesson gets). */
export function romanizeKoreanByRules(text: string): string {
  return text.replace(/[\uac00-\ud7a3]+/g, run => transliterate(applyRules(run), Array.from(run).map(split)))
}
