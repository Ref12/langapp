import { getPack } from '../language'

/** What makes two phrases the same sentence, asked of the language pack: Chinese is its Han characters only, so punctuation, spaces and full-width marks do not count (kept in step with phraseKey in scripts/build-phrase-bank.mjs, a test compares them). */
export const phraseKey = (text: string): string => getPack().phraseKey(text)
