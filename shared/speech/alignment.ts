import type { AssessmentWord, SpeechLocale } from './assessment'

interface Token { text: string; key: string; word: number }

function tokenize(text: string, locale: SpeechLocale, word: number): Token[] {
  // Japanese/Chinese do not delimit words with spaces, and Azure word boundaries
  // need not match the reference's. Compare characters there, words elsewhere.
  const pattern = locale === 'ja-JP' || locale === 'zh-CN'
    ? /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])[\p{L}\p{M}\p{N}])+(?:['’][\p{Script=Latin}]+)*/gu
    : /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu
  return Array.from(text.normalize('NFKC').matchAll(pattern), match => ({
    text: match[0], key: match[0].toLocaleLowerCase(locale).replace(/’/g, "'"), word,
  }))
}

/** Text alignment only: never synthesize acoustic scores for omitted/split words. */
export function alignAssessmentWords(
  reference: string, words: AssessmentWord[], locale: SpeechLocale,
): AssessmentWord[] | undefined {
  const expected = tokenize(reference, locale, -1)
  const actual = words.flatMap((word, index) => tokenize(word.text, locale, index))
  // Bound quadratic work for malformed/unusually large service responses.
  if (!expected.length || !actual.length || (expected.length + 1) * (actual.length + 1) > 4_000_000) return
  const width = actual.length + 1
  const lengths = new Uint16Array((expected.length + 1) * width)
  for (let i = expected.length - 1; i >= 0; i--) {
    for (let j = actual.length - 1; j >= 0; j--) {
      lengths[i * width + j] = expected[i].key === actual[j].key
        ? 1 + lengths[(i + 1) * width + j + 1]
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
    }
  }
  const aligned: { token: Token; kind: 'match' | 'Omission' | 'Insertion' }[] = []
  let i = 0
  let j = 0
  while (i < expected.length || j < actual.length) {
    if (i < expected.length && j < actual.length && expected[i].key === actual[j].key) {
      aligned.push({ token: actual[j++], kind: 'match' })
      i++
    } else if (i < expected.length && (j === actual.length ||
      lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) {
      aligned.push({ token: expected[i++], kind: 'Omission' })
    } else {
      aligned.push({ token: actual[j++], kind: 'Insertion' })
    }
  }
  const counts = new Map<number, number>()
  for (const token of actual) counts.set(token.word, (counts.get(token.word) ?? 0) + 1)
  const result: AssessmentWord[] = []
  for (let start = 0; start < aligned.length;) {
    const first = aligned[start]
    let end = start + 1
    // Reassemble provider words, preserving their scores only when still whole.
    while (end < aligned.length && aligned[end].kind === first.kind &&
      aligned[end].token.word === first.token.word &&
      (first.kind !== 'Omission' || locale === 'ja-JP' || locale === 'zh-CN')) end++
    const whole = first.kind !== 'Omission' && end - start === counts.get(first.token.word)
    const entry: AssessmentWord = whole ? { ...words[first.token.word] } : {
      text: aligned.slice(start, end).map(item => item.token.text).join(''),
    }
    if (entry.text.length > 1000 || result.length === 5000) return
    if (first.kind !== 'match') entry.errorType = first.kind
    result.push(entry)
    start = end
  }
  return result
}
