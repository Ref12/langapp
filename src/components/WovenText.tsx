import { useState, type ReactNode } from 'react'
import { Volume2 } from 'lucide-react'
import type { EnglishWordSelection, WeaveAnnotation } from '../core/domain'
import { canReadAloud, readAloud } from '../core/speech'

const englishWordPattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

function englishSegments(
  text: string,
  absoluteStart: number,
  onSelect?: (selection: EnglishWordSelection) => void,
): ReactNode[] {
  if (!onSelect) return [text]

  const segments: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(englishWordPattern)) {
    const localStart = match.index
    const word = match[0]
    if (localStart > cursor) segments.push(text.slice(cursor, localStart))
    const start = absoluteStart + localStart
    segments.push(
      <button
        type="button"
        className="english-word"
        key={`${start}:${word}`}
        onClick={() => onSelect({ text: word, start, end: start + word.length })}
        aria-label={`Translate ${word}`}
      >
        {word}
      </button>,
    )
    cursor = localStart + word.length
  }
  if (cursor < text.length) segments.push(text.slice(cursor))
  return segments
}

export function WovenText({
  content,
  annotations,
  onSelectEnglish,
  speechLang = 'en-US',
}: {
  content: string
  annotations: WeaveAnnotation[]
  onSelectEnglish?: (selection: EnglishWordSelection) => void
  speechLang?: string
}) {
  const [active, setActive] = useState<WeaveAnnotation | null>(null)
  const segments: ReactNode[] = []
  let cursor = 0

  for (const annotation of annotations) {
    if (annotation.start < cursor || annotation.end > content.length) continue
    segments.push(
      ...englishSegments(
        content.slice(cursor, annotation.start),
        cursor,
        onSelectEnglish,
      ),
    )
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
  segments.push(
    ...englishSegments(content.slice(cursor), cursor, onSelectEnglish),
  )

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
          <div className="word-actions">
            <span className={`tier-pill ${active.tier}`}>{active.tier}</span>
            <button
              type="button"
              onClick={() => readAloud(active.targetText, speechLang)}
              disabled={!canReadAloud()}
            >
              <Volume2 size={16} /> Read aloud
            </button>
          </div>
        </div>
      )}
    </>
  )
}
