import { vi } from 'vitest'

export class MockAudio {
  static instances: MockAudio[] = []
  static onCreate?: (audio: MockAudio) => void
  src = ''
  playbackRate = 1
  duration = 2
  onplaying: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  play = vi.fn<() => Promise<void>>().mockResolvedValue()
  pause = vi.fn<() => void>()
  load = vi.fn<() => void>()
  removeAttribute = vi.fn<(name: string) => void>()

  constructor() {
    MockAudio.instances.push(this)
    MockAudio.onCreate?.(this)
  }
}

export function mockAudio() {
  MockAudio.instances = []
  MockAudio.onCreate = undefined
  let sequence = 0
  const createObjectURL = vi.fn<(blob: Blob) => string>(() => `blob:synthetic-audio-${++sequence}`)
  const revokeObjectURL = vi.fn<(url: string) => void>()
  const NativeURL = URL
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  })
  vi.stubGlobal('Audio', MockAudio)
  return { createObjectURL, revokeObjectURL, instances: MockAudio.instances }
}
