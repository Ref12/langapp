import { createContext, useContext, useEffect, useState } from 'react'
import { activeDisplayForm, headwordFor, type Headword, type HeadwordRecord } from '../core/forms/display'
import { getPack, type PackForm, type ReadingScript } from '../core/language'
import { loadPackForms } from '../core/language/pack-forms'
import { showsReading } from '../core/study/reading-line'

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

/** The text and reading to show for a vocabulary record under the learner's chosen form (as stored when the pack offers none). */
export function useHeadword(record: HeadwordRecord): Headword {
  const table = usePackFormsTable()
  return headwordFor(getPack().displayForms, useDisplaySettings().form, record, table)
}

/** Whether a reading line says something the line above it does not: in kana, not when it is the same as the text; in romaji, whenever there is a reading (a word written only in kana still has romaji to show). */
export function useShowsReading(): (kana: string | undefined, text: string) => boolean {
  const style = useDisplaySettings().readingStyle
  return (kana, text) => style === 'romaji' ? Boolean(kana) : showsReading(kana, text)
}

/** The pack's forms table once it has loaded (undefined before, and for a pack without one). */
export function usePackFormsTable(): PackForm[] | undefined {
  const [table, setTable] = useState<PackForm[] | undefined>()
  useEffect(() => {
    let live = true
    void loadPackForms().then(rows => { if (live) setTable(rows) })
    return () => { live = false }
  }, [])
  return table
}
