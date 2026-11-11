import { getPack } from '../language'
import type { LanguageId } from '../language/ids'
import { isSentenceRef } from '../study/contracts'
import { shippedPhrases } from './bank'
import type { BankPhrase } from './contracts'

// The identity of a shipped phrase as an item of its own (docs/audits/2026-11-11-phrases-in-practice.md, 2.1): its band and its id in the band file. Ids are never reused,
// so a ref stays the same sentence across releases (a test pins it). A ref whose phrase is no longer shipped resolves to nothing, like a removed word.
//   Chinese  sentence:b3-1207      Japanese  ja:s:b1-45      Korean  ko:s:b1-45

const PREFIX: Record<LanguageId, string> = { zh: 'sentence:', ja: 'ja:s:', ko: 'ko:s:' }

/** The ref of a shipped phrase of this band, for the language of the build. */
export const sentenceRef = (band: string, id: number, language: LanguageId = getPack().id): string => `${PREFIX[language]}b${band}-${id}`

/** The band and id a sentence ref names (undefined when it is not one). */
export function parseSentenceRef(ref: string): { band: string; id: number } | undefined {
  if (!isSentenceRef(ref)) return undefined
  const match = /^(?:sentence:|(?:ja|ko):s:)b(\d+)-(\d+)$/.exec(ref)
  return match ? { band: match[1], id: Number(match[2]) } : undefined
}

/** A shipped phrase with the band file it is in and its ref. */
export interface ShippedPhrase { ref: string; band: string; phrase: BankPhrase }

const cache = new Map<string, Promise<ShippedPhrase[]>>()

/** Every phrase of the pack's shipped band files once (a phrase is listed under each of its words in the loader; this keeps one), in band and id order. Loaded on first use. */
export function shippedSentences(): Promise<ShippedPhrase[]> {
  const pack = getPack()
  let pending = cache.get(pack.id)
  if (!pending) {
    pending = (async () => {
      const out: ShippedPhrase[] = []
      for (const band of Object.keys(pack.phrases.bands).sort((a, b) => Number(a) - Number(b))) {
        const seen = new Set<BankPhrase>()
        for (const list of Object.values(await shippedPhrases(band))) for (const phrase of list) seen.add(phrase)
        for (const phrase of [...seen].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) if (phrase.id !== undefined && phrase.source !== 'drill') out.push({ ref: sentenceRef(band, phrase.id, pack.id), band, phrase })
      }
      return out
    })()
    cache.set(pack.id, pending)
  }
  return pending
}

/** The phrases the refs name, by ref; a ref that is not a sentence ref of this language, or whose phrase is not shipped, is left out. */
export async function resolveSentences(refs: readonly string[]): Promise<Map<string, ShippedPhrase>> {
  const wanted = new Set(refs.filter(ref => parseSentenceRef(ref) !== undefined))
  if (!wanted.size) return new Map()
  return new Map((await shippedSentences()).filter(entry => wanted.has(entry.ref)).map(entry => [entry.ref, entry]))
}
