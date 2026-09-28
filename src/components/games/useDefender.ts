import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { db } from '../../core/database'
import { answerDefender, createDefenderGame, endDefender, pauseDefender, readDefenderGame, resumeDefender, startNextDefenderWave, tickDefender, type DefenderGame, type Settings, type Word } from '../../core/games/defender'
import { saveDefenderGame, type DefenderRevision } from '../../core/games/defender-store'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech } from '../../core/assistant/speech'

export function useDefender() {
  const speechId = useId()
  const stopMatchSpeech = useCallback(() => {
    if (getPlaybackState().activeId === speechId) stopBrowserSpeech()
  }, [speechId])
  const [game, setGame] = useState<DefenderGame>()
  const current = useRef<DefenderGame>()
  const persisted = useRef<DefenderRevision>()
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('Match only the highlighted leading word.')
  const writes = useRef(Promise.resolve())
  const lastWrite = useRef<Promise<boolean>>()
  const blocked = useRef(false)
  const transitioning = useRef(false)
  const invalidSnapshot = useRef<unknown>()
  const mounted = useRef(true)
  const publish = useCallback((value: DefenderGame) => { current.current = value; if (mounted.current) setGame(value) }, [])
  const checkpoint = useCallback((snapshot: DefenderGame, retry = false): Promise<boolean> => {
    if (retry) { blocked.current = false; setError('') }
    if (mounted.current) setSaving(true)
    const job = writes.current.then(async () => {
      if (blocked.current) return false
      const saved = await saveDefenderGame(snapshot, persisted.current)
      persisted.current = { gameId: saved.gameId, revision: saved.revision }
      return true
    }).catch(reason => {
      blocked.current = true
      stopMatchSpeech()
      if (current.current) publish(pauseDefender(current.current))
      const detail = `Defender could not be saved. ${reason instanceof Error ? reason.message : String(reason)}`
      if (mounted.current) setError(detail)
      else console.error(detail)
      return false
    })
    lastWrite.current = job
    writes.current = job.then(() => {
      if (mounted.current && lastWrite.current === job) setSaving(false)
    })
    return job
  }, [publish, stopMatchSpeech])

  useEffect(() => {
    mounted.current = true
    let disposed = false
    void db.defenderGames.get('current').then(value => {
      if (disposed) return
      if (value) {
        try {
          const saved = readDefenderGame(value)
          persisted.current = { gameId: saved.gameId, revision: saved.revision }
          publish(pauseDefender(saved))
        } catch (reason) {
          invalidSnapshot.current = value
          setInvalid(true); setError(`The saved Defender run is invalid. ${reason instanceof Error ? reason.message : String(reason)}`)
        }
      }
      setLoaded(true)
    }, reason => {
      if (!disposed) { setError(`Defender could not be opened. ${reason instanceof Error ? reason.message : String(reason)}`); setLoaded(true); setInvalid(true) }
    })
    return () => {
      disposed = true; mounted.current = false
      stopMatchSpeech()
      if (current.current?.run.phase === 'playing' && !blocked.current) void checkpoint(pauseDefender(current.current))
    }
  }, [publish, checkpoint, stopMatchSpeech])

  const pause = useCallback((reason = 'Paused. Resume when you are ready.') => {
    stopMatchSpeech()
    if (current.current?.run.phase !== 'playing') return
    const next = pauseDefender(current.current)
    publish(next); setMessage(reason); void checkpoint(next)
  }, [publish, checkpoint, stopMatchSpeech])
  useEffect(() => {
    const hidden = () => { if (document.hidden) pause('Paused while you were away.') }
    const navigation = () => { if (document.querySelector('dialog[open]')) pause('Paused while navigation is open.') }
    document.addEventListener('visibilitychange', hidden)
    document.addEventListener('focusin', navigation)
    window.addEventListener('pagehide', stopMatchSpeech)
    const timer = window.setInterval(() => {
      if (current.current?.run.phase === 'playing' && !blocked.current) void checkpoint(current.current)
    }, 5000)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      document.removeEventListener('focusin', navigation)
      window.removeEventListener('pagehide', stopMatchSpeech)
      window.clearInterval(timer)
    }
  }, [pause, checkpoint, stopMatchSpeech])
  useEffect(() => {
    if (game?.run.phase !== 'playing') return
    let animation = 0, previous = performance.now()
    const frame = (time: number) => {
      const latest = current.current
      if (!latest || latest.run.phase !== 'playing') return
      const delta = (time - previous) / 1000; previous = time
      if (delta > 1) { pause('Paused after an interruption. Your shields are safe.'); return }
      const result = tickDefender(latest, Math.max(0, delta))
      publish(result.game)
      if (result.game.run.phase === 'over') stopMatchSpeech()
      if (result.events.some(event => event.type === 'breach')) setMessage('A word crossed the shield. It will return in the next wave.')
      if (result.events.some(event => event.type === 'breach') || result.game.stage === 'between' || result.game.run.phase === 'over') void checkpoint(result.game)
      if (result.game.stage === 'between') setMessage('Wave cleared. Missed words return before new words.')
      if (result.game.run.phase === 'playing') animation = requestAnimationFrame(frame)
    }
    animation = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(animation)
  }, [game?.run.phase, checkpoint, pause, publish, stopMatchSpeech])

  const start = async (words: Word[], settings: Settings) => {
    if (transitioning.current) return false
    stopMatchSpeech()
    transitioning.current = true
    try {
      if (blocked.current || invalid || !loaded) throw new Error('Resolve the saved-game error before starting another run.')
      const next = createDefenderGame(words, settings, crypto.getRandomValues(new Uint32Array(1))[0])
      const saved = await checkpoint(pauseDefender(next))
      if (saved && mounted.current) { publish(next); setMessage('Match only the highlighted target.'); return true }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { transitioning.current = false }
    return false
  }
  const resume = () => {
    if (!current.current || blocked.current || saving || document.hidden) return
    publish(resumeDefender(current.current)); setMessage('Match only the highlighted target.')
  }
  const nextWave = async () => {
    if (!current.current || blocked.current || saving || transitioning.current) return
    stopMatchSpeech()
    transitioning.current = true
    try {
      const next = startNextDefenderWave(current.current)
      if (await checkpoint(pauseDefender(next)) && mounted.current) { publish(next); setMessage('New wave. Match the highlighted target.') }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { transitioning.current = false }
  }
  const submit = (text: string) => {
    if (!current.current || blocked.current) return
    const result = answerDefender(current.current, text)
    if (result.outcome === 'ignored') return result.outcome
    publish(result.game)
    setMessage(result.outcome === 'hit' ? result.game.stage === 'between' ? 'Wave cleared!' : 'Matched!' : 'Not the leading word. This target will return next wave.')
    void checkpoint(result.game)
    if (result.outcome === 'hit') {
      const matched = result.game.run.words.find(word => word.id === result.tile?.wordId)!
      playBrowserSpeech(speechId, matched.character, 'zh-Hans')
    }
    return result.outcome
  }
  const end = () => {
    stopMatchSpeech()
    if (!current.current) return
    const next = endDefender(current.current)
    publish(next); void checkpoint(next)
  }
  const retry = () => { if (current.current) void checkpoint(pauseDefender(current.current), true) }
  const discardInvalid = async () => {
    setSaving(true)
    try {
      await db.transaction('rw', db.defenderGames, async () => {
        const value = await db.defenderGames.get('current')
        if (JSON.stringify(value) !== JSON.stringify(invalidSnapshot.current)) throw new Error('Defender changed in another tab. Reload before discarding it.')
        await db.defenderGames.delete('current')
      })
      invalidSnapshot.current = undefined; persisted.current = undefined; blocked.current = false
      setInvalid(false); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  return { game, loaded, invalid, error, saving, message, start, pause, resume, nextWave, submit, end, retry, discardInvalid }
}
