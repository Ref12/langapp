export type Mode = 'words' | 'phrase' | 'forward' | 'backward'
export interface Word { text: string; pinyin: string; meaning: string }
export interface Phrase { words: Word[]; meaning: string }
export interface Step { start: number; end: number; text: string; pinyin: string }
export type Outcome = { status: 'completed' | 'cancelled' } | { status: 'error'; error: string }
export interface Audio { speak(text: string, rate: number): Promise<Outcome>; stop(): string | undefined }
export interface Settings { rate: number; pause: number; loop: boolean; ramp: boolean; maxRate: number; minPause: number }
export interface State extends Settings {
  mode: Mode
  index: number
  round: number
  phase: 'idle' | 'speaking' | 'responding' | 'paused' | 'completed' | 'error'
  remaining: number
  responseDuration: number
  error?: string
}
export const modes: Mode[] = ['words', 'phrase', 'forward', 'backward']
export const samples: Phrase[] = [
  { meaning: 'I want to go jogging in the park tomorrow morning.', words: [
    { text: '我', pinyin: 'wǒ', meaning: 'I' },
    { text: '想', pinyin: 'xiǎng', meaning: 'want to' },
    { text: '明天', pinyin: 'míng tiān', meaning: 'tomorrow' },
    { text: '早上', pinyin: 'zǎo shang', meaning: 'morning' },
    { text: '去', pinyin: 'qù', meaning: 'go' },
    { text: '公园', pinyin: 'gōng yuán', meaning: 'park' },
    { text: '跑步。', pinyin: 'pǎo bù', meaning: 'jog' },
  ] },
  { meaning: "I'm very tired.", words: [
    { text: '我', pinyin: 'wǒ', meaning: 'I' },
    { text: '很', pinyin: 'hěn', meaning: 'very' },
    { text: '累。', pinyin: 'lèi', meaning: 'tired' },
  ] },
]

export function stepsFor(phrase: Phrase, mode: Mode): Step[] {
  if (!modes.includes(mode)) throw new Error('Choose a supported practice mode.')
  if (!phrase.words.length || phrase.words.some(word => !word.text.trim() || !word.pinyin.trim())) {
    throw new Error('The sample phrase needs words and their readings.')
  }
  const count = mode === 'phrase' ? 1 : phrase.words.length
  return Array.from({ length: count }, (_, index) => {
    const start = mode === 'backward' ? phrase.words.length - index - 1 : mode === 'words' ? index : 0
    const end = mode === 'phrase' || mode === 'backward' ? phrase.words.length : index + 1
    const words = phrase.words.slice(start, end)
    return { start, end, text: words.map(word => word.text).join(''), pinyin: words.map(word => word.pinyin).join(' ') }
  })
}

export function rampNext(settings: Settings): Pick<Settings, 'rate' | 'pause'> {
  return {
    rate: Number(Math.max(settings.rate, Math.min(settings.maxRate, settings.rate + 0.05)).toFixed(2)),
    pause: Number(Math.min(settings.pause, Math.max(settings.minPause, settings.pause - 0.25)).toFixed(2)),
  }
}

export function createPlayer(initialPhrase: Phrase, audio: Audio, changed: (state: State) => void) {
  let phrase = initialPhrase
  let state: State = { mode: 'words', index: 0, round: 1, phase: 'idle', rate: 0.75, pause: 1.5,
    loop: true, ramp: false, maxRate: 1, minPause: 0.75, remaining: 0, responseDuration: 0 }
  const pauses: Record<Mode, number> = { words: 1.5, phrase: 4, forward: 2.5, backward: 2.5 }
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  stepsFor(phrase, state.mode)
  const publish = () => { if (!disposed) changed({ ...state }) }
  const invalidate = () => { generation++; clearTimeout(timer); timer = undefined }
  const pause = () => {
    invalidate()
    let error: string | undefined
    try { error = audio.stop() }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Speech could not be stopped.' }
    state = { ...state, phase: error ? 'error' : 'paused', remaining: 0, error }
    publish()
    return !error
  }
  const failed = (error: string) => {
    invalidate()
    state = { ...state, phase: 'error', remaining: 0, error }
    publish()
  }
  const advance = () => {
    const steps = stepsFor(phrase, state.mode)
    if (state.index < steps.length - 1) state.index++
    else if (state.loop) {
      state.index = 0
      state.round++
      if (state.ramp) {
        Object.assign(state, rampNext(state))
        pauses[state.mode] = state.pause
      }
    } else {
      state.phase = 'completed'
      publish()
      return
    }
    speak()
  }
  const respond = (request: number) => {
    if (disposed || request !== generation) return
    state = { ...state, phase: 'responding', responseDuration: state.pause, remaining: state.pause }
    const deadline = performance.now() + state.pause * 1000
    const tick = () => {
      if (disposed || request !== generation) return
      state.remaining = Math.max(0, (deadline - performance.now()) / 1000)
      if (!state.remaining) { advance(); return }
      publish()
      timer = setTimeout(tick, Math.min(50, state.remaining * 1000))
    }
    tick()
  }
  const speak = () => {
    invalidate()
    const request = generation
    state = { ...state, phase: 'speaking', remaining: 0, error: undefined }
    publish()
    try {
      void audio.speak(stepsFor(phrase, state.mode)[state.index].text, state.rate).then(outcome => {
        if (disposed || request !== generation) return
        if (outcome.status === 'completed') respond(request)
        else if (outcome.status === 'error') failed(outcome.error)
        else { state.phase = 'paused'; publish() }
      }, cause => {
        if (!disposed && request === generation) failed(cause instanceof Error ? cause.message : 'Speech could not be played.')
      })
    } catch (cause) { failed(cause instanceof Error ? cause.message : 'Speech could not be played.') }
  }
  return {
    getState: () => ({ ...state }),
    getPhrase: () => phrase,
    getSteps: () => stepsFor(phrase, state.mode),
    play() {
      if (disposed || state.phase === 'speaking' || state.phase === 'responding') return
      if (state.phase === 'error' && !pause()) return
      if (state.phase === 'completed') { state.index = 0; state.round = 1 }
      speak()
    },
    pause,
    select(index: number) {
      if (!Number.isInteger(index) || index < 0 || index >= stepsFor(phrase, state.mode).length) throw new Error('Choose an existing step.')
      if (!pause()) return
      state.index = index
      state.round = 1
      publish()
    },
    setMode(mode: Mode) {
      if (!modes.includes(mode)) throw new Error('Choose a supported practice mode.')
      if (!pause()) return false
      pauses[state.mode] = state.pause
      state = { ...state, mode, pause: pauses[mode], index: 0, round: 1 }
      publish()
      return true
    },
    setPhrase(next: Phrase) {
      stepsFor(next, state.mode)
      if (!pause()) return false
      phrase = next
      state = { ...state, index: 0, round: 1 }
      publish()
      return true
    },
    configure(next: Partial<Settings>) {
      const settings = { ...state, ...next }
      if (!Number.isFinite(settings.rate) || settings.rate < 0.25 || settings.rate > 1.25
        || !Number.isFinite(settings.pause) || settings.pause < 0.5 || settings.pause > 10
        || !Number.isFinite(settings.maxRate) || settings.maxRate < 0.25 || settings.maxRate > 1.25
        || !Number.isFinite(settings.minPause) || settings.minPause < 0.5 || settings.minPause > 10
        || typeof settings.loop !== 'boolean' || typeof settings.ramp !== 'boolean') {
        throw new Error('Use speech speeds from 0.25x to 1.25x and pauses from 0.5 to 10 seconds.')
      }
      state = settings
      pauses[state.mode] = state.pause
      publish()
    },
    dispose() {
      const stopped = pause()
      disposed = true
      return stopped
    },
  }
}
