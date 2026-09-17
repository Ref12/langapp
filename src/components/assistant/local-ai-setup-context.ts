import { createContext } from 'react'
import type { LocalAIConnectionResult } from '../../core/ai/local-connection'

export type LocalAISetupStatus = LocalAIConnectionResult | 'loading' | 'error'
export const LocalAISetupContext = createContext<LocalAISetupStatus | undefined>(undefined)
export const LocalSpeechSetupContext = createContext<LocalAISetupStatus | undefined>(undefined)
export const LocalSpeechRateSetupContext = createContext<LocalAISetupStatus | undefined>(undefined)
