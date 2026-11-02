import { addedByFrom, addedDate, type AddedByIndex } from '../../core/study/addedby'
import type { KnowledgeEntry } from '../../core/study/contracts'

/** "Added Nov 2, 2026 · by a lesson": when the item joined the knowledge set and what added it (a link when it can be opened). */
export function AddedByLine({ entry, index }: { entry: KnowledgeEntry; index?: AddedByIndex }) {
  if (!index) return null
  const by = addedByFrom(entry, index)
  return <p className="small muted added-by">Added {addedDate(by.at)}{by.label && <> · {by.href ? <>by <a className="text-link" href={by.href}>{by.label}</a></> : by.label.startsWith('from') ? by.label : `by ${by.label}`}</>}</p>
}
