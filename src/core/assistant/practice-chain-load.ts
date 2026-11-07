import { loadPhraseReadings } from '../pinyin/phrase-readings'

/** The practice-chain engine, loaded once the catalog's phrase readings are ready, so createPracticePlan reads phrases with catalog tones from the start. */
export async function loadPracticeChain(): Promise<typeof import('./practice-chain')> {
  const [engine] = await Promise.all([import('./practice-chain'), loadPhraseReadings().catch(() => undefined)])
  return engine
}
