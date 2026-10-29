import { z } from 'zod'

/** Medusa's media item (protocol v1.1) flattened for storage; also what a `.medusa.json` file holds once flattened. */
export const mediaLineSchema = z.object({
  start: z.number().min(0).max(1_000_000),
  end: z.number().min(0).max(1_000_000),
  text: z.string().min(1).max(2000),
}).strict()

export const syncAnchorSchema = z.object({ at: z.number().min(0).max(1_000_000), offset: z.number().min(-3600).max(3600) }).strict()
export type SyncAnchor = z.infer<typeof syncAnchorSchema>

export const mediaResultSchema = z.object({
  url: z.string().min(1).max(4000),
  title: z.string().min(1).max(500),
  durationSec: z.number().min(0).optional(),
  extractor: z.string().max(80),
  videoId: z.string().max(200).optional(),
  source: z.enum(['captions', 'auto-captions', 'asr']),
  language: z.string().max(40),
  lines: z.array(mediaLineSchema).max(30_000),
  mediaId: z.string().max(200).optional(),
  hasVideo: z.boolean().optional(),
  videoPath: z.string().max(500).optional(),
  sync: z.array(syncAnchorSchema).max(2000).optional(),
  syncDirty: z.boolean().optional(),
}).passthrough()
export type MediaResult = z.infer<typeof mediaResultSchema>
export type MediaLine = z.infer<typeof mediaLineSchema>

export const mediaItemSchema = mediaResultSchema.extend({ id: z.string().uuid(), savedAt: z.number() })

/** Medusa's wire format (protocol v1.1, section 2) and the `.medusa.json` file. */
export const medusaItemSchema = z.object({
  mediaId: z.string().max(200).optional(),
  url: z.string().min(1).max(4000),
  title: z.string().min(1).max(500),
  durationSec: z.number().min(0).optional(),
  extractor: z.string().max(80).default(''),
  videoId: z.string().max(200).nullish(),
  video: z.object({ path: z.string().max(500), contentType: z.string().optional(), bytes: z.number().optional() }).passthrough().nullish(),
  subtitles: z.object({ source: z.enum(['captions', 'auto-captions', 'asr']), language: z.string().max(40), lines: z.array(mediaLineSchema).max(30_000) }).nullish(),
  sync: z.array(syncAnchorSchema).max(2000).nullish(),
}).passthrough()

export function fromMedusa(raw: z.infer<typeof medusaItemSchema>): MediaResult {
  return {
    url: raw.url, title: raw.title, durationSec: raw.durationSec, extractor: raw.extractor, videoId: raw.videoId ?? undefined,
    source: raw.subtitles?.source ?? 'captions', language: raw.subtitles?.language ?? '', lines: raw.subtitles?.lines ?? [],
    mediaId: raw.mediaId, hasVideo: !!raw.video, videoPath: raw.video?.path, sync: raw.sync ?? [],
  }
}

/** Offset in effect at video time `t` (0 before the first anchor). */
export function offsetAt(sync: readonly SyncAnchor[], t: number): number {
  let offset = 0
  for (const anchor of sync) { if (anchor.at <= t) offset = anchor.offset; else break }
  return offset
}

/** Anchors sorted by time, one per `at`. */
export function withAnchor(sync: readonly SyncAnchor[], anchor: SyncAnchor): SyncAnchor[] {
  return [...sync.filter(entry => entry.at !== anchor.at), anchor].sort((a, b) => a.at - b.at)
}
export interface MediaItem extends MediaResult { id: string; savedAt: number }

/** Index of the line showing at video time `time` once the sync anchors are applied (the previous line stays up through a gap). */
export function currentLine(lines: readonly MediaLine[], time: number, sync: readonly SyncAnchor[] = []): number {
  let found = -1
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].start + offsetAt(sync, lines[index].start) <= time) found = index
    else if (lines[index].start - 3600 > time) break
  }
  return found
}

/** Add `delta` seconds to the anchor in effect at `time`, or start a new anchor at `lineStart` when it is over 30 s old. */
export function nudge(sync: readonly SyncAnchor[], time: number, lineStart: number, delta: number): SyncAnchor[] {
  const active = [...sync].reverse().find(entry => entry.at <= time)
  if (active && time - active.at <= 30) return withAnchor(sync, { at: active.at, offset: Math.round((active.offset + delta) * 100) / 100 })
  return withAnchor(sync, { at: lineStart, offset: Math.round((offsetAt(sync, lineStart) + delta) * 100) / 100 })
}
