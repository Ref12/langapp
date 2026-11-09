import { createContext, useCallback, useContext } from 'react'
import { DEFAULT_JAPANESE_READING, type JapaneseReadingFormat } from '../core/parallel/romanize'
import { DEFAULT_PINYIN_FORMAT, formatPinyin, type PinyinFormat } from '../core/pinyin'

export const PinyinFormatContext = createContext<PinyinFormat>(DEFAULT_PINYIN_FORMAT)

export function usePinyinFormatter() {
  const format = useContext(PinyinFormatContext)
  return useCallback((text: string) => formatPinyin(text, format), [format])
}

/** Readings of Japanese and Korean in the pinyin slot: shown with the pinyin switch, Japanese as romaji or kana. */
export interface ReadingSettings { show: boolean; japanese: JapaneseReadingFormat }
export const ReadingSettingsContext = createContext<ReadingSettings>({ show: true, japanese: DEFAULT_JAPANESE_READING })
export const useReadingSettings = () => useContext(ReadingSettingsContext)
