import { useState } from 'react'
import { ChevronDown, Pencil, Trash2 } from 'lucide-react'
import type { AssistantThread } from '../../core/assistant/contracts'
import { updateThread } from '../../core/assistant/store'
import { ActionMenu } from './ActionMenu'

export function ConversationTitle({ thread, onDelete }: { thread: AssistantThread; onDelete: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(thread.title)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return <ActionMenu className="conversation-title-menu" align="start" label={`Conversation actions: ${thread.title}`}
    trigger={<><span>{thread.title}</span><ChevronDown size={16} aria-hidden="true" /></>}>
    {close => <>
      {renaming ? <form onSubmit={event => {
        event.preventDefault()
        if (saving) return
        setSaving(true)
        setError('')
        void updateThread(thread.id, { title }).then(() => {
          setRenaming(false)
          close()
        }, cause => setError(cause instanceof Error ? cause.message : 'The conversation could not be renamed.'))
          .finally(() => setSaving(false))
      }}>
        <label>Conversation name<input autoFocus value={title} maxLength={120} disabled={saving}
          onChange={event => setTitle(event.target.value)} /></label>
        <div className="button-row"><button className="button primary" type="submit" disabled={saving || !title.trim()}>Save name</button>
          <button className="button secondary" type="button" disabled={saving} onClick={() => { setRenaming(false); setError('') }}>Cancel rename</button></div>
      </form> : <>
        <button className="button secondary" type="button" onClick={() => { setTitle(thread.title); setError(''); setRenaming(true) }}><Pencil size={16} />Rename conversation</button>
        <button className="button secondary" type="button" onClick={() => { close(); onDelete() }}><Trash2 size={16} />Delete conversation</button>
      </>}
      {error && <p className="small connection-error" role="alert">{error}</p>}
    </>}
  </ActionMenu>
}
