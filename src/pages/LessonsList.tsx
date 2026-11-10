import { useState } from 'react'
import { getPack } from '../core/language'
import { ArrowLeft } from 'lucide-react'
import { PageHeading, type PageProps } from '../components/shared'
import { LessonList } from '../components/LessonList'
import { ParallelLessonList } from '../components/ParallelLessonList'
import { TrackHeader } from '../components/TrackHeader'
import { startTrack } from '../core/parallel/progress'
import { currentLanguageOf, startedTracks, tracks, trackFor } from '../data/tracks'
import { useStudyActions } from './useStudyActions'

/** All lessons of the current track: the track picker and the per-band rows, on their own page (#lessons/list). The list scrolls its Next row into view. */
export function LessonsList({ workspace, now, run }: PageProps) {
  const { catalog, next } = useStudyActions({ workspace, now, run })
  const track = trackFor(currentLanguageOf(workspace.preferences))
  const [moreTracks, setMoreTracks] = useState(false)
  return <>
    <a href="#lessons" className="back-link"><ArrowLeft size={16} /> Lessons</a>
    <PageHeading eyebrow="ALL LESSONS" title="Every lesson, in order.">{`${getPack().courseTracks ? 'The whole course for the current track.' : 'The whole course.'} Open a lesson to read it, or go back to Lessons for what is next.`}</PageHeading>
    {getPack().courseTracks && <TrackHeader tracks={tracks} current={track} all={moreTracks} started={item => startedTracks(workspace.preferences).some(other => other.id === item.id)}
      onMore={() => setMoreTracks(true)} onSelect={item => void run(() => startTrack(item.language))} />}
    {track.parallel ? <ParallelLessonList track={track} catalog={catalog} workspace={workspace} />
      : <LessonList track={track} catalog={catalog} knowledge={workspace.knowledge} nextId={next?.group.id} nextBand={next?.band} />}
  </>
}
