import { createContext, useCallback, useContext } from 'react'
import { DEFAULT_PINYIN_FORMAT, formatPinyin, type PinyinFormat } from '../core/pinyin'

export const PinyinFormatContext = createContext<PinyinFormat>(DEFAULT_PINYIN_FORMAT)

export function usePinyinFormatter() {
  const format = useContext(PinyinFormatContext)
  return useCallback((text: string) => formatPinyin(text, format), [format])
}
