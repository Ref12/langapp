const NOT_HAN = /[^\p{Script=Han}]/gu

/** What makes two phrases the same sentence: its Han characters only, so punctuation, spaces and full-width marks do not count. Kept in step with phraseKey in scripts/build-phrase-bank.mjs (a test compares them). */
export const phraseKey = (zh: string): string => zh.replace(NOT_HAN, '')

