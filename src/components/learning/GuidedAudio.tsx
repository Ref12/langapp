import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createGuidedAudio, type GuidedAudioState } from '../../core/guided-audio'
import { buildLessonAudioScript, type LessonDefinition } from '../../core/learning-content'
import { contentWords, contentModels, contentGrammar } from '../../data/learning-content'

export function GuidedAudio({ lesson }: { lesson: LessonDefinition }) {
  const id = useId()
  const script = useMemo(() => buildLessonAudioScript(lesson, contentModels, contentWords, contentGrammar), [lesson])
  const controller = useRef<ReturnType<typeof createGuidedAudio>>()
  const [state, setState] = useState<GuidedAudioState>({ status: 'idle', index: 0 })
  useEffect(() => {
    const player = createGuidedAudio(id, script, setState)
    controller.current = player
    const hidden = () => { if (document.hidden) player.pause() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') player.stop() }
    document.addEventListener('visibilitychange', hidden)
    document.addEventListener('keydown', escape)
    return () => {
      player.dispose()
      document.removeEventListener('visibilitychange', hidden)
      document.removeEventListener('keydown', escape)
    }
  }, [id, script])
  const running = state.status === 'playing' || state.status === 'responding'
  const step = script[state.index]
  return <section className="panel guided-audio" aria-label="Guided audio player">
    <h2>Listen to the lesson</h2>
    <p>The lesson description, goals, vocabulary, grammar explanations, concepts, conversations, and exercises follow the same order as the visual lesson. Exercises leave time to respond before a model answer. No reading is required during playback.</p>
    <p className="small muted">Uses your English and Mandarin voices from <a href="#settings">Settings</a>. Online browser voices may send spoken text to their provider. Nothing is recorded here. Resume replays the current segment; Repeat restarts the current section or content item.</p>
    <div className="button-row">
      {!running && <button type="button" className="button primary" onClick={() => state.status === 'idle' || state.status === 'completed' ? controller.current?.start() : controller.current?.resume()}>
        {state.status === 'idle' ? 'Start guided audio' : state.status === 'completed' ? 'Replay guided audio' : 'Resume guided audio'}
      </button>}
      {running && <button type="button" className="button secondary" onClick={() => controller.current?.pause()}>Pause guided audio</button>}
      <button type="button" className="button secondary" disabled={state.status === 'idle'} onClick={() => controller.current?.stop()}>Stop guided audio</button>
      <button type="button" className="button secondary" disabled={state.status === 'idle'} onClick={() => controller.current?.repeat()}>Repeat section</button>
      <button type="button" className="button secondary" disabled={!running} onClick={() => controller.current?.next()}>Next segment</button>
    </div>
    <p role="status">{state.status === 'responding' ? `Your turn: ${step?.kind === 'response' ? step.seconds : ''} seconds to answer aloud.`
      : state.status === 'completed' ? 'Lesson finished. No speech assessment was performed.'
        : state.status === 'paused' ? 'Paused. Resume when you are ready.'
          : state.status === 'playing' ? `Playing: ${step?.title}` : state.status === 'error' ? 'Playback stopped.' : 'Ready when you are.'}</p>
    {state.error && <p role="alert">{state.error}</p>}
    {step && running && <details><summary>Current narration (optional)</summary><p>{step.kind === 'speech' ? step.text : 'Answer aloud before the model answer.'}</p></details>}
  </section>
}
