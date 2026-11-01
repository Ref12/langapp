import { useEffect, useState } from 'react'
import { isEdgeVoice, type SpeechVoicePreference } from '../../core/assistant/contracts'
import { watchBrowserVoices, type BrowserVoiceState } from '../../core/assistant/speech'
import { edgeTtsAvailable, loadEdgeVoices } from '../../core/assistant/edge-speech'
import type { EdgeVoice } from '../../core/local-tts-contracts'

export function voiceLabel(voice: SpeechVoicePreference) {
  return isEdgeVoice(voice) ? `${voice.voice} — Edge TTS (Online)`
    : `${voice.name} — ${voice.lang} — ${voice.localService ? 'Local' : 'Online'}`
}

/** The browser voices and, where the local server offers them, Edge voices: what the voice pickers list. */
export function useVoiceCatalog(refresh = 0) {
  const [state, setState] = useState<BrowserVoiceState>({ voices: [], loading: true })
  const edgeAvailable = edgeTtsAvailable()
  const [edge, setEdge] = useState<{ voices: EdgeVoice[]; loading: boolean; error?: string }>({ voices: [], loading: edgeAvailable })
  useEffect(() => watchBrowserVoices(setState), [refresh])
  useEffect(() => {
    if (!edgeAvailable) return
    const controller = new AbortController()
    setEdge({ voices: [], loading: true })
    void loadEdgeVoices(controller.signal).then(voices => {
      if (!controller.signal.aborted) setEdge({ voices, loading: false })
    }, error => {
      if (!controller.signal.aborted) setEdge({ voices: [], loading: false, error: error instanceof Error ? error.message : 'The Edge voice catalog could not be loaded.' })
    })
    return () => controller.abort()
  }, [edgeAvailable, refresh])
  return { state, edge, edgeAvailable }
}

