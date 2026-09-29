import { useEffect, useState, type ReactNode } from 'react'
import { initializeLocalConnections, type LocalConnectionsResult } from '../../core/ai/local-connection'
import { LocalAISetupContext, LocalSpeechSetupContext, LocalSpeechRateSetupContext, LocalSpeechVoicesSetupContext, LocalPinyinSetupContext, type LocalAISetupStatus } from './local-ai-setup-context'

export function LocalAIConnectionSetup({ children, onImported }: { children: ReactNode; onImported?: () => Promise<void> }) {
  const [result, setResult] = useState<{ [Key in keyof LocalConnectionsResult]: LocalAISetupStatus }>({
    aiConnection: 'loading', speechConnection: 'loading', defaultSpeechRate: 'loading', speechVoices: 'loading', pinyinFormat: 'loading',
  })
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    initializeLocalConnections(controller.signal).then(async value => {
      if (disposed) return
      if (!Object.values(value).includes('error')) await onImported?.()
      if (!disposed) setResult(value)
    }).catch(() => {
      if (!disposed) setResult({ aiConnection: 'error', speechConnection: 'error', defaultSpeechRate: 'error', speechVoices: 'error', pinyinFormat: 'error' })
    }).finally(() => window.clearTimeout(timeout))
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort() }
  }, [onImported])
  return <LocalAISetupContext.Provider value={result.aiConnection}>
    <LocalSpeechSetupContext.Provider value={result.speechConnection}>
      <LocalSpeechRateSetupContext.Provider value={result.defaultSpeechRate}>
        <LocalSpeechVoicesSetupContext.Provider value={result.speechVoices}>
          <LocalPinyinSetupContext.Provider value={result.pinyinFormat}>{children}</LocalPinyinSetupContext.Provider>
        </LocalSpeechVoicesSetupContext.Provider>
      </LocalSpeechRateSetupContext.Provider>
    </LocalSpeechSetupContext.Provider>
  </LocalAISetupContext.Provider>
}
