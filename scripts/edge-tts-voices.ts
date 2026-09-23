import { z } from 'zod'
import { edgeVoiceIdSchema } from '../src/core/assistant/contracts'
import { edgeVoiceCatalogSchema, type EdgeVoice } from '../src/core/local-tts-contracts'
import { buildEdgeUrl, edgeClientHeaders, EdgeTtsError } from './edge-tts'

const TIMEOUT_MS = 15_000
const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const field = (max: number) => z.string().min(1).max(max).refine(
  value => value.trim().length > 0 && Array.from(value).every(character => {
    const code = character.charCodeAt(0)
    return code >= 32 && (code < 127 || code > 159)
  }),
)
const upstreamCatalogSchema = z.array(z.object({
  ShortName: field(200),
  Name: field(512),
  FriendlyName: field(512).optional(),
  Locale: field(100).refine(value => /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(value)),
  Gender: field(30),
})).min(1).max(4096)

function parseCatalog(value: unknown): EdgeVoice[] {
  const catalog = upstreamCatalogSchema.parse(value)
  const ids = new Set<string>()
  const voices: EdgeVoice[] = []
  for (const voice of catalog) {
    if (ids.has(voice.ShortName)
      || voice.ShortName.slice(0, voice.ShortName.lastIndexOf('-')) !== voice.Locale) {
      throw new EdgeTtsError(502, 'catalog')
    }
    ids.add(voice.ShortName)
    if (!edgeVoiceIdSchema.safeParse(voice.ShortName).success) continue
    voices.push({
      id: voice.ShortName, name: voice.FriendlyName ?? voice.Name, locale: voice.Locale, gender: voice.Gender,
    })
  }
  if (!voices.length) throw new EdgeTtsError(502, 'catalog')
  return edgeVoiceCatalogSchema.parse({ voices }).voices
}

export async function listEdgeVoices(signal: AbortSignal): Promise<EdgeVoice[]> {
  signal.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => controller.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new EdgeTtsError(504, 'catalog')), TIMEOUT_MS)
  try {
    const response = await fetch(buildEdgeUrl('voices'), {
      method: 'GET', headers: edgeClientHeaders('voices'), signal: controller.signal, redirect: 'error',
    })
    if (!response.body) throw new EdgeTtsError(502, 'catalog')
    const reader = response.body.getReader()
    try {
      if (response.status !== 200
        || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? '')
        || Number(response.headers.get('content-length')) > MAX_CATALOG_BYTES) {
        throw new EdgeTtsError(502, 'catalog')
      }
      const chunks: Buffer[] = []
      let bytes = 0
      while (true) {
        controller.signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > MAX_CATALOG_BYTES) throw new EdgeTtsError(502, 'catalog')
        chunks.push(Buffer.from(value))
      }
      controller.signal.throwIfAborted()
      return parseCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))))
    } finally {
      void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (controller.signal.aborted) throw controller.signal.reason
    controller.abort()
    throw error instanceof EdgeTtsError ? error : new EdgeTtsError(502, 'catalog')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
  }
}
