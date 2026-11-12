// Whose is a stored item ref? A build keeps to its own language: a profile file or a copy can bring rows of another language
// (a Chinese export imported into Korean), and those must never count, be listed or be practised.
//
// A Chinese item ref is `vocabulary:<label>` or `grammar:<label>`, and so is a Japanese or Korean one, so the label has to say which
// it is: Chinese labels are pinyin with tone digits (ni3--you, ba4-ba5--dad), or, for a few grammar patterns, a plain pattern name
// (s-vp--verbal). The Japanese and Korean labels are romaji / romanized Hangul (haksaeng--student; n1-wa-n2-ni-n3-o-agemasu--give is the
// one place a digit appears: n1, n2, n3 are slots, not tones). language/ownership.test.ts checks the rule against every shipped label
// of the three languages: all Chinese ones are recognised, none of the Japanese or Korean ones is.

import type { LanguageId } from './ids'
import { isLanguageRef, parseParallelRef } from './refs'

/** The Chinese grammar labels that have no tone digit before their "--": pattern names only. Kept in step with the curriculum by ownership.test.ts. */
const CHINESE_PATTERN_LABELS: ReadonlySet<string> = new Set(["a-a-b-b--vivid","adj-qty--difference","adjp-pred--quality-subject","clause-clause--linked","digit-digit--serial","expr--fragment","n-n--modifier","np-np--apposition","num-adj-mw-n--sized-unit","num-mw-n--count","num-num-mw-n--rough-range","num-unit--ordinal","owner-qty-mod-n--multi-modifier","patient-pred--affected","prep-obj--phrase","pron-pred--pronoun","s-adj-ref-qty--difference","s-adj-vp--manner","s-adv-adv-vp--adverbials","s-modal-v-wh--indefinite","s-np--nominal","s-pred--statement","s-pred-pred--clause-subject","s-v-obj-v-comp--repeat","s-v-p-obj--double-obj","s-vp--verbal","s-vp-vp--means","s-vp-vp--purpose","s-vp-vp--serial-cause","s-vp-vp--serial-condition","s-vp-vp--serial-contrast","time-s-vp-or-s-time-vp--time","topic-s-pred--topic-comment","v-insert-obj--separable","v-obj--object","v-v--try","v-v--try-abab","vp-pred--activity-subject","wh-pred--rhetorical","wh-pred-wh-pred--whichever"])

const TONED = /^[a-z]+[1-5]$/
const SLOT = /^n[1-5]$/
const CURRICULUM_REF = /^(?:vocabulary|grammar):(.+)$/

/** True when a vocabulary or grammar label is one of the Chinese curriculum's. */
export function isChineseLabel(label: string): boolean {
  if (CHINESE_PATTERN_LABELS.has(label)) return true
  return label.split('--')[0].split('-').some(part => TONED.test(part) && !SLOT.test(part))
}

/** A plain curriculum ref (vocabulary:/grammar:) whose label is Chinese. */
export function isChineseRef(ref: string): boolean {
  const match = CURRICULUM_REF.exec(ref)
  return match !== null && isChineseLabel(match[1])
}

/** What a language pack says about whose a stored ref is. */
export interface PackOwnership {
  /** The ref belongs to this build's learning: it is counted, listed and practised. Refs of another language, and the older language-marked refs (ja:/ko:) this build never reads, are not. */
  ownsRef(ref: string): boolean
  /** The ref is certainly another language's row (a Chinese label in a Japanese or Korean build, a ko: ref in a Japanese one): the one-time cleanup may remove it. Chinese never says so. */
  foreignRef(ref: string): boolean
}

const isSourceRef = (ref: string): boolean => ref.startsWith('source:')

/** mediaArea: the build has the media area, the only place a `source:` ref (a word drawn from a media source) is made; without it such a ref came from another build. */
export function ownershipOf(language: LanguageId, mediaArea: boolean): PackOwnership {
  // The Chinese build keeps its own unmarked rows and hides the ja:/ko: ones an older version wrote; it never removes anything.
  if (language === 'zh') return { ownsRef: ref => !isLanguageRef(ref), foreignRef: () => false }
  return {
    ownsRef: ref => !isLanguageRef(ref) && !isChineseRef(ref) && (mediaArea || !isSourceRef(ref)),
    foreignRef: ref => isChineseRef(ref) || (!mediaArea && isSourceRef(ref)) || (parseParallelRef(ref)?.language ?? language) !== language,
  }
}
