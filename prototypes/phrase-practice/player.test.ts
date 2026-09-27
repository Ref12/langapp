import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlayer, rampNext, samples, stepsFor, type Outcome } from './player'

const players: ReturnType<typeof createPlayer>[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  players.splice(0).forEach(player => player.dispose())
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})
function harness() {
  const finish: ((outcome: Outcome) => void)[] = []
  const audio = {
    speak: vi.fn<(text: string, rate: number) => Promise<Outcome>>(() => new Promise<Outcome>(resolve => finish.push(resolve))),
    stop: vi.fn<() => string | undefined>(() => undefined),
  }
  const player = createPlayer(samples[1], audio, vi.fn())
  players.push(player)
  const end = async (index = finish.length - 1) => { finish[index]({ status: 'completed' }); await Promise.resolve() }
  return { player, audio, finish, end }
}

describe('prototype practice player', () => {
  it('defines words, whole phrase, and ordered forward/backward chains without dropping punctuation', () => {
    expect(stepsFor(samples[1], 'words').map(step => step.text)).toEqual(['我', '很', '累。'])
    expect(stepsFor(samples[1], 'phrase').map(step => step.text)).toEqual(['我很累。'])
    expect(stepsFor(samples[1], 'forward').map(step => step.text)).toEqual(['我', '我很', '我很累。'])
    expect(stepsFor(samples[1], 'backward').map(step => step.text)).toEqual(['累。', '很累。', '我很累。'])
    expect(stepsFor(samples[0], 'words').find(step => step.text === '公园')?.pinyin).toBe('gōng yuán')
  })

  it('opens silently with looping enabled and acceleration disabled', () => {
    const { player, audio } = harness()
    expect(player.getState()).toMatchObject({ phase: 'idle', loop: true, ramp: false, mode: 'words' })
    expect(audio.speak).not.toHaveBeenCalled()
  })

  it('waits for real speech completion and the full response gap before the next word', async () => {
    const { player, audio, end } = harness()
    player.play()
    expect(audio.speak).toHaveBeenLastCalledWith('我', 0.75)
    await vi.advanceTimersByTimeAsync(8000)
    expect(audio.speak).toHaveBeenCalledTimes(1)
    await end()
    expect(player.getState()).toMatchObject({ phase: 'responding', remaining: 1.5 })
    await vi.advanceTimersByTimeAsync(1499)
    expect(audio.speak).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(audio.speak).toHaveBeenLastCalledWith('很', 0.75)
  })

  it('loops after the final response gap and ramps only at a complete round boundary', async () => {
    const { player, audio, end } = harness()
    player.configure({ ramp: true })
    player.play()
    for (let index = 0; index < 3; index++) {
      expect(player.getState()).toMatchObject({ index, round: 1, rate: 0.75, pause: 1.5 })
      await end()
      await vi.advanceTimersByTimeAsync(1500)
    }
    expect(player.getState()).toMatchObject({ index: 0, round: 2, rate: 0.8, pause: 1.25 })
    expect(audio.speak.mock.calls).toEqual([['我', 0.75], ['很', 0.75], ['累。', 0.75], ['我', 0.8]])
  })

  it('keeps looping at its ramp limits and never reverses manual settings', async () => {
    const { player, end } = harness()
    player.setMode('phrase')
    player.configure({ ramp: true, rate: 0.95, pause: 1, maxRate: 1, minPause: 0.75 })
    player.play()
    await end(); await vi.advanceTimersByTimeAsync(1000)
    expect(player.getState()).toMatchObject({ round: 2, rate: 1, pause: 0.75 })
    await end(); await vi.advanceTimersByTimeAsync(750)
    expect(player.getState()).toMatchObject({ round: 3, rate: 1, pause: 0.75 })
    expect(rampNext({ rate: 1.2, pause: 0.5, maxRate: 1, minPause: 1, ramp: true, loop: true })).toEqual({ rate: 1.2, pause: 0.5 })
  })

  it('completes rather than looping or accelerating when Loop is off', async () => {
    const { player, audio, end } = harness()
    player.setMode('phrase')
    player.configure({ loop: false, ramp: true })
    player.play()
    await end(); await vi.advanceTimersByTimeAsync(4000)
    expect(player.getState()).toMatchObject({ phase: 'completed', round: 1, rate: 0.75, pause: 4 })
    expect(audio.speak).toHaveBeenCalledTimes(1)
  })

  it('changes rate at the next utterance and leaves an in-progress response window intact', async () => {
    const { player, audio, end } = harness()
    player.play()
    player.configure({ rate: 0.8 })
    expect(audio.stop).not.toHaveBeenCalled()
    expect(audio.speak).toHaveBeenCalledTimes(1)
    await end()
    await vi.advanceTimersByTimeAsync(500)
    player.configure({ pause: 0.5 })
    await vi.advanceTimersByTimeAsync(999)
    expect(audio.speak).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(audio.speak).toHaveBeenLastCalledWith('很', 0.8)
    await end()
    expect(player.getState().responseDuration).toBe(0.5)
  })

  it('remembers each mode pause independently and pauses on switching modes', () => {
    const { player, audio } = harness()
    player.configure({ pause: 1.25 })
    player.play()
    player.setMode('phrase')
    expect(player.getState()).toMatchObject({ phase: 'paused', index: 0, pause: 4 })
    player.configure({ pause: 6 })
    player.setMode('forward')
    expect(player.getState().pause).toBe(2.5)
    player.setMode('words')
    expect(player.getState().pause).toBe(1.25)
    player.setMode('phrase')
    expect(player.getState().pause).toBe(6)
    expect(audio.speak).toHaveBeenCalledTimes(1)
  })

  it('ignores a late speech completion after selection or sample replacement', async () => {
    const { player, audio, end } = harness()
    player.play()
    player.select(2)
    await end()
    await vi.advanceTimersByTimeAsync(10000)
    expect(player.getState()).toMatchObject({ phase: 'paused', index: 2 })
    player.play()
    player.setPhrase(samples[0])
    await end()
    expect(player.getSteps()).toHaveLength(7)
    expect(player.getState()).toMatchObject({ index: 0, round: 1, phase: 'paused' })
    expect(audio.speak).toHaveBeenCalledTimes(2)
  })

  it('cancels response timers on pause and repeats the current word only after explicit resume', async () => {
    const { player, audio, end } = harness()
    player.play()
    await end()
    player.pause()
    await vi.advanceTimersByTimeAsync(10000)
    expect(audio.speak).toHaveBeenCalledTimes(1)
    player.play()
    expect(audio.speak).toHaveBeenLastCalledWith('我', 0.75)
  })

  it('reports cancellation failure and refuses a mode change until audio stops', () => {
    const { player, audio } = harness()
    player.play()
    audio.stop.mockReturnValueOnce('Device busy')
    expect(player.setMode('phrase')).toBe(false)
    expect(player.getState()).toMatchObject({ phase: 'error', mode: 'words', error: 'Device busy' })
    expect(player.pause()).toBe(true)
    expect(player.getState().phase).toBe('paused')
  })

  it('reports playback errors and does not advance on failures', async () => {
    const { player, finish, audio } = harness()
    player.play()
    finish[0]({ status: 'error', error: 'No Mandarin voice' })
    await Promise.resolve()
    expect(player.getState()).toMatchObject({ phase: 'error', error: 'No Mandarin voice' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(audio.speak).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid pace settings without changing the last valid settings', () => {
    const { player } = harness()
    for (const settings of [{ rate: NaN }, { rate: 0 }, { rate: 2 }, { pause: 0 }, { pause: 11 }, { minPause: Infinity }, { maxRate: -1 }]) {
      expect(() => player.configure(settings)).toThrow()
    }
    expect(player.getState()).toMatchObject({ rate: 0.75, pause: 1.5 })
    expect(() => player.select(-1)).toThrow()
  })
})
