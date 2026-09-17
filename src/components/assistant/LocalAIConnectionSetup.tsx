import { useEffect, useState, type ReactNode } from 'react'
import { initializeLocalAIConnection } from '../../core/ai/local-connection'
import { LocalAISetupContext, type LocalAISetupStatus } from './local-ai-setup-context'

export function LocalAIConnectionSetup({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<LocalAISetupStatus>('loading')
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    initializeLocalAIConnection(controller.signal).then(
      value => { if (!disposed) setResult(value) },
      () => { if (!disposed) setResult('error') },
    ).finally(() => window.clearTimeout(timeout))
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort() }
  }, [])
  return <LocalAISetupContext.Provider value={result}>{children}</LocalAISetupContext.Provider>
}
