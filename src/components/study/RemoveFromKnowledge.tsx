import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BookMinus } from 'lucide-react'
import { describeRefs, removeRunFromKnowledge, runAddedRefs, type RunKind } from '../../core/study/knowledge'
import { ConfirmDialog } from '../ConfirmDialog'

/**
 * "Remove from knowledge set" for a lesson, practice set or Hands-free run: takes back only what that run added.
 * Renders nothing when the run added nothing, or all of it is already removed.
 */
export function RemoveFromKnowledge({ kind, id, name, icon = false }: { kind: RunKind; id: string; name: string; icon?: boolean }) {
  const refs = useLiveQuery(() => runAddedRefs(kind, id), [kind, id])
  const [asking, setAsking] = useState<string[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!refs?.length && !asking) return null
  const label = `Remove ${name} from knowledge set`
  const confirm = async () => {
    setBusy(true); setError('')
    try { await removeRunFromKnowledge(kind, id); setAsking(undefined) } catch (reason) { setError(reason instanceof Error ? reason.message : 'That could not be removed.') } finally { setBusy(false) }
  }
  return <>
    {icon
      ? <button type="button" className="icon-button" aria-label={label} title="Remove from knowledge set" onClick={() => setAsking(refs ?? [])}><BookMinus size={17} /></button>
      : <button type="button" className="button secondary" aria-label={label} onClick={() => setAsking(refs ?? [])}>Remove from knowledge set</button>}
    {asking && <ConfirmDialog title="Remove from knowledge set" confirmLabel="Remove" busy={busy} onCancel={() => setAsking(undefined)} onConfirm={() => void confirm()}
      detail={<>Remove {describeRefs(asking)} from your knowledge set? Their reviews go too; your practice history stays.{error && <span className="small save-error" role="alert"> {error}</span>}</>} />}
  </>
}
