import { useEffect, useRef, useState } from 'react'
import { getPack } from '../core/language'
import { BandName } from './BandName'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Band } from '../core/study/contracts'
import type { Catalog } from '../core/study/catalog'
import type { Workspace } from '../core/model'
import type { GroupRow, Track } from '../data/tracks'
import { useAfterPaint, useBandRows, useBandSummaries, useKnownTimes } from './useGroupRows'

const statusText = (row: GroupRow) => row.status === 'done' ? 'Done' : row.status === 'current' ? 'Next' : row.status === 'partial' ? `${row.introduced}/${row.total}` : 'Upcoming'
const dateOf = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })

function BandRows({ track, catalog, known, nextId, band }: { track: Track; catalog: Catalog; known: Map<string, number>; nextId: string | undefined; band: Band }) {
  const rows = useBandRows(track, catalog, known, nextId, band, true)
  const next = useRef<HTMLLIElement>(null)
  useEffect(() => { next.current?.scrollIntoView?.({ block: 'center' }) }, [nextId])
  return <ol>{rows.map(row => <li key={row.id} ref={row.status === 'current' ? next : undefined} className={`lesson-index-row ${row.status}`} aria-current={row.status === 'current' ? 'step' : undefined} id={row.status === 'current' ? 'current-lesson' : undefined}>
    <a href={`#lessons/group/${row.id}`}>
      <span className="num">{row.number}</span><span className="title" lang={getPack().learningTag}>{row.title}</span>
      <span className="status">{statusText(row)}</span>
      <span className="date">{row.completedAt !== undefined ? dateOf(row.completedAt) : ''}</span>
    </a></li>)}</ol>
}

/**
 * The track's study groups by band. Only the band holding Next shows its rows; the others are one header line with
 * their Done count and build rows when expanded. The list mounts after the panels above it have painted.
 */
export function LessonList({ track, catalog, knowledge, nextId, nextBand }: { track: Track; catalog: Catalog | undefined; knowledge: Workspace['knowledge']; nextId: string | undefined; nextBand: Band | undefined }) {
  const ready = useAfterPaint()
  const known = useKnownTimes(knowledge)
  const summaries = useBandSummaries(track, catalog, known, ready)
  const [toggled, setToggled] = useState<Partial<Record<Band, boolean>>>({})
  if (!ready || !catalog) return null
  return <section className="lesson-index" aria-label={`${track.name} lessons`}>
    {summaries.map(({ band, total, done }) => {
      const open = toggled[band] ?? band === nextBand
      return <div key={band} className="lesson-index-group">
        <button type="button" className="lesson-index-band" aria-expanded={open} onClick={() => setToggled(state => ({ ...state, [band]: !open }))}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<h3><BandName n={band} /></h3><span className="small muted">{done} of {total} done</span>
        </button>
        {open && <BandRows track={track} catalog={catalog} known={known} nextId={nextId} band={band} />}
      </div>
    })}
  </section>
}
