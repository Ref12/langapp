import type { Aligned, MediaItem, MediaLine } from './contracts'
import { HELPER_ORIGIN, HelperUnreachable } from './helper'

export interface TrackLine { start: number; end: number; text: string }
export interface Track { language: string; label: string; source: 'added'; origin: 'linguaweave'; lines: TrackLine[] }
export type TrackKind = 'translation' | 'pinyin'

/** English lines for Medusa: one per line with its fragment; a sentence with no natural split goes on its first line, stretched over the sentence. */
export function translationLines(lines: readonly MediaLine[], aligned: Aligned): TrackLine[] {
  const out: TrackLine[] = []
  for (const sentence of aligned.sentences) {
    const [first, last] = sentence.lines
    if (!lines[first] || !lines[last]) continue
    if (sentence.fragments.length <= 1 && last > first) {
      out.push({ start: lines[first].start, end: lines[last].end, text: sentence.translation })
      continue
    }
    for (let index = first; index <= last; index++) {
      const text = sentence.fragments.find(fragment => fragment.line === index)?.text ?? (first === last ? sentence.translation : undefined)
      if (text) out.push({ start: lines[index].start, end: lines[index].end, text })
    }
  }
  return out
}

/** One pinyin line per subtitle line, from the woven tokens (words joined by spaces). */
export function pinyinLines(lines: readonly MediaLine[], aligned: Aligned): TrackLine[] {
  const out: TrackLine[] = []
  for (const entry of aligned.tokens) {
    const line = lines[entry.line]
    const text = entry.items.map(token => token.pinyin.trim()).filter(Boolean).join(' ')
    if (line && text) out.push({ start: line.start, end: line.end, text })
  }
  return out
}

export function buildTrack(item: MediaItem, kind: TrackKind): Track {
  const aligned = item.aligned
  if (!aligned || !aligned.upTo) throw new Error('Translate this media first.')
  return kind === 'translation'
    ? { language: 'en', label: 'English (AI)', source: 'added', origin: 'linguaweave', lines: translationLines(item.lines, aligned) }
    : { language: 'zh-Latn-pinyin', label: 'Pinyin', source: 'added', origin: 'linguaweave', lines: pinyinLines(item.lines, aligned) }
}

export type SendResult = { ok: true } | { ok: false; reason: 'unreachable' | 'unsupported' | 'failed'; message: string }

/** Posts the track to Medusa (protocol v1.3, Medusa 1.4+); Medusa replaces by language + origin. A 404 means an older Medusa. */
export async function sendTrack(item: MediaItem, kind: TrackKind): Promise<SendResult> {
  if (!item.mediaId) return { ok: false, reason: 'unsupported', message: 'This media was not saved from Medusa.' }
  const track = buildTrack(item, kind)
  if (!track.lines.length) return { ok: false, reason: 'failed', message: 'There is nothing to send yet.' }
  try {
    const response = await fetch(`${HELPER_ORIGIN}/v1/media/${encodeURIComponent(item.mediaId)}/tracks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(track) })
    if (response.ok) return { ok: true }
    if (response.status === 404) return { ok: false, reason: 'unsupported', message: 'This Medusa is too old to add tracks (needs 1.4).' }
    return { ok: false, reason: 'failed', message: 'Medusa did not accept the track.' }
  } catch (reason) {
    return { ok: false, reason: 'unreachable', message: reason instanceof HelperUnreachable ? reason.message : 'Medusa did not answer.' }
  }
}

function stamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000))
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(Math.floor(total / 3_600_000))}:${pad(Math.floor(total / 60_000) % 60)}:${pad(Math.floor(total / 1000) % 60)},${pad(total % 1000, 3)}`
}

export function toSrt(lines: readonly TrackLine[]): string {
  return lines.map((line, index) => `${index + 1}\n${stamp(line.start)} --> ${stamp(line.end)}\n${line.text}\n`).join('\n')
}

/** The two files the user can open with Medusa when it cannot take the track directly. */
export function trackFiles(item: MediaItem, kind: TrackKind): { srt: { name: string; text: string }; json: { name: string; text: string } } {
  const track = buildTrack(item, kind)
  const base = `${item.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'media'}.${track.language}`
  return {
    srt: { name: `${base}.srt`, text: toSrt(track.lines) },
    json: { name: `${base}.medusa-track.json`, text: JSON.stringify({ mediaId: item.mediaId, url: item.url, track }, null, 2) },
  }
}
