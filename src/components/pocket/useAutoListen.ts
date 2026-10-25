import { useCallback, useEffect, useRef, useState } from 'react'
import { createAutoListenLoop, pauseCue, type AutoListenPhase, type PauseReason } from '../../core/pocket/auto-listen'
import { playBrowserSpeechToEnd } from '../../core/assistant/speech'
import type { SpeechLocale, SpeechRate } from '../../core/assistant/contracts'

const STORAGE_KEY = 'linguaweave.autoListen'

interface VoiceLike {
  listenOnce(): Promise<{ kind: 'finished'; text: string } | { kind: 'cancelled' } | { kind: 'error'; error: string; silence?: boolean }>
  replyFinished(): Promise<void>
}

function readOption() {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

/**
 * Wires the auto-listen loop to the conversation voice. start() must be called from a click so the
 * first microphone request has a user gesture; later restarts rely on the permission already granted.
 */
export function useAutoListen({ voice, send, locale, rate }: {
  voice: VoiceLike
  send: (text: string) => Promise<void>
  locale: SpeechLocale
  rate: SpeechRate
}) {
  const [option, setOptionState] = useState(readOption)
  const [phase, setPhase] = useState<AutoListenPhase>('idle')
  const [pausedFor, setPausedFor] = useState<PauseReason>()
  const latest = useRef({ voice, send, locale, rate })
  latest.current = { voice, send, locale, rate }
  const loop = useRef<ReturnType<typeof createAutoListenLoop>>()
  if (!loop.current) {
    loop.current = createAutoListenLoop({
      listen: async () => {
        const result = await latest.current.voice.listenOnce()
        if (result.kind === 'finished') return { kind: 'text', text: result.text }
        if (result.kind === 'cancelled') return { kind: 'cancelled' }
        if ('silence' in result && result.silence) return { kind: 'silence' }
        const fatal = /permission was denied|not supported|does not support/.test(result.error)
        return { kind: 'error', error: result.error, fatal }
      },
      respond: async text => { await latest.current.send(text); await latest.current.voice.replyFinished() },
      say: async reason => {
        const text = pauseCue(reason, latest.current.locale)
        if (text) await playBrowserSpeechToEnd('pocket-cue', text, latest.current.locale, latest.current.rate).catch(() => {})
      },
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
      onChange: (next, reason) => { setPhase(next); setPausedFor(reason) },
    })
  }
  const l = loop.current

  useEffect(() => {
    const visibility = () => l.setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', visibility)
    return () => { document.removeEventListener('visibilitychange', visibility); l.stop() }
  }, [l])

  const setOption = useCallback((value: boolean) => {
    setOptionState(value)
    try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0') } catch { /* private mode */ }
    if (value) l.start(); else l.stop()
  }, [l])

  return { option, setOption, phase, pausedFor, start: () => l.start(), stop: () => l.stop() }
}
