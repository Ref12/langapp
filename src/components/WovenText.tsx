import { useState } from 'react'
import type { WeaveAnnotation } from '../core/domain'

export function WovenText({
  content,
  annotations,
}: {
  content: string
  annotations: WeaveAnnotation[]
}) {
  const [active, setActive] = useState<WeaveAnnotation | null>(null)
  const segments: React.ReactNode[] = []
  let cursor = 0

  for (const annotation of annotations) {
    if (annotation.start < cursor || annotation.end > content.length) continue
    segments.push(content.slice(cursor, annotation.start))
    const showRomanization = annotation.tier === 'learning'
    segments.push(
      <button
        type="button"
        className={`woven-word ${annotation.tier}`}
        key={annotation.id}
        onClick={() => setActive(annotation)}
        aria-label={`${annotation.targetText}, ${annotation.gloss}`}
      >
        <ruby>
          {annotation.targetText}
          {showRomanization && <rt>{annotation.romanization}</rt>}
        </ruby>
      </button>,
    )
    cursor = annotation.end
  }
  segments.push(content.slice(cursor))

  return (
    <>
      <div className="reading-text">{segments}</div>
      {active && (
        <div className="word-popover" role="dialog" aria-label="Word details">
          <button
            className="close-button"
            onClick={() => setActive(null)}
            aria-label="Close word details"
          >
            ×
          </button>
          <div className="word-native">{active.targetText}</div>
          <div className="word-romanization">{active.romanization}</div>
          <div className="word-gloss">{active.gloss}</div>
          <span className={`tier-pill ${active.tier}`}>{active.tier}</span>
        </div>
      )}
    </>
  )
}
