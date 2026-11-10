/** The languages that have writing data (see language.ts). */
export type WritingLanguage = 'zh' | 'ja' | 'ko'

/** One character of a stroke-data index: its stroke count and where the strokes come from. */
export interface CharacterAssetSummary {
  character: string
  strokeCount: number
  reviewed: boolean
  variant: string
}
