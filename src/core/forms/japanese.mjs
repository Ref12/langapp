// Japanese forms: lemma + class + form id -> surface (and reading). Rules come from curriculum/japanese/forms.yaml.

const KATAKANA = /[\u30a1-\u30f6]/g
/** Hiragana for katakana, no spaces: readings and kana spellings compare on this. */
export const hira = text => String(text ?? '').replace(KATAKANA, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/\s+/g, '')

export function createJapanese(rules) {
  const lists = rules.lemmas ?? {}
  const classes = rules.classes

  /** The class tail the text ends with (longest first), or null. */
  function tailOf(cls, text) {
    const tails = classes[cls]?.tails
    if (!tails) return null
    for (const key of Object.keys(tails).sort((a, b) => b.length - a.length)) if (text.endsWith(key)) return { key, stems: tails[key] }
    return null
  }

  /** One text (the written form or the reading) in a form; null when the class lacks the form or the text lacks the class tail. */
  function apply(text, cls, formId) {
    const spec = rules.forms[formId], meta = classes[cls]
    if (!spec || !meta || !spec.group.includes(meta.group)) return null
    if (formId === 'dict') return text
    if (meta.nai_whole && (formId === 'nai' || formId === 'nakatta')) return formId === 'nai' ? meta.nai_whole : meta.nai_whole.replace(/い$/, 'かった')
    const tail = tailOf(cls, text)
    if (!tail) return null
    const template = meta.group === 'verb' ? spec : rules.templates[meta.group]?.[formId]
    if (!template) return null
    const kept = text.slice(0, text.length - tail.stems.strip)
    if (meta.group === 'verb') {
      const stem = tail.stems[template.stem]
      if (stem == null) return null
      const add = template.add === 'potential' ? meta.potential ?? 'る' : template.add === 'volitional' ? meta.volitional ?? 'う' : template.add
      return kept + stem + add
    }
    const add = typeof template.add === 'object' ? template.add[cls] : template.add
    if (add == null) return null
    if (template.stem === 'lemma') return text + add
    return kept + (tail.stems.base ?? '') + add
  }

  /** { surface, reading? } of a lemma in a form, or null. opts: { reading }. */
  function forms(lemma, cls, formId, opts = {}) {
    const surface = apply(lemma, cls, formId)
    if (surface == null) return null
    const out = { surface }
    if (opts.reading) { const reading = apply(opts.reading, cls, formId); if (reading != null) out.reading = reading }
    return out
  }

  const POS = (rules.pos ?? []).map(item => ({ ...item, re: new RegExp(item.match, 'i') }))
  const godanTails = rules.godan_tails ?? {}

  /** { class, ambiguous?, candidates? } from the dictionary form, reading and part of speech (JMdict wording). A word that is not a verb or an adjective has no class. */
  function classifyDetail(lemma, pos = '', reading = '') {
    const text = String(lemma ?? '').trim(), kana = hira(reading || '') || hira(text)
    const endsWithAny = list => (list ?? []).some(item => text.endsWith(item))
    if (pos) {
      for (const item of POS) {
        if (!item.re.test(pos)) continue
        if (item.class === 'godan') { const cls = godanTails[text.slice(-1)]; return { class: cls ?? null } }
        if (item.class === 'suru-compound') return { class: lists.suru?.includes(text) ? 'suru' : text.endsWith('する') ? 'suru-compound' : null }
        if (item.class === 'verb') break
        return { class: item.class }
      }
    }
    const verbLike = !pos || /^verb/i.test(pos)
    if (verbLike) {
      if (lists.suru?.includes(text)) return { class: 'suru' }
      if (endsWithAny(lists['godan-honorific'])) return { class: 'godan-honorific' }
      if (lists['godan-aru']?.includes(text)) return { class: 'godan-aru' }
      if (endsWithAny(lists['godan-iku'])) return { class: 'godan-iku' }
      if (text.endsWith('する') && text.length > 2) return { class: 'suru-compound' }
      if (endsWithAny(lists['kuru-suffix'])) return { class: 'kuru' }
      const last = text.slice(-1)
      if (last !== 'る' && godanTails[last]) return { class: godanTails[last] }
      if (last === 'る') {
        const before = kana.slice(-2, -1)
        if (before && !/[いきぎしじちぢにひびぴみりえけげせぜてでねへべぺめれ]/.test(before)) return { class: 'godan-ru' }
        return { class: null, ambiguous: true, candidates: ['ichidan', 'godan-ru'] }
      }
    }
    if (!pos || /keiyoushi/i.test(pos)) {
      if (pos && /yoi\/ii/i.test(pos)) return { class: 'i-adj-ii' }
      if (text.endsWith('い')) return { class: lists['i-adj-ii']?.includes(text) || endsWithAny(lists['i-adj-ii-suffix']) ? 'i-adj-ii' : 'i-adj' }
    }
    return { class: null }
  }
  const classify = (lemma, pos, reading) => classifyDetail(lemma, pos, reading).class
  return { forms, classify, classifyDetail }
}
