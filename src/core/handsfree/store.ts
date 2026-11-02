import { loadCatalog, type Catalog } from '../study/catalog'
import { catalogSentence, lessonPhrase, loadItems } from '../drills/items'
import { DEFAULT_HANDSFREE_SETTINGS, handsfreeSettingsSchema, type HandsfreeRun, type HandsfreeSettings } from './contracts'
import { generateScript, type Script, type ScriptItem, type ScriptMode, type ScriptSentence } from './script'

const SETTINGS_KEY = 'handsfree.settings'

/** The settings last used, remembered on this device. */
export function loadHandsfreeSettings(): HandsfreeSettings {
  try {
    const parsed = handsfreeSettingsSchema.safeParse(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'))
    if (parsed.success) return parsed.data
  } catch { /* unreadable settings fall back to the defaults */ }
  return DEFAULT_HANDSFREE_SETTINGS
}
export function saveHandsfreeSettings(settings: HandsfreeSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* storage may be unavailable; the run keeps its own copy */ }
}

/**
 * The English of the shortest authored example that uses a vocabulary word ("Let's rest."), preferring an example in the word's own lesson group and then any group.
 * Ties go to the earlier example, so the choice is stable. Whether it is short enough to speak is the script's call.
 */
export function exampleFor(catalog: Catalog, ref: string): { example?: string } {
  const words = (text: string) => text.trim().split(/\s+/).length
  const best = (groups: readonly Catalog['orderedGroups'][number][]) => {
    let found: string | undefined
    for (const { group } of groups) for (const example of group.examples) {
      if (!example.translation.trim() || !example.segments.some(segment => `vocabulary:${segment.word}` === ref)) continue
      if (found === undefined || words(example.translation) < words(found)) found = example.translation.trim()
    }
    return found
  }
  const own = catalog.orderedGroups.filter(({ group }) => group.units.some(unit => unit.ref === ref))
  const example = best(own) ?? best(catalog.orderedGroups)
  return example ? { example } : {}
}

/** The run's script: its items from the catalog, grammar sentences and each word's lesson phrase from the catalog examples. `known` is the knowledge set, whose words a lesson phrase may also use. */
export async function buildRunScript(run: Pick<HandsfreeRun, 'refs' | 'settings' | 'seed'>, mode: ScriptMode = 'introduction', known: ReadonlySet<string> = new Set()): Promise<{ script: Script; items: ScriptItem[] }> {
  const catalog = await loadCatalog()
  const found = await loadItems(run.refs, catalog)
  const allowed = new Set([...known, ...run.refs])
  const sentences: Record<string, ScriptSentence | undefined> = {}
  for (const item of found) {
    const sentence = item.kind === 'grammar' ? catalogSentence(catalog, item) : undefined
    if (sentence) sentences[item.ref] = { zh: sentence.zh, en: sentence.en }
  }
  const items: ScriptItem[] = found.map(item => {
    const phrase = item.kind === 'vocabulary' ? lessonPhrase(catalog, item.ref, allowed) : undefined
    return { ref: item.ref, kind: item.kind, zh: item.zh, en: item.en, ...(item.kind === 'vocabulary' ? exampleFor(catalog, item.ref) : {}), ...(phrase ? { phrase } : {}) }
  })
  return { script: generateScript(items, sentences, run.settings, run.seed, mode), items }
}
