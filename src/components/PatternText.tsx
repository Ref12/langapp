import { patternParts } from '../core/study/pattern'

/** A grammar pattern for the learner: fixed text at full weight, each <slot> as a small muted chip (its name as the text, no angle brackets), "+" as a thin gap. */
export function PatternText({ text }: { text: string }) {
  if (!text.includes('<') && !text.includes('+')) return <>{text}</>
  return <>{patternParts(text).map((part, index) => 'slot' in part ? <span key={index} className="pattern-slot">{part.slot}</span>
    : 'plus' in part ? <span key={index} className="pattern-plus" aria-hidden="true" />
    : <span key={index}>{part.text.trim() === '' ? '' : part.text}</span>)}</>
}
