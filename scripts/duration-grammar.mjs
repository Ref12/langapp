// Deterministic tagging of "verb + length of time" (休息五分钟, 住三天, 玩了两个小时) by code, never by a model.
// A length of time is a number (一二两三四五六七八九十百 or 几 or 半) plus an optional 个, then a time unit; or 一会儿. It counts as a duration only after a verb
// (a catalog word whose gloss starts with "to ", minus possession and copula verbs): a point in time (二零二六年, 三月八号, 五点) or a noun phrase
// (第三天, 三天后) is not one. 了 between the verb and the length of time (玩了两个小时) also gives the verb + 了 + duration point.
import { HAN_RE } from './duration-constants.mjs'

export const DURATION_REF = 'num-nian2-or-tian1-or-fen1--duration'
export const DURATION_LE_REF = 'v-le5-duration-obj--duration'
export const DURATION_REFS = [DURATION_REF, DURATION_LE_REF]

const NUMBER = '[一二两三四五六七八九十百几半]+'
const UNIT = '(?:分钟|小时|星期|周|天|年|月)'
const LENGTH = '(?:' + NUMBER + '个?' + UNIT + '|一会儿)'
/** The first character before the match is not 第 (an ordinal) and the length is not followed by a noun-forming 后/前/里 (a point in time). */
const LENGTH_AT_END = new RegExp('(了?)(' + LENGTH + ')', 'gu')
/** Verbs the catalog glosses without "to ", and verbs that are never followed by a length of time. */
const EXTRA_VERBS = new Set(['等'])
const NOT_DURATION_VERBS = new Set(['有', '是', '没有', '在', '像', '叫', '姓', '经过', '隔'])

const cache = new WeakMap()
/** Every catalog form that is a verb: some sense is glossed "to ...". */
function verbForms(curriculum) {
  let found = cache.get(curriculum)
  if (!found) {
    found = new Set(EXTRA_VERBS)
    for (const word of curriculum.ordered) if (HAN_RE.test(word.ch) && /(^|\/ )to \w/.test(String(word.ds ?? ''))) found.add(word.ch)
    for (const form of NOT_DURATION_VERBS) found.delete(form)
    cache.set(curriculum, found)
  }
  return found
}

/** The duration pattern refs a Chinese text uses: [] when none; DURATION_REF, plus DURATION_LE_REF when 了 sits between the verb and the length of time. */
export function durationRefs(curriculum, zh) {
  const verbs = verbForms(curriculum)
  const refs = new Set()
  for (const clause of String(zh).split(/[^\p{Script=Han}]+/u)) {
    for (const match of clause.matchAll(LENGTH_AT_END)) {
      const before = clause.slice(0, match.index)
      const after = clause.slice(match.index + match[0].length)
      if (/^[后前里内]/.test(after) && !match[1]) continue
      if (match[0] === '四周') continue // 四周 is "all around", not four weeks
      let verb = false
      for (let size = Math.min(4, before.length); size >= 1 && !verb; size--) verb = verbs.has(before.slice(before.length - size))
      if (!verb) continue
      refs.add(DURATION_REF)
      if (match[1]) refs.add(DURATION_LE_REF)
    }
  }
  return DURATION_REFS.filter(ref => refs.has(ref))
}

/** The grammar list with the duration refs decided by code: both removed, then those the text really uses added (only refs the curriculum has). */
export function withDurationGrammar(curriculum, zh, grammar = []) {
  const detected = durationRefs(curriculum, zh).filter(ref => curriculum.grammar?.has(ref))
  return [...grammar.filter(ref => !DURATION_REFS.includes(ref)), ...detected]
}
