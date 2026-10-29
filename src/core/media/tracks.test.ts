import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Aligned, MediaItem, MediaLine } from './contracts'
import { buildTrack, pinyinLines, sendTrack, toSrt, trackFiles, translationLines } from './tracks'

const lines: MediaLine[] = [0, 1, 2, 3].map(i => ({ start: i * 2, end: i * 2 + 1.5, text: `行${i}` }))
const aligned: Aligned = {
  sentences: [
    { lines: [0, 1], translation: 'Hello there.', fragments: [{ line: 0, text: 'Hello' }, { line: 1, text: 'there.' }] },
    { lines: [2, 3], translation: 'One whole sentence.', fragments: [{ line: 2, text: 'One whole sentence.' }] },
  ],
  tokens: [
    { line: 0, items: [{ text: '你', pinyin: 'nǐ', meaning: 'you', trailing: '' }, { text: '好', pinyin: 'hǎo', meaning: 'good', trailing: '' }] },
    { line: 1, items: [{ text: '。', pinyin: '', meaning: '', trailing: '' }] },
    { line: 2, items: [{ text: '再见', pinyin: 'zàijiàn', meaning: 'bye', trailing: '' }] },
  ],
  upTo: 4, updatedAt: 1,
}
const item = { id: 'i', mediaId: 'm 1', url: 'https://x/v', title: 'A drama!', lines, aligned } as unknown as MediaItem

afterEach(() => vi.restoreAllMocks())

describe('track lines', () => {
  it('uses fragments per line and stretches an unsplit sentence over its lines', () => {
    expect(translationLines(lines, aligned)).toEqual([
      { start: 0, end: 1.5, text: 'Hello' }, { start: 2, end: 3.5, text: 'there.' },
      { start: 4, end: 7.5, text: 'One whole sentence.' },
    ])
  })
  it('builds a pinyin track from the woven tokens, one line each, skipping lines without pinyin', () => {
    expect(pinyinLines(lines, aligned)).toEqual([{ start: 0, end: 1.5, text: 'nǐ hǎo' }, { start: 4, end: 5.5, text: 'zàijiàn' }])
    expect(buildTrack(item, 'pinyin')).toMatchObject({ language: 'zh-Latn-pinyin', label: 'Pinyin', source: 'added', origin: 'linguaweave' })
    expect(buildTrack(item, 'translation')).toMatchObject({ language: 'en', label: 'English (AI)' })
  })
  it('refuses before translation', () => {
    expect(() => buildTrack({ ...item, aligned: undefined }, 'translation')).toThrow(/Translate/)
  })
})

describe('sending', () => {
  it('posts the track to the media endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendTrack(item, 'translation')).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:38917/v1/media/m%201/tracks')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({ language: 'en', label: 'English (AI)', source: 'added', origin: 'linguaweave' })
    expect(JSON.parse(init.body).lines).toHaveLength(3)
  })
  it('reports an older Medusa on 404 and an unreachable one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })))
    expect(await sendTrack(item, 'translation')).toMatchObject({ ok: false, reason: 'unsupported' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    expect(await sendTrack(item, 'pinyin')).toMatchObject({ ok: false, reason: 'unreachable' })
  })
})

describe('file fallback', () => {
  it('writes an srt and a track json with the media id and url', () => {
    const files = trackFiles(item, 'translation')
    expect(files.srt.name).toBe('A-drama.en.srt')
    expect(files.srt.text).toBe(toSrt(translationLines(lines, aligned)))
    expect(files.srt.text.split('\n\n')[0]).toBe('1\n00:00:00,000 --> 00:00:01,500\nHello')
    const json = JSON.parse(files.json.text)
    expect(files.json.name).toBe('A-drama.en.medusa-track.json')
    expect(json).toMatchObject({ mediaId: 'm 1', url: 'https://x/v', track: { language: 'en' } })
  })
})
