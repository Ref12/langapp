/**
 * Auto-listen loop for pocket mode: listen -> send -> wait for the spoken reply -> listen again.
 * Pure logic with injected side effects, so it can be tested with a fake recognizer and fake clock.
 */
export type ListenResult =
  | { kind: 'text'; text: string }
  | { kind: 'silence' }
  | { kind: 'error'; error: string; fatal?: boolean }
  | { kind: 'cancelled' }

export type AutoListenPhase = 'idle' | 'listening' | 'replying' | 'backoff' | 'paused'
export type PauseReason = 'command' | 'silence' | 'errors' | 'fatal' | 'hidden'

export interface AutoListenDeps {
  /** Starts one recognition attempt. Resolves when it ends. */
  listen(): Promise<ListenResult>
  /** Sends the text and resolves after the reply has been spoken to the end. */
  respond(text: string): Promise<void>
  /** Speaks the short pause cue for this reason (see pauseCue); must not throw. */
  say(reason: PauseReason): Promise<void>
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  onChange?(phase: AutoListenPhase, reason?: PauseReason, detail?: string): void
}

export interface AutoListenOptions {
  /** Pause after this much time without recognized speech. */
  silenceLimitMs: number
  /** Restart delays after recognition errors; one entry per consecutive failure. */
  backoffMs: number[]
}

export const DEFAULT_AUTO_LISTEN: AutoListenOptions = { silenceLimitMs: 30_000, backoffMs: [500, 1000, 2000, 4000, 8000] }

const COMMANDS = new Set([
  'stop', 'pause', 'stop listening', 'pause listening', 'quit', 'end', 'that is all', 'thats all', 'stop it',
  '停', '停止', '暂停', '停下', '停一下', '结束', '别说了', '不说了',
])

/** True when the whole utterance is a stop command, so ordinary sentences containing "stop" keep the loop going. */
export function isStopCommand(text: string) {
  const plain = text.toLowerCase().replace(/[\s.,!?;:'"，。！？；：、]+/g, ' ').trim()
  if (COMMANDS.has(plain) || COMMANDS.has(plain.replace(/ /g, ''))) return true
  return COMMANDS.has(plain.replace(/^(please|ok|okay) /, '').replace(/ (please|now)$/, ''))
}

export function pauseCue(reason: PauseReason, locale: 'en-US' | 'zh-Hans') {
  const zh = locale === 'zh-Hans'
  switch (reason) {
    case 'command': return zh ? '已暂停。' : 'Paused.'
    case 'silence': return zh ? '我没听到声音，先暂停了。' : 'I did not hear anything, so I paused.'
    case 'errors': return zh ? '听不到麦克风，已暂停。' : 'I could not keep listening, so I paused.'
    default: return ''
  }
}

export function createAutoListenLoop(deps: AutoListenDeps, options: AutoListenOptions = DEFAULT_AUTO_LISTEN) {
  let phase: AutoListenPhase = 'idle'
  let run = 0
  let failures = 0
  let lastHeard = 0
  let timer: unknown
  let hidden = false
  let wakeBackoff: (() => void) | undefined
  let pausedFor: PauseReason | undefined

  const set = (next: AutoListenPhase, reason?: PauseReason, detail?: string) => { phase = next; pausedFor = next === 'paused' ? reason : undefined; deps.onChange?.(next, reason, detail) }

  const pause = async (id: number, reason: PauseReason, detail?: string) => {
    if (id !== run) return
    set('paused', reason, detail)
    if (reason !== 'hidden' && reason !== 'fatal') await deps.say(reason).catch(() => {})
  }

  const cycle = async (id: number): Promise<void> => {
    while (id === run) {
      if (hidden) { set('paused', 'hidden'); return }
      set('listening')
      const result = await deps.listen().catch((cause): ListenResult => ({ kind: 'error', error: String(cause) }))
      if (id !== run) return
      if (result.kind === 'cancelled') {
        // Cancelled by hiding the page, a tap on another control, or a new audio owner.
        if (hidden) { set('paused', 'hidden'); return }
        return pause(id, 'command')
      }
      if (result.kind === 'text') {
        failures = 0
        lastHeard = deps.now()
        if (isStopCommand(result.text)) return pause(id, 'command')
        set('replying')
        try { await deps.respond(result.text) } catch (cause) {
          if (id !== run) return
          return pause(id, 'errors', cause instanceof Error ? cause.message : String(cause))
        }
        lastHeard = deps.now()
        continue
      }
      if (result.kind === 'silence') {
        failures = 0
        if (deps.now() - lastHeard >= options.silenceLimitMs) return pause(id, 'silence')
        continue
      }
      // error
      if (result.fatal) return pause(id, 'fatal', result.error)
      if (failures >= options.backoffMs.length) return pause(id, 'errors', result.error)
      const delay = options.backoffMs[failures++]
      set('backoff', undefined, result.error)
      await new Promise<void>(resolve => {
        wakeBackoff = resolve
        timer = deps.setTimer(resolve, delay)
      })
      wakeBackoff = undefined
    }
  }

  return {
    get phase() { return phase },
    /** Call from a user gesture (the first listen keeps the activation). */
    start() {
      if (phase !== 'idle' && phase !== 'paused') return
      const id = ++run
      failures = 0
      lastHeard = deps.now()
      void cycle(id)
    },
    stop() {
      run++
      deps.clearTimer(timer)
      wakeBackoff?.()
      set('idle')
    },
    /** Page visibility: recognition cannot run while hidden, so the loop waits and resumes when visible. */
    setHidden(value: boolean) {
      if (hidden === value) return
      hidden = value
      if (value && phase !== 'idle' && phase !== 'paused') { set('paused', 'hidden'); return }
      if (!value && phase === 'paused' && pausedFor === 'hidden') {
        const id = ++run
        void cycle(id)
      }
    },
  }
}
