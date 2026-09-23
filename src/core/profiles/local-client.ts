import { z } from 'zod'
import { LOOPBACK_HOSTNAMES } from '../assistant/contracts'
import { MAX_PROFILE_BYTES } from './contracts'
import { parseProfileYaml } from './codec'
import { profileIdSchema, profileMetadataSchema } from './identity'
import { LOCAL_PROFILES_HEADER, LOCAL_PROFILES_PATH } from './local-contracts'

const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/i)
const fileSchema = profileMetadataSchema.extend({ revision: revisionSchema })
const listSchema = z.object({ profiles: z.array(fileSchema).max(500) }).strict()
const readSchema = z.object({ yaml: z.string(), revision: revisionSchema }).strict()
const savedSchema = z.object({ profile: profileMetadataSchema, revision: revisionSchema }).strict()
export type LocalProfileFile = z.infer<typeof fileSchema>
class LocalProfileError extends Error {}

export function localProfilesAvailable() {
  return import.meta.env.DEV && import.meta.env.DEV_LOCAL_PROFILES === 'true'
    && typeof location !== 'undefined' && LOOPBACK_HOSTNAMES.includes(location.hostname)
}

async function request(path: string, signal: AbortSignal, body?: string): Promise<unknown> {
  if (!localProfilesAvailable()) throw new Error('Data-folder import and export require the local development server.')
  signal.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}${path.slice(1)}`, {
      method: body === undefined ? 'GET' : 'PUT',
      headers: { [LOCAL_PROFILES_HEADER]: '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body, signal: controller.signal, credentials: 'omit', cache: 'no-store',
      mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer',
    })
    controller.signal.throwIfAborted()
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 409) throw new LocalProfileError('The server copy changed. Refresh the data-folder list and review it before exporting again.')
      throw new LocalProfileError(`Local profile operation failed (HTTP ${response.status}). No import was applied. For an export, refresh the list to check the server copy.`)
    }
    if (!response.headers.get('content-type')?.startsWith('application/json') || !response.body) {
      await response.body?.cancel()
      throw new LocalProfileError('The local profile server returned an invalid response.')
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let size = 0
    let text = ''
    let complete = false
    try {
      while (true) {
        const part = await reader.read()
        controller.signal.throwIfAborted()
        if (part.done) { complete = true; break }
        size += part.value.byteLength
        if (size > MAX_PROFILE_BYTES * 2 + 16_384) throw new LocalProfileError('The local profile response is too large.')
        text += decoder.decode(part.value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      try { if (!complete) await reader.cancel() } finally { reader.releaseLock() }
    }
    try { return JSON.parse(text) } catch { throw new LocalProfileError('The local profile server returned invalid JSON.') }
  } catch (error) {
    if (signal.aborted) throw new Error('The local profile operation was cancelled.')
    if (controller.signal.aborted) throw new Error('The local profile operation timed out. Refresh the list before retrying an export.')
    if (error instanceof LocalProfileError) throw error
    throw new Error('Could not reach the local profile server. Refresh the list before retrying an export.')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

export async function listLocalProfiles(signal: AbortSignal): Promise<LocalProfileFile[]> {
  const result = listSchema.safeParse(await request(LOCAL_PROFILES_PATH, signal))
  if (!result.success) throw new Error('The local profile list is invalid.')
  return result.data.profiles
}

export async function readLocalProfile(id: string, signal: AbortSignal) {
  if (!profileIdSchema.safeParse(id).success) throw new Error('Choose a valid profile.')
  const result = readSchema.safeParse(await request(`${LOCAL_PROFILES_PATH}/${id}`, signal))
  if (!result.success) throw new Error('The local profile file response is invalid.')
  const snapshot = parseProfileYaml(result.data.yaml)
  if (snapshot.profile.id !== id) throw new Error('The profile file does not match the selected profile.')
  return result.data
}

export async function saveLocalProfile(yaml: string, expectedRevision: string | null, signal: AbortSignal) {
  const snapshot = parseProfileYaml(yaml)
  if (expectedRevision !== null && !revisionSchema.safeParse(expectedRevision).success) throw new Error('Refresh the server copy before exporting.')
  const result = savedSchema.safeParse(await request(`${LOCAL_PROFILES_PATH}/${snapshot.profile.id}`, signal,
    JSON.stringify({ yaml, expectedRevision })))
  if (!result.success || result.data.profile.id !== snapshot.profile.id) throw new Error('The server export could not be confirmed. Refresh the data-folder list.')
  return result.data
}
