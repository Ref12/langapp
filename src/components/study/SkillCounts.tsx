import './SkillCounts.css'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'
import { countsOf, setFamiliar, SKILLS, SKILL_LABEL, SKILL_LETTER } from '../../core/study/skills'

/** "R 12 · L 3 · S 3 · W 0" for a knowledge-set item, with a small menu marking it Familiar per skill (a familiar item comes up less). */
export function SkillCounts({ itemRef }: { itemRef: string }) {
  const rows = useLiveQuery(() => db.skillPractice.where('[ref+skill]').between([itemRef, ''], [itemRef, '\uffff']).toArray(), [itemRef]) ?? []
  const counts = countsOf(rows)
  return <div className="skill-counts">
    <span className="small muted" aria-label="Practice counts">{SKILLS.map(skill => `${SKILL_LETTER[skill]} ${counts[skill]?.count ?? 0}${counts[skill]?.familiar ? '*' : ''}`).join(' · ')}</span>
    <details className="skill-menu"><summary className="small">Familiar</summary>
      <div role="group" aria-label="Familiar skills">{SKILLS.map(skill => <label key={skill} className="small"><input type="checkbox" checked={counts[skill]?.familiar ?? false} onChange={event => void setFamiliar(itemRef, skill, event.target.checked)} /> {SKILL_LABEL[skill]}</label>)}</div></details>
  </div>
}
