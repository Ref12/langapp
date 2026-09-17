import { db } from '../database'
import { LOOPBACK_HOSTNAMES } from '../assistant/contracts'
import { localSettingsSchema, LOCAL_SETTINGS_FILE, LOCAL_SETTINGS_HEADER, LOCAL_SETTINGS_PATH } from '../local-settings-contracts'
import { saveAIConnection } from '../assistant/store'
import { saveSpeechConnection } from '../assistant/speech-connection'
import type { AIConnectionInput, SpeechRate } from '../assistant/contracts'
import type { SpeechConnectionInput } from '../assistant/speech-contracts'

export type LocalAIConnectionResult = 'unavailable' | 'existing' | 'missing' | 'loaded' | 'error'
export type LocalConnectionsResult = {
  aiConnection: LocalAIConnectionResult
  speechConnection: LocalAIConnectionResult
  defaultSpeechRate: LocalAIConnectionResult
}

function localSettingsAvailable(): boolean {
  return import.meta.env.DEV && import.meta.env.DEV_LOCAL_SETTINGS === 'true' && LOOPBACK_HOSTNAMES.includes(location.hostname)
}

async function readLocalSettings(signal: AbortSignal) {
  const response = await fetch(`${import.meta.env.BASE_URL}${LOCAL_SETTINGS_PATH.slice(1)}`, {
    headers: { [LOCAL_SETTINGS_HEADER]: '1' },
    cache: 'no-store', credentials: 'omit', mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer', signal,
  })
  signal.throwIfAborted()
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`Could not load local settings. Check ${LOCAL_SETTINGS_FILE} and reload.`)
  const text = await response.text()
  signal.throwIfAborted()
  if (text.length > 32000) throw new Error('Local settings are too large.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Local settings were not valid JSON.')
  }
  const parsed = localSettingsSchema.safeParse(value)
  if (!parsed.success) throw new Error('Local settings are invalid or connection storage has not been acknowledged.')
  return parsed.data
}

async function importAIConnection(connection: AIConnectionInput | undefined, signal: AbortSignal): Promise<LocalAIConnectionResult> {
  return db.transaction('rw', db.aiConnections, async () => {
    signal.throwIfAborted()
    // A manual save or another tab may have configured AI while the file was loading.
    const current = await db.aiConnections.get('assistant')
    signal.throwIfAborted()
    if (current) return 'existing'
    if (!connection) return 'missing'
    await saveAIConnection(connection)
    signal.throwIfAborted()
    return 'loaded'
  })
}

async function importSpeechConnection(connection: SpeechConnectionInput | undefined, signal: AbortSignal): Promise<LocalAIConnectionResult> {
  return db.transaction('rw', db.speechConnections, async () => {
    signal.throwIfAborted()
    const current = await db.speechConnections.get('assistant-speech')
    signal.throwIfAborted()
    if (current) return 'existing'
    if (!connection) return 'missing'
    await saveSpeechConnection(connection)
    signal.throwIfAborted()
    return 'loaded'
  })
}

async function importDefaultSpeechRate(rate: SpeechRate | undefined, signal: AbortSignal): Promise<LocalAIConnectionResult> {
  return db.transaction('rw', db.preferences, async () => {
    signal.throwIfAborted()
    const current = await db.preferences.get('workspace')
    signal.throwIfAborted()
    if (rate === undefined) return current?.defaultSpeechRate === undefined ? 'missing' : 'existing'
    if (current?.defaultSpeechRate === rate) return 'existing'
    if (!current) throw new Error('Workspace not found. Reload before importing preferences.')
    await db.preferences.put({ ...current, defaultSpeechRate: rate })
    signal.throwIfAborted()
    return 'loaded'
  })
}

export async function initializeLocalConnections(signal: AbortSignal): Promise<LocalConnectionsResult> {
  if (!localSettingsAvailable()) return { aiConnection: 'unavailable', speechConnection: 'unavailable', defaultSpeechRate: 'unavailable' }
  signal.throwIfAborted()
  const [ai, speech] = await Promise.all([
    db.aiConnections.get('assistant'), db.speechConnections.get('assistant-speech'),
  ])
  signal.throwIfAborted()

  let settings: Awaited<ReturnType<typeof readLocalSettings>>
  try {
    settings = await readLocalSettings(signal)
  } catch {
    signal.throwIfAborted()
    return {
      aiConnection: ai ? 'existing' : 'error', speechConnection: speech ? 'existing' : 'error',
      defaultSpeechRate: 'error',
    }
  }
  // Each import has its own transaction, so one storage failure cannot block the others.
  const [aiResult, speechResult, rateResult] = await Promise.allSettled([
    ai ? Promise.resolve<LocalAIConnectionResult>('existing') : importAIConnection(settings?.aiConnection, signal),
    speech ? Promise.resolve<LocalAIConnectionResult>('existing') : importSpeechConnection(settings?.speechConnection, signal),
    importDefaultSpeechRate(settings?.defaultSpeechRate, signal),
  ])
  signal.throwIfAborted()
  return {
    aiConnection: aiResult.status === 'fulfilled' ? aiResult.value : 'error',
    speechConnection: speechResult.status === 'fulfilled' ? speechResult.value : 'error',
    defaultSpeechRate: rateResult.status === 'fulfilled' ? rateResult.value : 'error',
  }
}

// Retain the AI-only import and rejection behavior for existing callers.
export async function initializeLocalAIConnection(signal: AbortSignal): Promise<LocalAIConnectionResult> {
  if (!localSettingsAvailable()) return 'unavailable'
  signal.throwIfAborted()
  const existing = await db.aiConnections.get('assistant')
  signal.throwIfAborted()
  if (existing) return 'existing'
  const settings = await readLocalSettings(signal)
  return importAIConnection(settings?.aiConnection, signal)
}
