import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as speech from '../assistant/speech'
import { createHandsfreePlayer, pauseLength, type HandsfreeState } from './player'
import type { Script } from './script'

const frame = { voiceURI: 'e', name: 'English', lang: 'en-GB', localService: true }
const script: Script = {
  promptStarts: [0],
  segments: [
    { kind: 'marker', phase: 'recall', index: 1, total: 1, prompt: 'rest' },
    { kind: 'say', locale: 'en-US', text: 'How do you say', rate: 1, volume: 0.8, voice: 'frame' },
    { kind: 'say', locale: 'en-US', text: 'rest', rate: 0.8, volume: 1, voice: 'frame' },
    { kind: 'say', locale: 'zh-Hans', text: '休息', rate: 0.85, voice: 'zh' },
    { kind: 'pause', ms: 1000, measure: { factor: 2, gap: 1500 } },
    { kind: 'say', locale: 'en-US', text: 'done', rate: 1, voice: 'frame' },
  ],
}
let calls: { text: string; options: unknown; rate?: number; at: number }[]
let speakMs: Record<string, number>

beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  speakMs = {}
  vi.spyOn(speech, 'playBrowserSpeechToEnd').mockImplementation((_id, text, _locale, rate, options) => {
    calls.push({ text, options, rate, at: Date.now() })
    return new Promise(resolve => setTimeout(() => resolve({ status: 'completed' }), speakMs[text] ?? 0))
  })
  vi.spyOn(speech, 'stopBrowserSpeech').mockImplementation(() => undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const start = (voices: Parameters<typeof createHandsfreePlayer>[4] = () => ({ frame })) => {
  const states: HandsfreeState[] = []
  const player = createHandsfreePlayer('hf:test', () => script, state => states.push(state), 0, voices)
  player.play()
  return { player, states }
}

describe('Hands-free player', () => {
  it('speaks each segment in the voice it asks for: the one English voice for the frame and the key word, the Chinese voice for Chinese, and the volume of each', async () => {
    const { player } = start(() => ({ frame, zh: { voiceURI: 'z', name: 'Zh', lang: 'zh-CN', localService: true } }))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls.map(call => [call.text, (call.options as { voice?: { name: string } }).voice?.name, call.rate])).toEqual([
      ['How do you say', 'English', 1], ['rest', 'English', 0.8], ['休息', 'Zh', 0.85], ['done', 'English', 1]])
    // the volume goes through: the frame is quieter than the key word, and a segment without one is left to the default
    expect(calls.map(call => (call.options as { volume?: number }).volume)).toEqual([0.8, 1, undefined, undefined])
    expect(calls.every(call => (call.options as { anyRate: boolean }).anyRate)).toBe(true)
    player.dispose()
  })

  it('waits whichever is longer after model text: the estimate, or the measured speaking time x 2 plus the gap', async () => {
    speakMs['休息'] = 4000
    const { player } = start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.map(call => call.text)).toEqual(['How do you say', 'rest', '休息'])
    // the pause began at 4 s: measured 4 s x 2 + 1.5 s = 9.5 s (until 13.5 s) beats the 1 s estimate
    await vi.advanceTimersByTimeAsync(8000)
    expect(calls.map(call => call.text)).not.toContain('done')
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls.map(call => call.text)).toContain('done')
    player.dispose()
  })

  it('keeps the estimate when it is longer than the measured time', () => {
    const pause = { kind: 'pause' as const, ms: 5000, measure: { factor: 2, gap: 1500 } }
    expect(pauseLength(pause, 1000)).toBe(5000)
    expect(pauseLength(pause, 4000)).toBe(9500)
    expect(pauseLength(pause, undefined)).toBe(5000)
    expect(pauseLength({ kind: 'pause', ms: 300 }, 4000)).toBe(300)
  })
})
