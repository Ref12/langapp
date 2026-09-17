import { ArrowLeft, ArrowRight } from 'lucide-react'

export function LessonPagination({ lessonId, current, total, nextLabel = 'Next' }: {
  lessonId: string; current: number; total: number; nextLabel?: string
}) {
  return <nav className="lesson-pagination" aria-label="Lesson pages">
    {current > 1 ? <a className="button secondary" href={`#lesson/${lessonId}/${current - 1}`}><ArrowLeft size={16} /> Previous</a>
      : <button className="button secondary" disabled><ArrowLeft size={16} /> Previous</button>}
    {current < total && <a className="button primary" href={`#lesson/${lessonId}/${current + 1}`}>
      {nextLabel} <ArrowRight size={16} /></a>}
  </nav>
}
