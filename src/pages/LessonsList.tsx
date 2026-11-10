import { ArrowLeft } from 'lucide-react'
import { PageHeading, type PageProps } from '../components/shared'
import { LessonList } from '../components/LessonList'
import { zhTrack } from '../data/tracks'
import { useStudyActions } from './useStudyActions'

/** All lessons of the course: the per-band rows, on their own page (#lessons/list). The list scrolls its Next row into view. */
export function LessonsList({ workspace, now, run }: PageProps) {
  const { catalog, next } = useStudyActions({ workspace, now, run })
  return <>
    <a href="#lessons" className="back-link"><ArrowLeft size={16} /> Lessons</a>
    <PageHeading eyebrow="ALL LESSONS" title="Every lesson, in order.">The whole course. Open a lesson to read it, or go back to Lessons for what is next.</PageHeading>
    <LessonList track={zhTrack} catalog={catalog} knowledge={workspace.knowledge} nextId={next?.group.id} nextBand={next?.band} />
  </>
}
