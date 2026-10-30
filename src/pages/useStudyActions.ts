import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../core/database'
import { resumeRows } from '../core/study/origin'
import { useAIConnection } from '../components/study/useAIConnection'
import { useCatalog } from '../components/study/useCatalog'
import type { PageProps } from '../components/shared'
import { navigate } from '../core/routing'
import { DOMAIN, groupProgress, nextGroup, startNewSession, startReviewSession } from '../core/study/knowledge'

/** What the Lessons hub and the Overview both show: the next group, due cards, resumable sessions and the Start/Review actions. */
export function useStudyActions({ workspace, now, run }: Pick<PageProps, 'workspace' | 'now' | 'run'>) {
  const { catalog, error } = useCatalog()
  const connection = useAIConnection()
  const [generating, setGenerating] = useState<'new' | 'review' | ''>('')
  const known = new Set(workspace.knowledge.map(entry => entry.ref))
  const due = workspace.studyCards.filter(card => card.domain === DOMAIN && card.due <= now && known.has(card.ref)).length
  const collections = useLiveQuery(() => db.collections.toArray(), []) ?? []
  const rows = resumeRows(workspace.exerciseSessions, collections, catalog)
  const curriculumOpen = { new: rows.some(row => row.origin.kind === 'new'), review: rows.some(row => row.origin.kind === 'review') }
  const next = catalog ? nextGroup(catalog, known) : undefined
  const progress = catalog ? groupProgress(catalog, known) : undefined
  const start = (mode: 'new' | 'review', anyway = false) => {
    setGenerating(mode)
    void run(async () => {
      try {
        const id = mode === 'new' ? await startNewSession(undefined, { resume: false }) : await startReviewSession(Date.now(), anyway)
        navigate(`lessons/session/${id}`)
      } finally {
        setGenerating('')
      }
    })
  }
  return { catalog, error, connection, generating, known, due, rows, curriculumOpen, next, progress, start }
}
