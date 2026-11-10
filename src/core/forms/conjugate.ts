import { formsEngine, formItemId, type BuiltForm, type FormOptions, type FormsLanguage } from './index'
import { hira } from './japanese.mjs'

// Word forms in practice, for the engine (src/core/language/word-forms.ts asks these) (the older parallel screens are gone):
// which forms are taught, the Conjugate exercise (graded against forms()), the rule line and the Form to meaning exercise. They take plain records, not the parallel data shapes.

/** Verbs and adjectives only: the copulas and nouns take no part in the conjugation exercises. */
export const conjugable = (cls: string | undefined): cls is string => !!cls && !cls.startsWith('copula') && cls !== 'noun'

/** The form ids of a class whose grammar point the lessons up to N have taught (the dictionary form and forms without a grammar point never count). */
export function taughtFormIds(language: FormsLanguage, cls: string, grammar: ReadonlySet<string>): string[] {
  const engine = formsEngine(language)
  return engine.formIds(cls).filter(id => {
    if (id === 'dict') return false
    const point = engine.grammarOf(id, cls)
    return point != null && grammar.has(point)
  })
}

/** A short meaning for an option: the lesson gloss, else the first sense of the definition without notes. */
export const shortOf = (entry: { english: string; gloss?: string }): string => {
  const first = (entry.gloss ?? entry.english.split(/ \| | \/ /)[0].replace(/^1\.\s*/, '')).replace(/\s*[[(][^\])]*[\])]\s*$/, '').replace(/\.$/, '').trim()
  return first.length > 40 ? first.slice(0, 37).replace(/\s+\S*$/, '') + '\u2026' : first
}

export const formLabel = (language: FormsLanguage, formId: string): string => formsEngine(language).rules.forms[formId]?.label ?? formId

const KO_JOIN: Record<string, string> = { plain: '', ao: '\uC544/\uC5B4', 'ao-past': '\uC558/\uC5C8', 'eu-s': '(\uC73C)\uC138', 'eu-l': '(\uC73C)\u3139', 'eu-b': '(\uC73C)\u3142', eu: '(\uC73C)', 'eu-n': '(\uC73C)\u3134', neun: '' }

/** The rule of a form in one line, e.g. "godan く: く → き + ます" (Japanese) or "stem + 아/어 + 요" (Korean). */
export function ruleLine(language: FormsLanguage, lemma: string, cls: string, formId: string): string {
  const engine = formsEngine(language), rules = engine.rules
  const spec = rules.forms[formId], meta = rules.classes[cls]
  if (!spec || !meta) return formLabel(language, formId)
  if (language === 'ko') {
    const add = (spec.prefix ? spec.prefix.trim() + ' + ' : '') + 'stem' + (KO_JOIN[spec.join ?? ''] ? ' + ' + KO_JOIN[spec.join ?? ''] : '') + (spec.add && spec.add.trim() ? ' + ' + spec.add.trim() : '')
    return (meta.description ? meta.description.split(/[;(]/)[0].trim() + ': ' : '') + add
  }
  const keys = Object.keys(meta.tails ?? {}).sort((a, b) => b.length - a.length)
  const key = keys.find(item => lemma.endsWith(item))
  if (!key) return spec.label
  let to: string | undefined, add: string | undefined
  if (meta.group === 'verb') {
    to = meta.tails![key][spec.stem ?? '']
    add = spec.add === 'potential' ? meta.potential ?? '\u308B' : spec.add === 'volitional' ? meta.volitional ?? '\u3046' : spec.add
  } else {
    const template = rules.templates?.[meta.group ?? '']?.[formId]
    if (!template) return spec.label
    add = typeof template.add === 'object' ? template.add[cls] : template.add
    to = template.stem === 'lemma' ? key : meta.tails![key].base ?? ''
  }
  if (to == null || add == null) return spec.label
  const name = meta.irregular ? (meta.description ?? cls).split(/[:(]/)[0].trim() : cls.startsWith('godan-') ? 'godan ' + key : cls === 'i-adj' || cls === 'i-adj-ii' ? 'i-adjective' : cls === 'na-adj' ? 'na-adjective' : cls
  const change = to === key ? 'keep ' + key : to === '' ? 'drop ' + key : key + ' \u2192 ' + to
  return name + ': ' + change + (add ? ' + ' + add : '')
}

/** The ending a form adds, when the rules say it as text. */
function endingOf(language: FormsLanguage, cls: string, formId: string): string {
  const rules = formsEngine(language).rules, spec = rules.forms[formId], meta = rules.classes[cls]
  if (!spec) return ''
  if (language === 'ko') return spec.add ?? ''
  if (meta?.group === 'verb') return spec.add === 'potential' ? meta.potential ?? '\u308B' : spec.add === 'volitional' ? meta.volitional ?? '\u3046' : spec.add ?? ''
  const add = rules.templates?.[meta?.group ?? '']?.[formId]?.add
  return typeof add === 'object' ? add[cls] ?? '' : add ?? ''
}

/** The pieces of a built form: what it keeps of the lemma, what changes, and the ending (at least two pieces). */
export function splitPieces(lemma: string, surface: string, ending: string): string[] {
  let common = 0
  while (common < lemma.length && common < surface.length && lemma[common] === surface[common]) common++
  const pieces: string[] = []
  if (common) pieces.push(surface.slice(0, common))
  const rest = surface.slice(common)
  if (ending && rest.length > ending.length && rest.endsWith(ending)) pieces.push(rest.slice(0, rest.length - ending.length), ending)
  else if (rest) pieces.push(rest)
  if (pieces.length < 2 && surface.length > 1) return [surface.slice(0, -1), surface.slice(-1)]
  return pieces
}

const KANJI = /[\u3400-\u9fff]/u
/** The reading of each Japanese piece: kana is its own reading, a kanji piece takes what is left of the form's reading. */
function pieceReadings(language: FormsLanguage, pieces: string[], reading?: string): (string | undefined)[] {
  if (language !== 'ja' || !reading) return pieces.map(() => undefined)
  return pieces.map((piece, index) => {
    if (!KANJI.test(piece)) return undefined
    const after = pieces.slice(index + 1).join('')
    return KANJI.test(after) ? undefined : reading.slice(0, Math.max(0, reading.length - after.length))
  })
}

export interface ConjugateBuild {
  lemma: string; lemmaReading?: string; cls: string; formId: string; label: string
  answer: BuiltForm; pieces: string[]; pieceReadings: (string | undefined)[]; distractors: string[]
  rule: string; irregular: boolean
}

/** The Conjugate exercise of a lemma in a form: pieces of the answer from forms(), distractor endings from other taught forms (and, for an irregular form, the pieces the regular rule would give). */
export function buildConjugate(language: FormsLanguage, lemma: string, cls: string, formId: string, opts: { reading?: string; taught: readonly string[] }): ConjugateBuild | undefined {
  const engine = formsEngine(language)
  const options: FormOptions = opts.reading ? { reading: opts.reading } : {}
  const answer = engine.forms(lemma, cls, formId, options)
  if (!answer) return undefined
  const pieces = splitPieces(lemma, answer.surface, endingOf(language, cls, formId))
  const taken = new Set(pieces)
  const distractors: string[] = []
  const add = (piece: string | undefined) => { if (piece && !taken.has(piece) && distractors.length < 3) { taken.add(piece); distractors.push(piece) } }
  for (const other of opts.taught) {
    if (other === formId) continue
    const built = engine.forms(lemma, cls, other, options)
    if (built && built.surface !== answer.surface) add(splitPieces(lemma, built.surface, endingOf(language, cls, other)).at(-1))
    if (distractors.length >= 2) break
  }
  const irregular = engine.irregular(lemma, cls, formId, options)
  const base = engine.rules.classes[cls]?.baseline
  if (irregular && base) {
    const wrong = engine.forms(lemma, base, formId, options)
    if (wrong && wrong.surface !== answer.surface) for (const piece of splitPieces(lemma, wrong.surface, endingOf(language, base, formId))) add(piece)
  }
  return { lemma, lemmaReading: opts.reading, cls, formId, label: formLabel(language, formId), answer, pieces, pieceReadings: pieceReadings(language, pieces, answer.reading), distractors, rule: ruleLine(language, lemma, cls, formId), irregular }
}

export type ConjugateResult = 'right' | 'almost' | 'wrong'
const noSpaces = (text: string) => text.normalize('NFC').replace(/\s+/g, '')
/** Grades a built form exactly against forms(): the surface (for Japanese the kana reading counts too). Korean only: the same letters with different spacing is "almost". */
export function gradeConjugate(language: FormsLanguage, given: string, expected: BuiltForm): ConjugateResult {
  const text = given.normalize('NFC')
  if (text === expected.surface.normalize('NFC')) return 'right'
  if (language === 'ja') return expected.reading && hira(text) === hira(expected.reading) ? 'right' : 'wrong'
  return noSpaces(text) === noSpaces(expected.surface) ? 'almost' : 'wrong'
}

// ---- Dictionary table ------------------------------------------------------------------------------------------------------------

export interface FormRow { formId: string; label: string; surface: string; reading?: string; taught: boolean; irregular: boolean }
/** The word-forms table of a verb or adjective: one row per form id of its class in the rules, forms the learner has been taught first (rules order inside each group). */
export function wordFormsTable(language: FormsLanguage, lemma: string, cls: string, reading: string | undefined, taught: ReadonlySet<string>): FormRow[] {
  const engine = formsEngine(language)
  const options: FormOptions = reading ? { reading } : {}
  const rows: FormRow[] = []
  for (const formId of engine.formIds(cls)) {
    const built = engine.forms(lemma, cls, formId, options)
    if (!built) continue
    const point = engine.grammarOf(formId, cls)
    rows.push({ formId, label: formLabel(language, formId), surface: built.surface, reading: built.reading, taught: point != null && taught.has(point), irregular: engine.irregular(lemma, cls, formId, options) })
  }
  return [...rows.filter(row => row.taught), ...rows.filter(row => !row.taught)]
}

// ---- Form to meaning -------------------------------------------------------------------------------------------------------------

/** A word that inflects, as the form questions need it: its id, written form and reading, class, a short meaning and (when the learner reads it in another form) how it is shown. */
export interface FormWord { id: string; lemma: string; reading?: string; cls: string; gloss: string; /** The text and reading shown for the word in the options (the learner's display form); absent: the lemma and reading. */ shown?: { text: string; reading?: string } }
export interface FormOption { lemma: string; reading?: string; gloss: string; label: string; formId: string }
export interface FormPickBuild { surface: string; reading?: string; entryId: string; cls: string; formId: string; options: FormOption[]; answer: number; rule: string; phrase?: { text: string; en: string } }

/** Form to meaning: the inflected form and four lemma-and-form options (the right one, the same word in other forms, other words in the same form). */
export function buildFormPickFor(language: FormsLanguage, target: FormWord, formId: string, pool: readonly FormWord[], rng: () => number, phrase?: { text: string; en: string }, allowed?: readonly string[]): FormPickBuild | undefined {
  const engine = formsEngine(language)
  const cls = target.cls
  const opts = (word: FormWord): FormOptions => word.reading ? { reading: word.reading } : {}
  const built = engine.forms(target.lemma, cls, formId, opts(target))
  if (!built) return undefined
  const option = (word: FormWord, form: string): FormOption => ({ lemma: word.shown?.text ?? word.lemma, reading: word.shown ? word.shown.reading : word.reading, gloss: word.gloss, label: formLabel(language, form), formId: form })
  const right = option(target, formId)
  const shuffle = <T,>(list: T[]): T[] => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] } return out }
  const wrong: FormOption[] = []
  const seen = new Set([target.lemma + '|' + formId])
  const push = (word: FormWord, form: string, surface: string | undefined) => {
    const key = word.lemma + '|' + form
    if (surface == null || surface === built.surface || seen.has(key) || wrong.length >= 3) return
    seen.add(key); wrong.push(option(word, form))
  }
  const forms = (allowed ?? engine.formIds(cls)).filter(id => id !== 'dict' && id !== formId && engine.formIds(cls).includes(id))
  for (const form of shuffle(forms)) { push(target, form, engine.forms(target.lemma, cls, form, opts(target))?.surface); if (wrong.length >= 2) break }
  for (const word of shuffle(pool.filter(other => other.id !== target.id && conjugable(other.cls)))) push(word, formId, engine.forms(word.lemma, word.cls, formId, opts(word))?.surface)
  if (wrong.length < 2) return undefined
  const options = shuffle([right, ...wrong])
  return { surface: built.surface, reading: built.reading, entryId: target.id, cls, formId, options, answer: options.indexOf(right), rule: ruleLine(language, target.lemma, cls, formId), ...(phrase ? { phrase } : {}) }
}

export { formItemId }
