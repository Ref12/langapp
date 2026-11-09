// The forms engine over a rules object (curriculum/<language>/forms.yaml as JSON): forms(), analyse(), classify(), irregular().
import { createJapanese, hira } from './japanese.mjs'
import { createKorean } from './korean.mjs'
import { endsInVowel, stripSpaces } from './hangul.mjs'

export const formItemId = (language, lemma, formId) => language + ':f:' + lemma + ':' + formId

export function createForms(rules) {
  const language = rules.language
  const impl = language === 'ja' ? createJapanese(rules) : createKorean(rules)
  const classes = rules.classes
  const copulaClass = cls => cls === 'copula-ida' || cls === 'copula-anida'

  /** Form ids that apply to a class, in the order of the rules file. */
  function formIds(cls) {
    const meta = classes[cls]
    if (!meta) return []
    return Object.keys(rules.forms).filter(id => language === 'ja'
      ? rules.forms[id].group.includes(meta.group)
      : copulaClass(cls) ? !!rules.copulas[cls].forms[id] : true)
  }

  /** The surface (and for Japanese the reading) of a lemma of a class in a form; null when the form does not apply. opts: { reading } for Japanese; { after | prev } for the Korean copula. */
  const forms = (lemma, cls, formId, opts = {}) => impl.forms(lemma, cls, formId, opts)

  const same = (a, b) => language === 'ja' ? hira(a) === hira(b) : stripSpaces(a) === stripSpaces(b)

  /** The form ids whose surface (or kana reading) equals the text. */
  function analyse(surface, lemma, cls, opts = {}) {
    const found = []
    const variants = language === 'ko' && cls === 'copula-ida' && !opts.after && opts.prev == null ? [{ after: 'vowel' }, { after: 'consonant' }] : [opts]
    for (const id of formIds(cls)) {
      for (const variant of variants) {
        const result = forms(lemma, cls, id, { ...opts, ...variant })
        if (!result) continue
        if (same(result.surface, surface) || (result.reading && same(result.reading, surface))) { found.push(id); break }
      }
    }
    return found
  }

  const grammarOf = (formId, cls) => {
    const grammar = rules.forms[formId]?.grammar
    if (grammar == null || typeof grammar === 'string') return grammar ?? null
    return grammar[cls] ?? grammar[classes[cls]?.group] ?? grammar.default ?? null
  }

  /** The class the irregular class would be if it were regular (Korean: by the stem's last sound). */
  function baselineOf(lemma, cls) {
    const base = classes[cls]?.baseline
    if (!base) return null
    if (language === 'ko' && (base === 'regular-consonant' || base === 'regular-vowel')) return endsInVowel(lemma.slice(0, -1)) ? 'regular-vowel' : 'regular-consonant'
    return base
  }

  /** Is this form of the lemma an irregular form (its surface or reading differs from what the regular class would build), and does the class keep items for it? */
  function irregular(lemma, cls, formId, opts = {}) {
    const meta = classes[cls]
    if (!meta?.irregular || meta.itemised === false) return false
    const base = baselineOf(lemma, cls)
    if (!base) return false
    const actual = forms(lemma, cls, formId, opts), plain = forms(lemma, base, formId, opts)
    if (!actual || !plain) return !!actual && !plain
    return actual.surface !== plain.surface || (actual.reading ?? '') !== (plain.reading ?? '')
  }

  return { language, forms, analyse, formIds, grammarOf, irregular, classify: impl.classify, classifyDetail: impl.classifyDetail ?? ((lemma, pos) => ({ class: impl.classify(lemma, pos) })), rules }
}
