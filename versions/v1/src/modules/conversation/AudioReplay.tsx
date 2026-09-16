import { useEffect, useRef, useState } from 'react'

export function AudioReplay({ audio, disabled = false }: { audio?: Blob; disabled?: boolean }) {
  const [url, setUrl] = useState('')
  const player = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (!audio) return
    const next = URL.createObjectURL(audio)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [audio])
  useEffect(() => { if (disabled) player.current?.pause() }, [disabled])
  if (!audio) return <p className="muted">Recording unavailable (audio was not included in this backup).</p>
  return <audio ref={player} aria-label="Replay your recording" controls src={url} preload="none"
    onPlay={() => { if (disabled) player.current?.pause() }} />
}
