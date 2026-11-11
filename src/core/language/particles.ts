// Particles and tile text, shared by the sentence builder in Practice and the older parallel screens (which re-export from here): a pack asks these when it cuts a sentence into tiles and when a wrong particle is told apart from a wrong word.

/** The languages that have a particle table. */
export type ParticleLanguage = 'ja' | 'ko'

const PUNCTUATION = /[\s\u3000.,!?;:'"()[\]\u3001\u3002\uFF0C\uFF0E\uFF01\uFF1F\uFF1B\uFF1A\u300C\u300D\u300E\u300F\u30FB\uFF5E~\u2026-]/gu
/** A tile or answer without spaces and punctuation, full-width and half-width alike. */
export const normaliseTile = (text: string): string => text.normalize('NFKC').replace(PUNCTUATION, '')
export const isPunctuation = (text: string) => normaliseTile(text) === ''

/** Particles (and the like) per language: the tile text and what it does. A wrong one is a wrong answer, and the result says which. */
export const PARTICLES: Record<ParticleLanguage, Record<string, string>> = {
  ja: { 'は': 'marks the topic', 'が': 'marks the subject, often new information', 'を': 'marks the object', 'に': 'marks a target, time or place of existence', 'で': 'marks where an action happens, or the means', 'へ': 'marks a direction', 'と': 'means "and" or "with"', 'も': 'means "also"', 'の': 'links nouns (possession)', 'か': 'turns the sentence into a question' },
  ko: { '은': 'marks the topic after a consonant', '는': 'marks the topic after a vowel', '이': 'marks the subject after a consonant', '가': 'marks the subject after a vowel', '을': 'marks the object after a consonant', '를': 'marks the object after a vowel', '에': 'marks a target, time or place of existence', '에서': 'marks where an action happens', '도': 'means "also"', '와': 'means "and" or "with" after a vowel', '과': 'means "and" or "with" after a consonant', '의': 'links nouns (possession)', '하고': 'means "and" or "with"', '에게': 'marks the person receiving or the target', '한테': 'marks the person receiving or the target, in speech', '부터': 'means "from" (a time or place)', '까지': 'means "until" or "as far as"', '로': 'marks the means or direction after a vowel', '으로': 'marks the means or direction after a consonant', '만': 'means "only"', '마다': 'means "every"', '보다': 'means "than"', '이나': 'means "or", or "as many as"', '밖에': 'means "nothing but", with a negative' },
}
/** What a wrong particle is most likely swapped for. */
export const PARTICLE_SWAPS: Record<ParticleLanguage, Record<string, string>> = {
  ja: { 'は': 'が', 'が': 'は', 'を': 'が', 'に': 'で', 'で': 'に', 'へ': 'に', 'と': 'も', 'も': 'は', 'の': 'は', 'か': 'も' },
  ko: { '은': '는', '는': '은', '이': '가', '가': '이', '을': '를', '를': '을', '에': '에서', '에서': '에', '도': '는', '와': '과', '과': '와', '의': '는', '하고': '와', '에게': '한테', '한테': '에게', '부터': '까지', '까지': '부터', '로': '으로', '으로': '로', '만': '도', '마다': '도', '보다': '만', '이나': '도', '밖에': '만' },
}
export const isParticle = (language: ParticleLanguage, text: string): boolean => text in PARTICLES[language]
