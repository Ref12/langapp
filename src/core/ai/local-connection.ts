import { db } from '../database'
import { LOOPBACK_HOSTNAMES } from '../assistant/contracts'
import { localSettingsSchema, LOCAL_SETTINGS_FILE, LOCAL_SETTINGS_HEADER, LOCAL_SETTINGS_PATH } from '../local-settings-contracts'
import { saveAIConnection } from '../assistant/store'

export type LocalAIConnectionResult = 'unavailable' | 'existing' | 'missing' | 'loaded'

export async function initializeLocalAIConnection(signal: AbortSignal): Promise<LocalAIConnectionResult> {
  if (!import.meta.env.DEV || import.meta.env.DEV_LOCAL_SETTINGS !== 'true' || !LOOPBACK_HOSTNAMES.includes(location.hostname)) return 'unavailable'
  signal.throwIfAborted()
  const existing = await db.aiConnections.get('assistant')
  signal.throwIfAborted()
  if (existing) return 'existing'

  const response = await fetch(`${import.meta.env.BASE_URL}${LOCAL_SETTINGS_PATH.slice(1)}`, {
    headers: { [LOCAL_SETTINGS_HEADER]: '1' },
    cache: 'no-store', credentials: 'omit', mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer', signal,
  })
  signal.throwIfAborted()
  if (response.status === 404) return 'missing'
  if (!response.ok) throw new Error(`Could not load local settings. Check ${LOCAL_SETTINGS_FILE} and reload.`)
  const text = await response.text()
  if (text.length > 32000) throw new Error('Local settings are too large.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Local settings were not valid JSON.')
  }
  const parsed = localSettingsSchema.safeParse(value)
  if (!parsed.success) throw new Error('Local settings are invalid or AI storage has not been acknowledged.')
  const connection = parsed.data.aiConnection
  if (!connection) return 'missing'

  return db.transaction('rw', db.aiConnections, async () => {
    signal.throwIfAborted()
    // A manual save or another tab may have configured AI while the file was loading.
    const current = await db.aiConnections.get('assistant')
    signal.throwIfAborted()
    if (current) return 'existing'
    await saveAIConnection(connection)
    signal.throwIfAborted()
    return 'loaded'
  })
}
