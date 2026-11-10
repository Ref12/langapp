// Korean forms: lemma + class + form id -> surface. Rules (class list, lemma lists, form table) come from curriculum/korean/forms.yaml.
import { FINAL, INITIAL_IEUNG, INITIAL_RIEUL, VOWEL, compose, decompose, endsInVowel, hasFinal, init, lastChar, nounEndsInVowel, stripSpaces, withFinal } from './hangul.mjs'

const A = 0, EO = 4, O = 8
const harmonyIsA = text => { const d = decompose(lastChar(text)); return !!d && (d.v === A || d.v === O) }
const yaSyllable = text => compose(INITIAL_IEUNG, harmonyIsA(text) ? VOWEL.ㅏ : VOWEL.ㅓ)

/** The stem + 아/어 for a stem that ends in an open syllable (contractions). */
function contractOpen(stem) {
  const d = decompose(lastChar(stem)), head = init(stem)
  switch (d.v) {
    case VOWEL.ㅏ: case VOWEL.ㅓ: case VOWEL.ㅐ: case VOWEL.ㅔ: case VOWEL.ㅕ: return stem
    case VOWEL.ㅗ: return head + compose(d.l, VOWEL.ㅘ)
    case VOWEL.ㅜ: return head + compose(d.l, VOWEL.ㅝ)
    case VOWEL.ㅣ: return head + compose(d.l, VOWEL.ㅕ)
    case VOWEL.ㅚ: return head + compose(d.l, VOWEL.ㅙ)
    default: return stem + yaSyllable(stem)
  }
}

const H_VOWEL = { [VOWEL.ㅏ]: VOWEL.ㅐ, [VOWEL.ㅓ]: VOWEL.ㅐ, [VOWEL.ㅑ]: VOWEL.ㅒ, [VOWEL.ㅕ]: VOWEL.ㅖ }

export function createKorean(rules) {
  const lists = rules.lemmas ?? {}
  const endsWithAny = (lemma, list = []) => list.some(item => lemma.endsWith(item))

  /** The stem followed by 아/어, contracted: the "연결 stem" (가, 봐, 마셔, 먹어, 추워, 들어, 나아, 몰라, 그래, 해, 써). */
  function ao(stem, cls, lemma) {
    switch (cls) {
      case 'hada': return lastChar(stem) === '하' ? init(stem) + '해' : stem + yaSyllable(stem)
      case 'eu-stem': {
        const d = decompose(lastChar(stem)), prev = stem.length > 1 ? stem.slice(-2, -1) : ''
        return init(stem) + compose(d.l, prev && harmonyIsA(prev) ? VOWEL.ㅏ : VOWEL.ㅓ)
      }
      case 'b-irregular': {
        const base = withFinal(stem, 0) + compose(INITIAL_IEUNG, endsWithAny(lemma, lists['b-o']) ? VOWEL.ㅗ : VOWEL.ㅜ)
        return contractOpen(base)
      }
      case 'd-irregular': { const d = decompose(lastChar(stem)); const s = init(stem) + compose(d.l, d.v, FINAL.ㄹ); return s + yaSyllable(s) }
      case 's-irregular': { const s = withFinal(stem, 0); return s + yaSyllable(s) }
      case 'h-irregular': {
        const d = decompose(lastChar(stem))
        return init(stem) + compose(d.l, H_VOWEL[d.v] ?? d.v)
      }
      case 'reu-irregular': {
        const prev = decompose(stem.slice(-2, -1))
        if (!prev) return stem
        return stem.slice(0, -2) + compose(prev.l, prev.v, FINAL.ㄹ) + compose(INITIAL_RIEUL, harmonyIsA(stem.slice(-2, -1)) ? VOWEL.ㅏ : VOWEL.ㅓ)
      }
      default: return endsInVowel(stem) ? contractOpen(stem) : stem + yaSyllable(stem)
    }
  }

  /** The stem as it stands before an ending that begins with a vowel or 으: {s, eu: an 으 is needed before a consonant-initial ending, l: the stem ends in a dropped-before-ㅅ ㄹ}. */
  function vowelStem(stem, cls, lemma) {
    void lemma
    switch (cls) {
      case 'b-irregular': return { s: withFinal(stem, 0) + compose(INITIAL_IEUNG, VOWEL.ㅜ), eu: false }
      case 's-irregular': return { s: withFinal(stem, 0), eu: true }
      case 'h-irregular': return { s: withFinal(stem, 0), eu: false }
      case 'd-irregular': { const d = decompose(lastChar(stem)); return { s: init(stem) + compose(d.l, d.v, FINAL.ㄹ), eu: true } }
      case 'l-stem': return { s: stem, eu: false, l: true }
      default: return { s: stem, eu: hasFinal(stem) }
    }
  }
  const euS = (stem, cls, lemma) => {
    const v = vowelStem(stem, cls, lemma)
    if (v.l) return withFinal(stem, 0) + '세'
    return v.s + (v.eu ? '으세' : '세')
  }
  const euL = (stem, cls, lemma) => {
    const v = vowelStem(stem, cls, lemma)
    if (v.l) return v.s
    return v.eu ? v.s + '을' : withFinal(v.s, FINAL.ㄹ)
  }
  const euB = (stem, cls) => {
    if (cls === 'l-stem') return withFinal(withFinal(stem, 0), FINAL.ㅂ)
    return endsInVowel(stem) ? withFinal(stem, FINAL.ㅂ) : stem + '습'
  }
  const euPlain = (stem, cls, lemma) => { const v = vowelStem(stem, cls, lemma); return v.l ? v.s : v.eu ? v.s + '으' : v.s }
  const euN = (stem, cls, lemma) => {
    const v = vowelStem(stem, cls, lemma)
    if (v.l) return withFinal(withFinal(stem, 0), FINAL.ㄴ)
    return v.eu ? v.s + '은' : withFinal(v.s, FINAL.ㄴ)
  }
  const pastMark = text => withFinal(text, FINAL.ㅆ)

  function copula(cls, formId, opts) {
    const table = rules.copulas?.[cls]?.forms?.[formId]
    if (!table) return null
    if (table.all) return table.all
    const vowel = opts.after ? opts.after === 'vowel' : opts.prev != null ? nounEndsInVowel(opts.prev) : false
    return vowel ? table.vowel : table.consonant
  }

  /** The surface of a lemma in a form, or null when the form does not apply to the class. opts: { after: 'vowel'|'consonant' | prev: the noun before 이다 }. */
  function forms(lemma, cls, formId, opts = {}) {
    const spec = rules.forms?.[formId]
    if (!spec || !cls) return null
    if (cls === 'copula-ida' || cls === 'copula-anida') { const text = copula(cls, formId, opts); return text == null ? null : { surface: text } }
    if (!lemma.endsWith('다') || lemma.length < 2) return null
    // Per-lemma restrictions (forms.yaml): not: lists whose words never take the form; only: the list of words that do, with via: the intransitive partner a transitive verb takes it from (켜다 -> 켜져 있어요).
    const listed = name => (lists[name] ?? []).includes(lemma)
    if ([].concat(spec.not ?? []).some(listed)) return null
    if (spec.only && !listed(spec.only)) {
      const partner = spec.via ? rules.lemma_maps?.[spec.via]?.[lemma] : undefined
      if (!partner) return null
      const partnerClass = classify(partner, 'verb')
      return partnerClass && (lists[spec.only] ?? []).includes(partner) ? forms(partner, partnerClass, formId, opts) : null
    }
    const stem = lemma.slice(0, -1)
    let body
    switch (spec.join) {
      case 'plain': body = stem; break
      case 'ao': body = ao(stem, cls, lemma); break
      case 'ao-past': body = pastMark(ao(stem, cls, lemma)); break
      case 'eu-s': body = euS(stem, cls, lemma); break
      case 'eu-l': body = euL(stem, cls, lemma); break
      case 'eu-b': body = euB(stem, cls); break
      case 'eu': body = euPlain(stem, cls, lemma); break
      case 'eu-n': body = euN(stem, cls, lemma); break
      case 'neun': body = cls === 'l-stem' ? withFinal(stem, 0) : stem; break
      default: return null
    }
    let surface = body + spec.add
    if (spec.prefix) {
      if (cls === 'hada' && stem.endsWith('하')) { const noun = init(stem); surface = (noun ? noun + ' ' : '') + spec.prefix + ao('하', cls, lemma) + spec.add }
      else surface = spec.prefix + surface
    }
    return { surface }
  }

  /** The class of a Korean verb or adjective from its dictionary form (and part of speech); null for other words. */
  function classify(lemma, pos = '') {
    const text = String(lemma ?? '').trim()
    if (text === '이다') return 'copula-ida'
    if (text === '아니다') return 'copula-anida'
    if (pos && !/verb|adjective|동사|형용사/i.test(pos)) return null
    if (!text.endsWith('다') || text.length < 2) return null
    const stem = text.slice(0, -1)
    const d = decompose(lastChar(stem))
    if (!d) return null
    if (stem.endsWith('하')) return 'hada'
    if (endsWithAny(text, lists['d-irregular'])) return 'd-irregular'
    if (endsWithAny(text, lists['s-irregular'])) return 's-irregular'
    if (d.t === FINAL.ㅂ && !endsWithAny(text, lists['b-regular'])) {
      const adjective = /descriptive|adjective|형용사/i.test(pos)
      if (adjective || endsWithAny(text, lists['b-irregular-verbs'])) return 'b-irregular'
    }
    if (d.t === FINAL.ㅎ && endsWithAny(text, lists['h-endings'])) return 'h-irregular'
    if (d.v === VOWEL.ㅡ && d.t === 0 && d.l === INITIAL_RIEUL && stem.length > 1 && !endsWithAny(text, lists['reu-regular'])) return 'reu-irregular'
    if (d.t === FINAL.ㄹ) return 'l-stem'
    if (d.v === VOWEL.ㅡ && d.t === 0) return 'eu-stem'
    return d.t === 0 ? 'regular-vowel' : 'regular-consonant'
  }

  return { forms, classify, normalise: stripSpaces }
}
