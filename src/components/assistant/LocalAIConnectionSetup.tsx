import { useEffect, useState, type ReactNode } from 'react'
import { initializeLocalConnections, type LocalConnectionsResult } from '../../core/ai/local-connection'
import { LocalAISetupContext, LocalSpeechSetupContext, LocalSpeechRateSetupContext, LocalSpeechVoicesSetupContext, type LocalAISetupStatus } from './local-ai-setup-context'

export function LocalAIConnectionSetup({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<{ [Key in keyof LocalConnectionsResult]: LocalAISetupStatus }>({
    aiConnection: 'loading', speechConnection: 'loading', defaultSpeechRate: 'loading', speechVoices: 'loading',
  })
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    initializeLocalConnections(controller.signal).then(
      value => { if (!disposed) setResult(value) },
      () => { if (!disposed) setResult({ aiConnection: 'error', speechConnection: 'error', defaultSpeechRate: 'error', speechVoices: 'error' }) },
    ).finally(() => window.clearTimeout(timeout))
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort() }
  }, [])
  return <LocalAISetupContext.Provider value={result.aiConnection}>
    <LocalSpeechSetupContext.Provider value={result.speechConnection}>
      <LocalSpeechRateSetupContext.Provider value={result.defaultSpeechRate}>
        <LocalSpeechVoicesSetupContext.Provider value={result.speechVoices}>{children}</LocalSpeechVoicesSetupContext.Provider>
      </LocalSpeechRateSetupContext.Provider>
    </LocalSpeechSetupContext.Provider>
  </LocalAISetupContext.Provider>
}
