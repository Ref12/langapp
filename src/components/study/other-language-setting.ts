import { createContext } from 'react'
import type { ParallelLanguage } from '../../core/parallel/data'

/** The "Show other languages on cards" setting (App provides it from the preferences). */
export const OtherLanguageSetting = createContext<string | undefined>(undefined)

export const languagesFor = (setting: string | undefined): ParallelLanguage[] => setting === 'both' ? ['ja', 'ko'] : setting === 'ja' || setting === 'ko' ? [setting] : []
