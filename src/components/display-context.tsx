import type { ReactNode } from 'react'
import type { HeadwordRecord } from '../core/forms/display'
import { getPack } from '../core/language'
import { kanaToRomaji, patternToRomaji, tokensToRomaji, type RomajiToken } from '../core/reading/romaji'
import { DisplaySettingsContext, useDisplaySettings, useHeadword, type DisplaySettings } from './display-settings'
import { Pinyin } from './Pinyin'

export function DisplaySettingsProvider({ settings, children }: { settings: DisplaySettings; children: ReactNode }) {
  return <DisplaySettingsContext.Provider value={settings}>{children}</DisplaySettingsContext.Provider>
}

/** A reading line: the pack's pinyin format as before, or romaji made from the kana when the learner chose it (from the tokens when a sentence's are given; as a pattern when it is one's). */
export function ReadingText({ kana, tokens, pattern }: { kana: string; tokens?: RomajiToken[]; pattern?: boolean }) {
  const style = useDisplaySettings().readingStyle
  if (style !== 'romaji') return <Pinyin text={kana} />
  const overrides = getPack().romaji
  if (pattern) return <>{patternToRomaji(kana, overrides)}</>
  return <>{tokens ? tokensToRomaji(tokens, overrides) : kanaToRomaji(kana, overrides)}</>
}

/** A vocabulary record's headword as the learner chose to see it (for rows that show a bare word). */
export function HeadwordText({ record }: { record: HeadwordRecord }) { return <>{useHeadword(record).text}</> }
/** Its reading line in the chosen style. */
export function HeadwordReading({ record }: { record: HeadwordRecord }) { return <ReadingText kana={useHeadword(record).reading} /> }
