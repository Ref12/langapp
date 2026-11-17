import { useEffect, useId, useSyncExternalStore } from 'react'
import { Square, Volume2 } from 'lucide-react'
import type { SpeechLocale } from '../core/assistant/contracts'
import { getPlaybackState, getPlaybackTarget, playBrowserSpeech, stopBrowserSpeech, subscribePlayback } from '../core/assistant/speech'

/**
 * What a button that starts speech shows: Stop while its own playback (or automatic speech of the same spoken text) is active, and the error of its own playback.
 * `spoken` is the exact text the button speaks; automatic speech has no button id, so it is matched to a button by that text.
 */
export function useSpeechButton(id: string, spoken?: string) {
  const playback = useSyncExternalStore(subscribePlayback, getPlaybackState, getPlaybackState)
  const target = useSyncExternalStore(subscribePlayback, getPlaybackTarget, getPlaybackTarget)
  const mine = (otherId?: string, otherText?: string) => otherId === id || (spoken !== undefined && otherText === spoken)
  const active = Boolean(playback.activeId) && mine(playback.activeId, target.text)
  const error = !playback.activeId && playback.error && mine(target.errorId, target.errorText) ? playback.error : undefined
  const stopLabel = playback.phase === 'loading-voices' ? 'Cancel voice discovery' : 'Stop playback'
  return { active, error, stopLabel }
}

/** The short alert shown beside the button that started playback. */
export function SpeechError({ error }: { error?: string }) {
  return error ? <span role="alert" className="speech-error small">{error}</span> : null
}

/** An icon-only speaker button for a text that is already in its spoken form; it turns into Stop while it plays and shows its own error. */
export function SpeakButton({ spoken, locale, label, className = 'icon-button', size = 16 }: { spoken: string; locale: SpeechLocale; label: string; className?: string; size?: number }) {
  const id = useId()
  const { active, error, stopLabel } = useSpeechButton(id, spoken)
  useEffect(() => () => { if (getPlaybackState().activeId === id) stopBrowserSpeech() }, [id])
  return <><button type="button" className={className} aria-label={active ? stopLabel : label} title={active ? stopLabel : label}
    onClick={() => { if (active) stopBrowserSpeech(); else playBrowserSpeech(id, spoken, locale) }}>{active ? <Square size={size} /> : <Volume2 size={size} />}</button><SpeechError error={error} /></>
}
