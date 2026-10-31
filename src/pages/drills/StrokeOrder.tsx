import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { RotateCcw } from 'lucide-react'
import { loadCharacterAsset } from '../../core/characters/assets'
import { makeStrokeGuide, type StrokeGuide } from '../../core/characters/geometry'
import { hasGuide, isHan } from '../../core/characters/writing-route'
import '../writing.css'

/** One character drawn stroke by stroke with the writing practice's replay styling; it ends with every stroke shown. */
function AnimatedCharacter({ character, run }: { character: string; run: number }) {
  const [guides, setGuides] = useState<StrokeGuide[]>()
  const [at, setAt] = useState(0)
  useEffect(() => {
    let live = true
    loadCharacterAsset(character).then(asset => { if (live) setGuides(asset.paths.map(makeStrokeGuide)) }, () => { if (live) setGuides([]) })
    return () => { live = false }
  }, [character])
  useEffect(() => { setAt(0) }, [run, guides])
  useEffect(() => {
    if (!guides || at >= guides.length) return
    const timer = window.setTimeout(() => setAt(value => value + 1), 800)
    return () => window.clearTimeout(timer)
  }, [guides, at])
  const count = guides?.length ?? 0
  if (guides && !guides.length) return <span className="dr-zh" lang="zh-Hans">{character}</span>
  return <svg viewBox="0 0 100 100" className="writing-pad dr-order-svg" role="img" aria-label={`Stroke order of ${character}`} data-strokes={count} data-shown={Math.min(at + 1, count)}>
    <path d="M50 0 V100 M0 50 H100 M0 0 L100 100 M100 0 L0 100" className="writing-gridlines" />
    <g aria-hidden="true">{(guides ?? []).map((guide, index) => index > at ? null : <path key={`${index}-${at === index}`} d={guide.path} data-stroke={index}
      className={`writing-guide${at === index ? ' replaying' : ' replayed'}`} strokeDasharray={at === index ? guide.length : undefined}
      style={at === index ? { '--stroke-length': guide.length } as CSSProperties : undefined} />)}</g>
  </svg>
}

/** The answer of a Write elsewhere question: each character with its stroke-order animation, and a Replay. */
export function StrokeOrder({ text }: { text: string }) {
  const characters = useMemo(() => Array.from(text).filter(character => isHan(character) && hasGuide(character)), [text])
  const [run, setRun] = useState(0)
  if (!characters.length) return <p className="dr-reveal"><span className="dr-zh" lang="zh-Hans">{text}</span></p>
  return <div className="dr-order" aria-label="Stroke order">
    <p className="dr-order-text"><span className="dr-zh" lang="zh-Hans">{text}</span></p>
    <div className="dr-order-row">{characters.map(character => <AnimatedCharacter key={character} character={character} run={run} />)}</div>
    <button type="button" className="button secondary" onClick={() => setRun(run + 1)}><RotateCcw size={16} /> Replay stroke order</button>
  </div>
}
