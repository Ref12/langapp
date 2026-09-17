import { createContext } from 'react'
import type { LocalAIConnectionResult } from '../../core/ai/local-connection'

export type LocalAISetupStatus = LocalAIConnectionResult | 'loading' | 'error'
export const LocalAISetupContext = createContext<LocalAISetupStatus | undefined>(undefined)
