import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../database'
import { clipPitchCurves, playClip, resetPlayCachesForTests, setPlaybackRate, speechRatePreference } from './play'

/** A stand-in for the browser's audio element that records what is set on it and ends as soon as it plays. */
class FakeAudio {
  static made: FakeAudio[] = []
  playbackRate = 1; defaultPlaybackRate = 1; preservesPitch = false; webkitPreservesPitch = false
  onended: (() => void) | null = null; onerror: (() => void) | null = null
  constructor(public src: string) { FakeAudio.made.push(this) }
  pause() {}
  play() { setTimeout(() => this.onended?.(), 0); return Promise.resolve() }
}

beforeEach(async () => {
  FakeAudio.made = []; resetPlayCachesForTests()
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:clip' }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response('sound')))
  await db.delete(); await db.open()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('playing a trainer clip at the speech rate', () => {
  it('reads the rate of Settings, 1 when it was never set', async () => {
    expect(await speechRatePreference()).toBe(1)
    await db.preferences.put({ id: 'workspace', language: 'zh-Hans', name: 'Me', theme: 'dark', pinyin: false, readingMode: 'source', sidebarCollapsed: false, defaultSpeechRate: 0.75 })
    expect(await speechRatePreference()).toBe(0.75)
  })
  it('sets the rate on the element and keeps the pitch (the standard and the webkit spelling)', async () => {
    await playClip('xiaoxiao/play-a.mp3', undefined, 0.5)
    const [audio] = FakeAudio.made
    expect(audio.playbackRate).toBe(0.5)
    expect(audio.defaultPlaybackRate).toBe(0.5)
    expect(audio.preservesPitch).toBe(true)
    expect(audio.webkitPreservesPitch).toBe(true)
  })
  it('plays at 1x with the pitch kept when no rate is given', async () => {
    await playClip('xiaoxiao/play-b.mp3')
    expect(FakeAudio.made[0].playbackRate).toBe(1)
    expect(FakeAudio.made[0].preservesPitch).toBe(true)
  })
  it('does not add a prefixed property the browser does not have', () => {
    const audio = { playbackRate: 1, defaultPlaybackRate: 1, preservesPitch: false } as HTMLAudioElement
    setPlaybackRate(audio, 1.25)
    expect(audio.playbackRate).toBe(1.25)
    expect('webkitPreservesPitch' in audio).toBe(false)
  })
})

describe('the pitch curves of a clip', () => {
  const decoded = vi.fn()
  class FakeContext {
    async decodeAudioData() { decoded(); return { sampleRate: 16000, getChannelData: () => Float32Array.from({ length: 16000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 150 * i / 16000)) } }
    close() { return Promise.resolve() }
  }
  beforeEach(() => { decoded.mockClear(); vi.stubGlobal('AudioContext', FakeContext) })
  it('are tracked from the decoded clip, for a single and (in two parts) for a pair, and kept per clip', async () => {
    const single = await clipPitchCurves('yunxi/c-a.mp3', 'yunxi', 1)
    expect(single).toHaveLength(1)
    expect(single[0]).toHaveLength(20)
    const again = await clipPitchCurves('yunxi/c-a.mp3', 'yunxi', 1)
    expect(again).toBe(single)
    expect(decoded).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(await clipPitchCurves('yunxi/c-b.mp3', 'yunxi', 2)).toHaveLength(2)
  })
  it('come out empty, not as an error, when the sound cannot be decoded', async () => {
    vi.stubGlobal('AudioContext', class { async decodeAudioData() { throw new Error('bad') } })
    expect(await clipPitchCurves('yunxi/c-c.mp3', 'yunxi', 1)).toEqual([null])
  })
})
