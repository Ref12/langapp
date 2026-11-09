import { useEffect, useState, type CSSProperties } from 'react'
import { RotateCcw } from 'lucide-react'
import { loadCharacterAsset } from '../core/characters/assets'
import { makeStrokeGuide, type StrokeGuide } from '../core/characters/geometry'
import type { ParallelLanguage } from '../core/parallel/data'
import '../pages/writing.css'

function Animated({ character, language, run, reportMissing }: { character: string; language: ParallelLanguage; run: number; reportMissing?: boolean }) {
  const [guides, setGuides] = useState<StrokeGuide[]>()
  const [at, setAt] = useState(0)
  useEffect(() => {
    let live = true
    loadCharacterAsset(character, language).then(asset => { if (live) setGuides(asset.paths.map(makeStrokeGuide)) }, () => { if (live) setGuides([]) })
    return () => { live = false }
  }, [character, language])
  useEffect(() => { setAt(0) }, [run, guides])
  useEffect(() => {
    if (!guides || at >= guides.length) return
    const timer = window.setTimeout(() => setAt(value => value + 1), 800)
    return () => window.clearTimeout(timer)
  }, [guides, at])
  if (!guides?.length) return guides && reportMissing ? <p className="small muted" data-missing={character}>No writing data for <span lang={language}>{character}</span> yet.</p> : null
  return <svg viewBox="0 0 100 100" className="writing-pad dr-order-svg" role="img" aria-label={`Stroke order of ${character}`} data-strokes={guides.length} data-shown={Math.min(at + 1, guides.length)}>
    <path d="M50 0 V100 M0 50 H100 M0 0 L100 100 M100 0 L0 100" className="writing-gridlines" />
    <g aria-hidden="true">{guides.map((guide, index) => index > at ? null : <path key={`${index}-${at === index}`} d={guide.path} data-stroke={index}
      className={`writing-guide${at === index ? ' replaying' : ' replayed'}`} strokeDasharray={at === index ? guide.length : undefined}
      style={at === index ? { '--stroke-length': guide.length } as CSSProperties : undefined} />)}</g>
  </svg>
}

/** A word's characters drawn stroke by stroke from the language's own writing data (characters without data show nothing). */
export function ParallelStrokes({ text, language, reportMissing = false }: { text: string; language: ParallelLanguage; reportMissing?: boolean }) {
  const [open, setOpen] = useState(false)
  const [run, setRun] = useState(0)
  const characters = [...new Set(Array.from(text).filter(character => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)))]
  if (!characters.length) return null
  return <div className="dr-order" aria-label="Stroke order">
    <button type="button" className="text-link small" aria-expanded={open} onClick={() => { setOpen(value => !value); setRun(value => value + 1) }}>{open ? 'Hide writing' : 'Show writing'}</button>
    {open && <><div className="dr-order-row">{characters.map(character => <Animated key={character} character={character} language={language} run={run} reportMissing={reportMissing} />)}</div>
      <button type="button" className="button secondary" onClick={() => setRun(value => value + 1)}><RotateCcw size={16} /> Replay stroke order</button></>}
  </div>
}
