import { fromMedusa, medusaItemSchema, type MediaResult, type SyncAnchor } from './contracts'

// Client for the Medusa protocol v1.1. Medusa is a separate app; this module only speaks its local HTTP API and builds its deep link.
export const HELPER_ORIGIN = 'http://127.0.0.1:38917'
export const HELPER_INSTALL_PAGE = 'https://github.com/lancec-codebox/appbox/releases'
export const timing = { pollMs: 1000, probeMs: 1500, tickMs: 100, syncDebounceMs: 600 }
/** Subtitle languages to ask Medusa for; a later target-language setting can replace this. */
export const MEDIA_LANGUAGES = ['zh-Hans', 'zh-CN', 'zh', 'zh-Hant', 'zh-TW']
export type JobState = 'queued' | 'fetching' | 'downloading' | 'done' | 'failed'
export interface JobStatus { id: string; state: JobState; progress?: number; code?: string; message?: string }

/** Medusa answered, but the job failed or the reply was not what the protocol promises. */
export class HelperError extends Error {
  code?: string
  constructor(message: string, code?: string) { super(message); this.code = code }
}
/** Nothing answered on 127.0.0.1 (Medusa not running, or the browser blocked the request). */
export class HelperUnreachable extends Error {}

/** Opens the deep link; a seam so tests can observe it. */
export const launcher = { open(url: string): void { window.location.assign(url) } }

export function friendlyFailure(code: string | undefined, message: string | undefined): string {
  if (code === 'bot_check') return 'YouTube wants a sign-in before it will share this video. Try again later, or on Wi-Fi.'
  if (code === 'no_captions') return 'This video has no Chinese subtitles. It can still be watched in Medusa.'
  return message ?? 'Medusa could not fetch this link.'
}

export function videoUrl(path: string): string { return `${HELPER_ORIGIN}${path}` }

async function call(path: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${HELPER_ORIGIN}${path}`, { ...init, signal: controller.signal })
  } catch {
    throw new HelperUnreachable('Medusa did not answer.')
  } finally {
    clearTimeout(timer)
  }
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json() } catch { throw new HelperError('Medusa sent a reply this app cannot read.') }
}

export async function probeHelper(timeoutMs = timing.probeMs): Promise<boolean> {
  try {
    const response = await call('/v1/status', undefined, timeoutMs)
    const body = await readJson(response) as { app?: string }
    return response.ok && body.app === 'medusa'
  } catch { return false }
}

export async function createJob(id: string, url: string): Promise<string> {
  const response = await call('/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, url, languages: MEDIA_LANGUAGES, want: ['subtitles', 'video'] }) }, 10_000)
  const body = await readJson(response) as { id?: string; message?: string }
  if (!response.ok || typeof body.id !== 'string') throw new HelperError(body.message ?? 'Medusa could not start this job.')
  return body.id
}

export async function jobStatus(id: string): Promise<JobStatus> {
  const response = await call(`/v1/jobs/${encodeURIComponent(id)}`, undefined, 5000)
  const body = await readJson(response) as Partial<JobStatus>
  if (!response.ok || !body.state) throw new HelperError(body.message ?? 'Medusa does not know this job.')
  return { id, state: body.state, progress: body.progress, code: body.code, message: body.message }
}

function parseItem(body: unknown): MediaResult {
  const parsed = medusaItemSchema.safeParse(body)
  if (!parsed.success) throw new HelperError('Medusa returned something this app cannot read.')
  return fromMedusa(parsed.data)
}

export async function jobResult(id: string): Promise<MediaResult> {
  const response = await call(`/v1/jobs/${encodeURIComponent(id)}/result`, undefined, 15_000)
  const body = await readJson(response)
  if (!response.ok) throw new HelperError('Medusa returned something this app cannot read.')
  return parseItem(body)
}

/** Medusa's current copy of a saved item (its sync may be newer than ours); undefined when unreachable or gone. */
export async function fetchSync(mediaId: string): Promise<SyncAnchor[] | undefined> {
  try {
    const response = await call(`/v1/media/${encodeURIComponent(mediaId)}/sync`, undefined, 3000)
    if (!response.ok) return undefined
    const body = await readJson(response) as { sync?: SyncAnchor[] }
    return Array.isArray(body.sync) ? body.sync : undefined
  } catch { return undefined }
}

export async function putSync(mediaId: string, sync: readonly SyncAnchor[]): Promise<boolean> {
  try {
    const response = await call(`/v1/media/${encodeURIComponent(mediaId)}/sync`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sync }) }, 5000)
    return response.ok
  } catch { return false }
}

/** Poll until the job is done (returning its result) or failed (throwing a friendly message with Medusa's code). */
export async function waitForJob(id: string, options: { intervalMs?: number; signal?: AbortSignal; onStatus?: (status: JobStatus) => void } = {}): Promise<MediaResult> {
  const { intervalMs = timing.pollMs, signal, onStatus } = options
  for (;;) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError')
    const status = await jobStatus(id)
    onStatus?.(status)
    if (status.state === 'done') return jobResult(id)
    if (status.state === 'failed') throw new HelperError(friendlyFailure(status.code, status.message), status.code)
    await new Promise<void>(resolve => setTimeout(resolve, intervalMs))
  }
}

/** This app's own URL for a route, built from the page's base so it works under a sub-path and on GitHub Pages. */
export function appUrl(route: string): string {
  const url = new URL(document.baseURI)
  url.hash = route
  return url.href
}

/** The Chrome intent URL that wakes Medusa (protocol section 1); every value is URL-encoded. */
export function helperIntentUrl(job: string, mediaUrl: string, returnUrl: string, installUrl: string): string {
  const e = encodeURIComponent
  return `intent://open?job=${e(job)}&url=${e(mediaUrl)}&languages=${e(MEDIA_LANGUAGES.join(','))}&want=${e('subtitles,video')}&return=${e(returnUrl)}#Intent;scheme=medusa;package=io.ref12.medusa;S.browser_fallback_url=${e(installUrl)};end`
}

export function parseTranscriptFile(text: string): MediaResult {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new HelperError('This file is not a transcript file from Medusa.') }
  const parsed = medusaItemSchema.safeParse(value)
  if (!parsed.success || !parsed.data.subtitles?.lines.length) throw new HelperError('This file is not a transcript file from Medusa.')
  return { ...fromMedusa(parsed.data), hasVideo: false, videoPath: undefined }
}
