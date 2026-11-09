import type { LessonRow, Track } from '../data/tracks'

const statusText = (row: LessonRow) => row.status === 'done' ? 'Done' : row.status === 'current' ? 'Next' : row.status === 'partial' ? `${row.introduced}/${row.total}` : row.status === 'none' ? '\u2014' : 'Upcoming'
const dateOf = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })

/** One dense line per lesson, grouped by level. */
export function LessonList({ track, rows }: { track: Track; rows: LessonRow[] }) {
  const groups = track.levels.map(level => ({ level, rows: rows.filter(row => row.lesson.curriculum.levelId === level.id) })).filter(group => group.rows.length)
  return <section className="lesson-index" aria-label={`${track.name} lessons`}>
    {groups.map(({ level, rows }) => <div key={level.id} className="lesson-index-group">
      <h3>Level {level.number}: {level.title}</h3>
      <ol>{rows.map(row => <li key={row.lesson.id} className={`lesson-index-row ${row.status}`} aria-current={row.status === 'current' ? 'step' : undefined} id={row.status === 'current' ? 'current-lesson' : undefined}>
        <a href={`#lesson/${row.lesson.id}`}>
          <span className="num">{row.number}</span><span className="title"><span className="title-text">{row.label}</span>{row.part && <span className="part"> · {row.part}</span>}</span>
          <span className="status">{statusText(row)}</span>
          <span className="date">{row.completedAt !== undefined ? dateOf(row.completedAt) : ''}</span>
        </a></li>)}</ol>
    </div>)}
  </section>
}
