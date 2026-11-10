// Which form of a word the screens show, as a setting of the learner: the pack says what can be chosen (meta.ts displayForms); a screen asks here and never tests the language.
// The choice changes what is displayed, never what is stored: ids, labels, knowledge and exports keep referring to the word (its dictionary form).
import type { PackDisplayForms, PackMeta } from '../language/meta'
import type { PackForm } from '../language/pack-data'
import { forms as buildForm, formsEngine } from './index'

/** A vocabulary record as the display needs it: headword, reading, and the conjugation class when the word inflects. */
export interface HeadwordRecord { ch: string; pr: string; cl?: string }
/** The text and reading a headword is shown with. */
export interface Headword { text: string; reading: string; /** The reading cut where a する compound's noun ends (べんきょう + します), for romaji; absent for any other word. */ parts?: string[] }

/** The class whose words are a noun + する (勉強する): their romaji is written with a space before the する part (benkyou shimasu). */
const SURU_COMPOUND = 'suru-compound'
/** The reading of a word cut into its noun and its する part, from its class and the reading built for it (the dictionary form's or any other form's); undefined for any other word. */
export function readingParts(cls: string | undefined, dictionaryReading: string, built: string): string[] | undefined {
  if (cls !== SURU_COMPOUND || !dictionaryReading.endsWith('する')) return undefined
  const noun = dictionaryReading.slice(0, -2)
  return noun && built.startsWith(noun) && built.length > noun.length ? [noun, built.slice(noun.length)] : undefined
}

type Offering = Pick<PackMeta, 'displayForms'>

/** The form to show for the learner's stored choice: the choice when the pack offers it, else the pack's default; undefined for a pack that offers none (Chinese). */
export function activeDisplayForm(pack: Offering, chosen: string | undefined): string | undefined {
  const offer = pack.displayForms
  if (!offer) return undefined
  return chosen !== undefined && offer.choices.some(choice => choice.id === chosen) ? chosen : offer.default
}

/** The kind of word a conjugation class is (verb, i-adj, na-adj, noun), as the forms table names the kinds. */
export function kindOfClass(language: 'ja' | 'ko', cls: string): string | undefined {
  const group = formsEngine(language).rules.classes[cls]?.group
  return group === 'copula' ? cls : group
}

/**
 * The text and reading to display for a vocabulary record under the form the learner chose. A record without a class, a word of a kind the form is not shown for
 * (adjectives, nouns), a form the engine cannot build, or no choice at all: the record as stored.
 */
export function headwordFor(offer: PackDisplayForms | undefined, form: string | undefined, record: HeadwordRecord): Headword {
  const stored: Headword = { text: record.ch, reading: record.pr, ...(readingParts(record.cl, record.pr, record.pr) ? { parts: readingParts(record.cl, record.pr, record.pr) } : {}) }
  if (!offer || form === undefined || !record.cl) return stored
  const choice = offer.choices.find(item => item.id === form)
  const kind = kindOfClass(offer.language, record.cl)
  if (!choice || kind === undefined || !choice.kinds.includes(kind)) return stored
  const built = buildForm(offer.language, record.ch, record.cl, form, { reading: record.pr })
  if (!built) return stored
  const reading = built.reading ?? record.pr, parts = readingParts(record.cl, record.pr, reading)
  return { text: built.surface, reading, ...(parts ? { parts } : {}) }
}

/** One row of the Forms section of a word card. */
export interface FormRow { id: string; name: string; text: string; reading: string; parts?: string[]; pattern?: string }

/** The forms table's rows that apply to the word and that the engine can build, the dictionary form first and then the table's order. Empty for a word without a class. */
export function formRows(offer: PackDisplayForms | undefined, table: PackForm[] | undefined, record: HeadwordRecord): FormRow[] {
  if (!offer || !table || !record.cl) return []
  const kind = kindOfClass(offer.language, record.cl)
  if (kind === undefined) return []
  const rows: FormRow[] = []
  for (const row of table) {
    if (!row.kinds.includes(kind)) continue
    const built = buildForm(offer.language, record.ch, record.cl, row.id, { reading: record.pr })
    if (!built) continue
    const reading = built.reading ?? record.pr, parts = readingParts(record.cl, record.pr, reading)
    rows.push({ id: row.id, name: row.name, text: built.surface, reading, ...(parts ? { parts } : {}), ...(row.patterns[kind] ? { pattern: row.patterns[kind] } : {}) })
  }
  return rows.sort((a, b) => Number(b.id === 'dict') - Number(a.id === 'dict'))
}

/** An option label of the setting: "Polite form (勉強します)": the table's name with a capital, and the sample word in that form. */
export function formOptionLabel(offer: PackDisplayForms, table: PackForm[], form: string): string {
  const name = table.find(row => row.id === form)?.name ?? form
  const shown = headwordFor({ ...offer, choices: [{ id: form, kinds: ['verb'] }] }, form, offer.sample)
  const sample = form === 'dict' ? offer.sample.ch : shown.text
  return name.charAt(0).toUpperCase() + name.slice(1) + ' (' + sample + ')'
}
