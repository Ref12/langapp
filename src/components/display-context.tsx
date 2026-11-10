import { createContext, useContext, type ReactNode } from 'react'
import { activeDisplayForm, headwordFor, type Headword, type HeadwordRecord } from '../core/forms/display'
import { getPack, type ReadingScript } from '../core/language'
import { kanaToRomaji, tokensToRomaji, type RomajiToken } from '../core/reading/romaji'
import { showsReading } from '../core/study/reading-line'
import { Pinyin } from './Pinyin'

/** What the learner chose for how words are displayed, resolved against the pack: undefined where the pack offers no choice (Chinese). */
export interface DisplaySettings { form: string | undefined; readingStyle: ReadingScript | undefined }
export const DisplaySettingsContext = createContext<DisplaySettings>({ form: undefined, readingStyle: undefined })
export const useDisplaySettings = () => useContext(DisplaySettingsContext)

/** The settings of the stored preferences, for the provider in App. */
export function resolveDisplaySettings(preferences: { displayForm?: string; readingStyle?: ReadingScript }): DisplaySettings {
  const pack = getPack()
  const styles = pack.readingStyles
  return {
    form: activeDisplayForm(pack, preferences.displayForm),
    readingStyle: styles ? (preferences.readingStyle !== undefined && styles.choices.includes(preferences.readingStyle) ? preferences.readingStyle : styles.default) : undefined,
  }
}

export function DisplaySettingsProvider({ settings, children }: { settings: DisplaySettings; children: ReactNode }) {
  return <DisplaySettingsContext.Provider value={settings}>{children}</DisplaySettingsContext.Provider>
}

/** The text and reading to show for a vocabulary record under the learner's chosen form (as stored when the pack offers none). */
export function useHeadword(record: HeadwordRecord): Headword {
  return headwordFor(getPack().displayForms, useDisplaySettings().form, record)
}

/** A reading line: the pack's pinyin format as before, or romaji made from the kana when the learner chose it (from the tokens when a sentence's are given). */
export function ReadingText({ kana, tokens }: { kana: string; tokens?: RomajiToken[] }) {
  const style = useDisplaySettings().readingStyle
  if (style !== 'romaji') return <Pinyin text={kana} />
  const overrides = getPack().romaji
  return <>{tokens ? tokensToRomaji(tokens, overrides) : kanaToRomaji(kana, overrides)}</>
}

/** Whether a reading line says something the line above it does not: in kana, not when it is the same as the text; in romaji, whenever there is a reading (a word written only in kana still has romaji to show). */
export function useShowsReading(): (kana: string | undefined, text: string) => boolean {
  const style = useDisplaySettings().readingStyle
  return (kana, text) => style === 'romaji' ? Boolean(kana) : showsReading(kana, text)
}

/** A vocabulary record's headword as the learner chose to see it (for rows that show a bare word). */
export function HeadwordText({ record }: { record: HeadwordRecord }) { return <>{useHeadword(record).text}</> }
/** Its reading line in the chosen style. */
export function HeadwordReading({ record }: { record: HeadwordRecord }) { return <ReadingText kana={useHeadword(record).reading} /> }
