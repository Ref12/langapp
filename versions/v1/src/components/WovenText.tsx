import { useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type {
  EnglishWordSelection,
  LearningItem,
  UserItemState,
  WeaveAnnotation,
} from '../core/domain'
import { db } from '../core/database'
import { nowIso } from '../core/ids'
import {
  annotationsForLearningItem,
  removeOverlaps,
} from '../techniques/diglotWeave'
import { SpeechControls } from './SpeechControls'

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
  onUpdateDisplay,
  profileId,
  speechLang = 'en-US',
}: {
  content: string
  annotations: WeaveAnnotation[]
  onSelectEnglish?: (selection: EnglishWordSelection) => void
  onUpdateDisplay?: (
    annotation: WeaveAnnotation,
    preferences: { showRomanization: boolean; showEnglish: boolean },
  ) => void | Promise<void>
  profileId?: string
  speechLang?: string
}) {
  const [active, setActive] = useState<WeaveAnnotation | null>(null)
  const tracked = useLiveQuery(async () => {
    if (!profileId) return []
    const states = await db.userItemStates
      .where('profileId')
      .equals(profileId)
      .toArray()
    const items = await db.learningItems.bulkGet(
      states.map((state) => state.itemId),
    )
    return states.flatMap((state, index) =>
      items[index] ? [{ state, item: items[index] }] : [],
    ) as Array<{ state: UserItemState; item: LearningItem }>
  }, [profileId])
  const stateByItemId = new Map(
    (tracked ?? []).map(({ state }) => [state.itemId, state]),
  )
  const renderAnnotations = useMemo(() => {
    const globalAnnotations = (tracked ?? []).flatMap(({ item, state }) =>
      annotationsForLearningItem(content, item, state.tier).map(
        (annotation) => ({
          ...annotation,
          id: `global:${item.id}:${annotation.start}:${annotation.end}`,
        }),
      ),
    )
    const contextAnnotations = annotations.filter(
      (annotation) =>
        !globalAnnotations.some(
          (global) =>
            global.start < annotation.end && global.end > annotation.start,
        ),
    )
    return removeOverlaps([...globalAnnotations, ...contextAnnotations])
  }, [annotations, content, tracked])

  const displayFor = (annotation: WeaveAnnotation) => {
    const state = stateByItemId.get(annotation.itemId)
    return {
      tier: state?.tier ?? annotation.tier,
      showRomanization:
        state?.showRomanization ??
        annotation.showRomanization ??
        (state?.tier ?? annotation.tier) === 'learning',
      showEnglish:
        state?.showEnglish ?? annotation.showEnglish ?? false,
      state,
    }
  }

  const updateDisplay = async (
    annotation: WeaveAnnotation,
    preferences: { showRomanization: boolean; showEnglish: boolean },
  ) => {
    const state = stateByItemId.get(annotation.itemId)
    if (state) {
      await db.userItemStates.update(state.id, {
        ...preferences,
        updatedAt: nowIso(),
      })
    } else {
      await onUpdateDisplay?.(annotation, preferences)
    }
  }

  const segments: ReactNode[] = []
  let cursor = 0

  for (const annotation of renderAnnotations) {
    if (annotation.start < cursor || annotation.end > content.length) continue
    segments.push(
      ...englishSegments(
        content.slice(cursor, annotation.start),
        cursor,
        onSelectEnglish,
      ),
    )
    const display = displayFor(annotation)
    segments.push(
      <button
        type="button"
        className={`woven-word ${display.tier}`}
        key={annotation.id}
        onClick={() => setActive(annotation)}
        aria-label={`${annotation.targetText}, ${annotation.gloss}`}
      >
        <ruby>
          {annotation.targetText}
          {display.showRomanization && <rt>{annotation.romanization}</rt>}
        </ruby>
        {display.showEnglish && (
          <span className="woven-english"> ({annotation.gloss})</span>
        )}
      </button>,
    )
    cursor = annotation.end
  }
  segments.push(
    ...englishSegments(content.slice(cursor), cursor, onSelectEnglish),
  )

  const activeDisplay = active ? displayFor(active) : undefined

  return (
    <>
      <div className="reading-text">{segments}</div>
      {active && activeDisplay && (
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
          <span className={`tier-pill ${activeDisplay.tier}`}>
            {activeDisplay.tier}
          </span>
          <div className="display-preferences">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={activeDisplay.showRomanization}
                onChange={(event) =>
                  updateDisplay(active, {
                    showRomanization: event.target.checked,
                    showEnglish: activeDisplay.showEnglish,
                  })
                }
              />
              Show romanization in replacements
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={activeDisplay.showEnglish}
                onChange={(event) =>
                  updateDisplay(active, {
                    showRomanization: activeDisplay.showRomanization,
                    showEnglish: event.target.checked,
                  })
                }
              />
              Show English in replacements
            </label>
          </div>
          <SpeechControls text={active.targetText} language={speechLang} />
        </div>
      )}
    </>
  )
}
