import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Workspace } from '../core/model'
import type { Catalog } from '../core/study/catalog'
import { LESSON_COUNT, lessonTitle, loadParallel, type ParallelData } from '../core/parallel/data'
import { nextParallelLesson, studiedLessons } from '../core/parallel/progress'
import { groupRows, zhTrack, type GroupStatus, type Track } from '../data/tracks'
import { unitRef } from '../core/study/contracts'
import { useKnownTimes } from './useGroupRows'

const zhHint = (status: GroupStatus | undefined) => status === 'done' ? 'Done' : status === 'current' ? 'Next' : status === 'partial' ? 'Started' : status === 'upcoming' ? 'Upcoming' : ''
const dateOf = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })

/** The lessons of a Japanese or Korean track in the Chinese list's layout: one band, "with Chinese", each row hinting where the Chinese lesson stands. */
export function ParallelLessonList({ track, catalog, workspace }: { track: Track; catalog: Catalog | undefined; workspace: Workspace }) {
  const language = track.language as 'ja' | 'ko'
  const [data, setData] = useState<ParallelData>()
  const [error, setError] = useState('')
  const [open, setOpen] = useState(true)
  useEffect(() => {
    let live = true
    setData(undefined); setError('')
    loadParallel(language).then(value => { if (live) setData(value) }, reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [language])
  const studied = useMemo(() => studiedLessons(workspace.lessons, language), [workspace.lessons, language])
  const next = nextParallelLesson(studied, LESSON_COUNT)
  const known = useKnownTimes(workspace.knowledge)
  const chinese = useMemo(() => catalog
    ? groupRows(zhTrack, { orderedGroups: catalog.orderedGroups, titleOf: () => '' }, known, undefined, (kind, ref) => unitRef(kind as 'vocabulary' | 'grammar', ref), '1')
    : [], [catalog, known])
  const firstOpen = chinese.findIndex(row => row.status !== 'done')
  const nextRow = useRef<HTMLLIElement>(null)
  useEffect(() => { if (open) nextRow.current?.scrollIntoView?.({ block: 'center' }) }, [data, next, open])
  if (error) return <div className="notice error" role="alert"><p>The {track.name} lessons could not be loaded. {error}</p></div>
  if (!data) return <p className="muted" role="status">Loading the {track.name} lessons...</p>
  return <section className="lesson-index" aria-label={`${track.name} lessons`}>
    <div className="lesson-index-group">
      <button type="button" className="lesson-index-band" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<h3>HSK 1 · with Chinese</h3><span className="small muted">{studied.size} of {data.lessons.length} done</span>
      </button>
      {open && <ol>{data.lessons.map(lesson => {
        const status = studied.has(lesson.number) ? 'done' : lesson.number === next ? 'current' : 'upcoming'
        const zh = chinese[lesson.number - 1]
        const hint = zhHint(lesson.number - 1 === firstOpen && zh?.status !== 'done' ? 'current' : zh?.status)
        return <li key={lesson.number} ref={status === 'current' ? nextRow : undefined} className={`lesson-index-row ${status}`} aria-current={status === 'current' ? 'step' : undefined}>
          <a href={`#lessons/${language}/${lesson.number}`}>
            <span className="num">{lesson.number}</span><span className="title" lang={language}>{lessonTitle(data, lesson)}</span>
            <span className="status">{status === 'done' ? 'Done' : status === 'current' ? 'Next' : 'Upcoming'}</span>
            <span className="date">{studied.has(lesson.number) ? dateOf(studied.get(lesson.number)!) : ''}</span>
            {hint && <span className="zh-hint small muted"><span lang="zh-Hans">{'\u4E2D'}</span> {hint}</span>}
          </a></li>
      })}</ol>}
    </div>
  </section>
}
