/** The languages that have writing data: Chinese (default), Japanese and Korean. Each lives in public/characters/<folder>/. */
export type WritingLanguage = 'zh' | 'ja' | 'ko'

export const writingLanguages: readonly WritingLanguage[] = ['zh', 'ja', 'ko']
export const defaultWritingLanguage: WritingLanguage = 'zh'

const folders: Record<WritingLanguage, string> = { zh: 'chinese', ja: 'japanese', ko: 'korean' }
export const languageName: Record<WritingLanguage, string> = { zh: 'Chinese', ja: 'Japanese', ko: 'Korean' }

export const isWritingLanguage = (value: unknown): value is WritingLanguage => typeof value === 'string' && Object.prototype.hasOwnProperty.call(folders, value)

export const languageFolder = (language: WritingLanguage): string => folders[language]

/** URL of a file in a language's writing folder. Read BASE_URL lazily: this module is reachable from the Vite config bundle (Node), where import.meta.env is undefined. */
export const languageAssetUrl = (language: WritingLanguage, file: string): string =>
  `${import.meta.env?.BASE_URL ?? '/'}characters/${languageFolder(language)}/${file}`
