import { loadCatalog, type Catalog } from '../study/catalog'
import { db } from '../database'
import { loadItems, unknownForms } from '../drills/items'
import { pickSentences } from '../phrases/sentences'
import { heardLog, leastHeard, loadBank } from '../phrases/bank'
import { pickReviews } from '../study/daily'
import { DOMAIN } from '../study/knowledge'
import { DEFAULT_HANDSFREE_SETTINGS, handsfreeSettingsSchema, type HandsfreeRun, type HandsfreeSettings } from './contracts'
import { generateScript, REVIEW_EXTRAS, type Script, type ScriptItem, type ScriptMode, type ScriptSentence } from './script'
import { storageNames } from '../storage-names'

const SETTINGS_KEY = () => storageNames().local.handsfree

/** The settings last used, remembered on this device. */
export function loadHandsfreeSettings(): HandsfreeSettings {
  try {
    const parsed = handsfreeSettingsSchema.safeParse(JSON.parse(localStorage.getItem(SETTINGS_KEY()) ?? 'null'))
    if (parsed.success) return parsed.data
  } catch { /* unreadable settings fall back to the defaults */ }
  return DEFAULT_HANDSFREE_SETTINGS
}
export function saveHandsfreeSettings(settings: HandsfreeSettings) {
  try { localStorage.setItem(SETTINGS_KEY(), JSON.stringify(settings)) } catch { /* storage may be unavailable; the run keeps its own copy */ }
}

/**
 * The English of the shortest authored example that uses a vocabulary word ("Let's rest."), preferring an example in the word's own lesson group and then any group.
 * Ties go to the earlier example, so the choice is stable. Whether it is short enough to speak is the script's call.
 */
export function exampleFor(catalog: Catalog, ref: string, allowed?: ReadonlySet<string>): { example?: string } {
  const words = (text: string) => text.trim().split(/\s+/).length
  const best = (groups: readonly Catalog['orderedGroups'][number][]) => {
    let found: string | undefined
    for (const { group } of groups) for (const example of group.examples) {
      if (!example.translation.trim() || !example.segments.some(segment => `vocabulary:${segment.word}` === ref)) continue
      // with the learner's words given, only an example made of words they know is offered as "as in ..."
      if (allowed && unknownForms(catalog, example.segments.flatMap(segment => segment.word ? [`vocabulary:${segment.word}`] : []), allowed).length) continue
      if (found === undefined || words(example.translation) < words(found)) found = example.translation.trim()
    }
    return found
  }
  const own = catalog.orderedGroups.filter(({ group }) => group.units.some(unit => unit.ref === ref))
  const example = best(own) ?? best(catalog.orderedGroups)
  return example ? { example } : {}
}

/** The Chinese of every bank phrase a script plays, for the heard log (once each). */
export const phrasesIn = (script: Script): string[] => [...new Set(script.segments.flatMap(segment => segment.kind === 'marker' && segment.phrase ? [segment.phrase] : []))]

/**
 * The run's script: its items from the catalog, grammar sentences from the catalog examples, and each word's phrases from the phrase bank (catalog examples, the shipped
 * bank and the drill sentences; usable when every word they use is in the set or the knowledge set), least-heard first. `known` is the knowledge set. The Introduction's
 * mixed review also takes a few knowledge-set items that are due or coming up next.
 */
export async function buildRunScript(run: Pick<HandsfreeRun, 'refs' | 'settings' | 'seed'>, mode: ScriptMode = 'introduction', known: ReadonlySet<string> = new Set()): Promise<{ script: Script; items: ScriptItem[] }> {
  const catalog = await loadCatalog()
  const found = await loadItems(run.refs, catalog)
  const allowed = new Set([...known, ...run.refs])
  const sentences: Record<string, ScriptSentence | undefined> = {}
  const picked = await pickSentences(catalog, found.filter(item => item.kind === 'grammar'), allowed)
  for (const [ref, sentence] of Object.entries(picked)) sentences[ref] = { zh: sentence.zh, en: sentence.en }
  const bank = await loadBank(catalog, found.filter(item => item.kind === 'vocabulary').map(item => item.ref), allowed, await db.drillSets.toArray())
  const heard = await heardLog()
  const items: ScriptItem[] = found.map(item => {
    const phrases = leastHeard(bank.get(item.ref) ?? [], heard).map(phrase => ({ zh: phrase.zh, en: phrase.en, ...(phrase.source === 'catalog' ? { example: true } : {}) }))
    return { ref: item.ref, kind: item.kind, zh: item.zh, en: item.en, ...(item.kind === 'vocabulary' ? exampleFor(catalog, item.ref, allowed) : {}), ...(phrases.length ? { phrases } : {}) }
  })
  let review: ScriptItem[] | undefined
  if (mode === 'introduction' && known.size) {
    const own = new Set(run.refs)
    const cards = (await db.studyCards.toArray()).filter(card => card.domain === DOMAIN && known.has(card.ref) && !own.has(card.ref) && catalog.units.has(card.ref))
    const extra = await loadItems(pickReviews(cards, Date.now(), REVIEW_EXTRAS).refs, catalog)
    const pickedExtra = await pickSentences(catalog, extra.filter(item => item.kind === 'grammar'), allowed)
    for (const [ref, sentence] of Object.entries(pickedExtra)) sentences[ref] = { zh: sentence.zh, en: sentence.en }
    review = extra.map(item => ({ ref: item.ref, kind: item.kind, zh: item.zh, en: item.en }))
  }
  return { script: generateScript(items, sentences, run.settings, run.seed, mode, review), items }
}
