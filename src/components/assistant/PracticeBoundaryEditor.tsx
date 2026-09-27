import { useId, useState } from 'react'
import { hasPracticeSpeech, MAX_PRACTICE_CHUNKS, type PracticePlan } from '../../core/assistant/practice-chain-contracts'
import { practiceCharacterGroups } from './practice-character-groups'

export function PracticeBoundaryEditor({ plan, disabled, trackCount, change }: {
  plan: PracticePlan
  disabled: boolean
  trackCount: number
  change: (ends: number[]) => void
}) {
  const hintId = useId()
  const [removedEnds, setRemovedEnds] = useState<Record<number, number>>({})
  const characters = plan.units.map(unit => unit.text)
  const groups = practiceCharacterGroups(plan.units)
  return <fieldset className="practice-boundary-editor" disabled={disabled}>
    <legend>Split points</legend>
    <p className="small" id={hintId}>Tap a character to split after it. Highlighted characters mark chunk ends; tap again to join.
      {' '}Following punctuation stays with the preceding chunk; existing punctuation positions are preserved.
      {' '}The final chunk end is automatic. Changes apply after Save chunks.</p>
    <div className="practice-character-buttons practice-boundaries" lang="zh-Hans">
      {groups.map((group, index) => {
        if (group.plain) return <span className="practice-character-punctuation" key={group.start}>{group.text}</span>
        let followingEnd = group.end
        for (let next = index + 1; groups[next]?.plain; next++) followingEnd = groups[next].end
        // A saved split before/within punctuation belongs to the preceding tile.
        // Remember its exact offset so joining and re-splitting is reversible.
        const existingEnd = plan.ends.find(end => end >= group.end && end <= followingEnd && end < characters.length)
        const rememberedEnd = removedEnds[group.start]
        const offset = existingEnd ?? (rememberedEnd >= group.end && rememberedEnd <= followingEnd ? rememberedEnd : followingEnd)
        const checked = existingEnd !== undefined
        const final = offset === characters.length
        const chunkIndex = plan.ends.findIndex(end => end >= offset)
        const start = chunkIndex > 0 ? plan.ends[chunkIndex - 1] : 0
        const end = plan.ends[chunkIndex]
        const spoken = checked || (hasPracticeSpeech(characters.slice(start, offset).join('')) && hasPracticeSpeech(characters.slice(offset, end).join('')))
        const full = !checked && trackCount >= MAX_PRACTICE_CHUNKS
        const punctuation = offset > group.end ? `; includes following punctuation through character ${offset}` : ''
        return <button key={group.start} type="button"
          aria-label={`Split after character ${group.end}: ${group.text}${punctuation}`}
          aria-describedby={hintId} aria-pressed={checked}
          disabled={disabled || final || !spoken || full}
          title={final ? 'The final chunk end is automatic.' : !spoken ? 'Each chunk needs spoken text; punctuation stays with a neighboring chunk.' : full ? 'The playlist already has 80 steps.' : checked ? 'Tap to join these chunks' : 'Tap to split after this character'}
          onClick={() => {
            if (checked) {
              setRemovedEnds(previous => ({ ...previous, [group.start]: offset }))
              change(plan.ends.filter(end => end !== offset))
            } else {
              change([...plan.ends, offset].sort((a, b) => a - b))
            }
          }}>{group.text}</button>
      })}
    </div>
  </fieldset>
}
