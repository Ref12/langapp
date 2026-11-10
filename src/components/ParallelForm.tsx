import type { ParallelLanguage } from '../core/language/ids'
import { readingFor } from '../core/language/romanize'
import { useReadingSettings } from './pinyin-context'

/** A Japanese or Korean form with its reading in the pinyin slot: the same ruby as a Chinese word, romaji or kana (Japanese) or Revised Romanization (Korean). */
export function Form({ text, reading, language }: { text: string; reading?: string; language: ParallelLanguage }) {
  const settings = useReadingSettings()
  const shown = settings.show ? readingFor(language, text, reading, settings.japanese) : undefined
  if (!shown) return <span lang={language}>{text}</span>
  return <ruby className="mandarin-word" lang={language}>{text}<rt aria-hidden="true" data-assistant-exclude>{shown}</rt></ruby>
}
