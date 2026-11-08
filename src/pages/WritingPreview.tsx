import { useEffect, useRef, useState } from 'react'
import { loadCharacterAsset, type CharacterAsset } from '../core/characters/assets'
import { isWritingLanguage, languageName, type WritingLanguage } from '../core/characters/language'

/** Dev-only preview (#devwriting?lang=ja&c=右): animates and draws one character from one language's own data. Not linked from the app. */
export function WritingPreview({ query }: { query: string }) {
  const params = new URLSearchParams(query)
  const lang: WritingLanguage = isWritingLanguage(params.get('lang')) ? params.get('lang') as WritingLanguage : 'zh'
  const character = Array.from(params.get('c') ?? '右')[0] ?? '右'
  const [asset, setAsset] = useState<CharacterAsset | null>(null)
  const [error, setError] = useState('')
  const [run, setRun] = useState(0)
  const [drawing, setDrawing] = useState<string[]>([])
  const down = useRef<string[] | null>(null)
  useEffect(() => {
    let live = true
    setAsset(null); setError('')
    loadCharacterAsset(character, lang).then(value => { if (live) setAsset(value) }, (e: Error) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [character, lang])
  const point = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return `${((event.clientX - box.left) / box.width * 100).toFixed(1)} ${((event.clientY - box.top) / box.height * 100).toFixed(1)}`
  }
  return (
    <main data-testid="writing-preview" style={{ maxWidth: 360, margin: '0 auto', padding: 12 }}>
      <h1 style={{ fontSize: '1.1rem' }}>{languageName[lang]} writing preview: {character}</h1>
      {error && <p role="alert">{error}</p>}
      {!asset && !error && <p>Loading…</p>}
      {asset && <>
        <p>{asset.strokeCount} strokes{asset.review ? ' · AI-reviewed, not human-reviewed' : ' · unreviewed'}</p>
        <svg key={run} viewBox="0 0 100 100" width="100%" style={{ border: '1px solid #888', touchAction: 'none', background: '#fff' }} aria-label={`${character} strokes`}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); down.current = [point(event)] }}
          onPointerMove={event => { if (down.current) down.current.push(point(event)) }}
          onPointerUp={() => { if (down.current && down.current.length > 1) setDrawing(old => [...old, `M${down.current!.join(' L')}`]); down.current = null }}>
          <style>{'@keyframes lw-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}'}</style>
          <path d="M50 0V100M0 50H100" stroke="#ddd" strokeWidth=".5" strokeDasharray="2 2" />
          {asset.paths.map((path, index) => (
            <path key={index} d={path} pathLength={1} fill="none" stroke="#111" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray="1 1" style={{ animation: `lw-draw 0.8s ease forwards ${index * 0.9}s`, strokeDashoffset: 1 }} />
          ))}
          {drawing.map((path, index) => <path key={`d${index}`} d={path} fill="none" stroke="#c33" strokeWidth={2} strokeLinecap="round" />)}
        </svg>
        <p><button onClick={() => setRun(value => value + 1)}>Replay</button> <button onClick={() => setDrawing([])}>Clear drawing</button></p>
      </>}
    </main>
  )
}
