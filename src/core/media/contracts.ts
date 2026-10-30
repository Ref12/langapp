import { z } from 'zod'

/** Medusa's media item (protocol v1.1) flattened for storage; also what a `.medusa.json` file holds once flattened. */
export const mediaLineSchema = z.object({
  start: z.number().min(0).max(1_000_000),
  end: z.number().min(0).max(1_000_000),
  text: z.string().min(1).max(2000),
}).strict()

export const syncAnchorSchema = z.object({ at: z.number().min(0).max(1_000_000), offset: z.number().min(-3600).max(3600) }).strict()
export type SyncAnchor = z.infer<typeof syncAnchorSchema>

export const wovenTokenSchema = z.object({ text: z.string().min(1).max(60), pinyin: z.string().max(160), meaning: z.string().max(240), trailing: z.string().max(60) }).strict()
export type WovenToken = z.infer<typeof wovenTokenSchema>

/** AI translation aligned to subtitle lines (design section 3) plus per-word weaving tokens (section 4); grows chunk by chunk. */
export const alignedSchema = z.object({
  sentences: z.array(z.object({
    lines: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
    translation: z.string().min(1).max(1200),
    fragments: z.array(z.object({ line: z.number().int().min(0), text: z.string().min(1).max(600) }).strict()).max(60),
  }).strict()).max(40_000),
  tokens: z.array(z.object({ line: z.number().int().min(0), items: z.array(wovenTokenSchema).max(300) }).strict()).max(30_000),
  /** Lines before this index are translated; a run resumes from here. */
  upTo: z.number().int().min(0),
  updatedAt: z.number(),
}).strict()
export type Aligned = z.infer<typeof alignedSchema>

/** A word drawn from a media source that is not in the curriculum. It is a dictionary entry, never a curriculum unit. */
export const sourceEntrySchema = z.object({
  id: z.string().regex(/^s[a-z0-9]+$/).max(40),
  word: z.string().min(1).max(60),
  pinyin: z.string().min(1).max(160),
  meanings: z.array(z.string().min(1).max(120)).min(1).max(3),
  pos: z.string().max(30),
  /** One example per source the word came from. */
  sources: z.array(z.object({ mediaId: z.string().max(200), title: z.string().max(500), line: z.number().int().min(0), text: z.string().min(1).max(2000) }).strict()).min(1).max(100),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict()
export type SourceEntry = z.infer<typeof sourceEntrySchema>

/** Pass 2 result for one item: which entry each distinct token links to, plus counts per entry. */
export const entryLinksSchema = z.object({
  /** token text -> `vocabulary:...` (curriculum) or `source:...` (source entry). */
  links: z.record(z.string().min(1).max(60), z.string().min(1).max(120)),
  /** Tokens the AI judged not to be words (names, segmentation artefacts). */
  skipped: z.array(z.string().min(1).max(60)).max(40_000),
  /** Occurrences per entry ref across the whole item. */
  counts: z.record(z.string(), z.number().int().min(0)),
  /** Distinct tokens in the last run, and whether every one is resolved. */
  total: z.number().int().min(0),
  complete: z.boolean(),
  updatedAt: z.number(),
}).strict()
export type EntryLinks = z.infer<typeof entryLinksSchema>

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
  aligned: alignedSchema.optional(),
  entries: entryLinksSchema.optional(),
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

export interface LineTranslation { fragment: string; sentence: string; /** The fragment is the whole sentence (no natural split). */ shared: boolean }

/** The aligned view of one line: its fragment and whole sentence, plus weaving tokens when present. */
export function lineView(aligned: Aligned | undefined, line: number): { translation?: LineTranslation; tokens?: WovenToken[] } {
  if (!aligned) return {}
  const tokens = aligned.tokens.find(entry => entry.line === line)?.items
  const sentence = aligned.sentences.find(entry => line >= entry.lines[0] && line <= entry.lines[1])
  if (!sentence) return { tokens }
  const fragment = sentence.fragments.find(entry => entry.line === line)
  return { tokens, translation: { fragment: fragment?.text ?? sentence.translation, sentence: sentence.translation, shared: !fragment } }
}
