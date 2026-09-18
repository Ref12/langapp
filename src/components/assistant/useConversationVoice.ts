import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_DRAFT_LENGTH, type AssistantMessage, type AssistantThread } from '../../core/assistant/contracts'
import { acquireAudio, interruptAudio, type AudioLease } from '../../core/assistant/audio-owner'
import {
  conversationCaptureSupported, speakConversationReply, startConversationCapture, type ConversationCaptureState,
} from '../../core/assistant/conversation-voice'
import { stopBrowserSpeech } from '../../core/assistant/speech'
import type { SpeechCaptureSession } from '../../core/assistant/speech-capture'

type CaptureResult = { kind: 'finished'; text: string } | { kind: 'cancelled' } | { kind: 'error'; error: string }
interface Attempt {
  version: number
  base: string
  session?: SpeechCaptureSession
  done: Promise<CaptureResult>
  resolve: (result: CaptureResult) => void
}

export function useConversationVoice({ thread, disabled, getDraft, changeDraft, save, send }: {
  thread: AssistantThread
  disabled: boolean
  getDraft: () => string
  changeDraft: (value: string) => void
  save: (value: string) => Promise<void>
  send: (value: string) => Promise<void>
}) {
  const [capture, setCapture] = useState<ConversationCaptureState>()
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState('')
  const state = useRef({ mounted: false, version: 0, submitting: false })
  const attempt = useRef<Attempt>()
  const playback = useRef<ReturnType<typeof speakConversationReply>>()
  const thinking = useRef<AudioLease>()
  const callbacks = useRef({ getDraft, changeDraft, save, send })
  callbacks.current = { getDraft, changeDraft, save, send }

  const cancel = useCallback(() => {
    state.current.version++
    state.current.submitting = false
    const current = attempt.current
    attempt.current = undefined
    current?.session?.cancel()
    current?.resolve({ kind: 'cancelled' })
    playback.current?.cancel()
    playback.current = undefined
    thinking.current?.release()
    thinking.current = undefined
    if (state.current.mounted) {
      if (current) callbacks.current.changeDraft(current.base)
      setCapture(undefined)
      setSpeaking(false)
    }
  }, [])

  useEffect(() => {
    const lifetime = state.current
    lifetime.mounted = true
    const hidden = () => { if (document.hidden) cancel() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel() }
    document.addEventListener('visibilitychange', hidden)
    document.addEventListener('keydown', escape)
    window.addEventListener('pagehide', cancel)
    return () => {
      lifetime.mounted = false
      cancel()
      document.removeEventListener('visibilitychange', hidden)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('pagehide', cancel)
    }
  }, [cancel])
  useEffect(() => {
    cancel()
    setError('')
  }, [thread.id, thread.voiceEnabled, thread.voiceInputLocale, thread.mode, thread.speechRate, cancel])
  useEffect(() => {
    if (disabled && attempt.current) cancel()
  }, [disabled, cancel])

  const begin = () => {
    if (!thread.voiceEnabled || disabled) return
    cancel()
    setError('')
    const version = state.current.version
    let resolve!: Attempt['resolve']
    const done = new Promise<CaptureResult>(finish => { resolve = finish })
    const current: Attempt = { version, base: callbacks.current.getDraft(), done, resolve }
    attempt.current = current
    const receive = (next: ConversationCaptureState) => {
      if (!state.current.mounted || state.current.version !== version || attempt.current !== current) {
        if (next.cancelled && next.error) {
          if (state.current.mounted) setError(next.error)
          else console.error(next.error)
        }
        return
      }
      const text = current.base && next.transcript ? `${current.base}\n${next.transcript}` : current.base || next.transcript
      if (text.length > MAX_DRAFT_LENGTH) {
        cancel()
        setError('There is not enough room in this draft. Shorten it before recording again.')
        return
      }
      setCapture(next)
      if (next.cancelled) {
        attempt.current = undefined
        callbacks.current.changeDraft(current.base)
        setCapture(undefined)
        if (next.error) setError(next.error)
        resolve({ kind: 'cancelled' })
        return
      }
      callbacks.current.changeDraft(text)
      if (next.phase !== 'finished' && next.phase !== 'error') return
      attempt.current = undefined
      setCapture({ ...next, phase: 'stopping' })
      if (next.error) setError(next.error)
      void callbacks.current.save(text).then(() => {
        if (!state.current.mounted || state.current.version !== version) { resolve({ kind: 'cancelled' }); return }
        setCapture(undefined)
        resolve(next.phase === 'error' ? { kind: 'error', error: next.error || 'Voice input could not finish.' } : { kind: 'finished', text })
      }, () => {
        if (state.current.mounted && state.current.version === version) {
          setCapture(undefined)
          setError('The voice draft could not be saved. Retry saving the draft before sending.')
        }
        resolve({ kind: 'error', error: 'The voice draft could not be saved.' })
      })
    }
    try {
      const handle = startConversationCapture(thread.voiceInputLocale ?? 'en-US', receive)
      if (attempt.current === current) current.session = handle
      else handle.cancel()
    } catch {
      receive({ phase: 'error', transcript: '', error: 'Voice input could not start. Check microphone and browser audio permissions.' })
    }
  }

  const submit = async () => {
    if (disabled || state.current.submitting) return
    const current = attempt.current
    if (current && capture?.phase !== 'listening') return
    const version = state.current.version
    state.current.submitting = true
    try {
      if (current) {
        current.session?.stop()
        const result = await current.done
        if (!state.current.mounted || state.current.version !== current.version || result.kind !== 'finished') return
        if (!result.text.trim()) { setError('No speech was recognized. Record again or type a message.'); return }
        await callbacks.current.send(result.text)
      } else if (!capture) {
        await callbacks.current.send(callbacks.current.getDraft())
      }
    } finally {
      if (state.current.version === version) state.current.submitting = false
    }
  }

  const prepareReply = () => {
    cancel()
    interruptAudio()
    const stopError = stopBrowserSpeech()
    if (stopError) throw new Error(stopError)
    setError('')
    // Reserve the upcoming reply as well as its playback, so other audio can
    // interrupt it while the provider is still thinking.
    const version = state.current.version
    const enabled = thread.voiceEnabled
    const lease = enabled ? acquireAudio(cancel) : undefined
    thinking.current = lease
    const finish = () => {
      lease?.release()
      if (thinking.current === lease) thinking.current = undefined
    }
    const play = (message: AssistantMessage) => {
      if (!enabled || !state.current.mounted || state.current.version !== version || document.hidden) return
      finish()
      const current = speakConversationReply(message.blocks, thread.speechRate)
      playback.current = current
      setSpeaking(true)
      void current.done.then(result => {
        if (!state.current.mounted || state.current.version !== version || playback.current !== current) return
        playback.current = undefined
        setSpeaking(false)
        if (result.status === 'error') setError(result.error)
      })
    }
    return { play, finish }
  }

  return {
    capture, speaking, error, supported: conversationCaptureSupported(),
    begin, stop: () => attempt.current?.session?.stop(), cancel, submit, prepareReply,
  }
}
