import { useEffect, useState, type ReactNode } from 'react'
import { initializeLocalConnections } from '../../core/ai/local-connection'
import { LocalAISetupContext, LocalSpeechSetupContext, LocalSpeechRateSetupContext, type LocalAISetupStatus } from './local-ai-setup-context'

export function LocalAIConnectionSetup({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<{ aiConnection: LocalAISetupStatus; speechConnection: LocalAISetupStatus; defaultSpeechRate: LocalAISetupStatus }>({
    aiConnection: 'loading', speechConnection: 'loading', defaultSpeechRate: 'loading',
  })
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    initializeLocalConnections(controller.signal).then(
      value => { if (!disposed) setResult(value) },
      () => { if (!disposed) setResult({ aiConnection: 'error', speechConnection: 'error', defaultSpeechRate: 'error' }) },
    ).finally(() => window.clearTimeout(timeout))
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort() }
  }, [])
  return <LocalAISetupContext.Provider value={result.aiConnection}>
    <LocalSpeechSetupContext.Provider value={result.speechConnection}>
      <LocalSpeechRateSetupContext.Provider value={result.defaultSpeechRate}>{children}</LocalSpeechRateSetupContext.Provider>
    </LocalSpeechSetupContext.Provider>
  </LocalAISetupContext.Provider>
}
