import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { LoaderCircle, MessageCircle, Plus, Send, StopCircle } from 'lucide-react'
import { useActiveProfile } from '../../core/activeProfile'
import { invokeAIOperation } from '../../core/ai/operations'
import { db } from '../../core/database'
import type { ConversationMessage, ConversationThread } from '../../core/domain'
import { createId, nowIso } from '../../core/ids'
import { WovenText } from '../../components/WovenText'
import { analyzeAndWeaveText } from '../../techniques/diglotWeave'

export function ConversationPage() {
  const profile = useActiveProfile()
  const threads = useLiveQuery(
    () =>
      profile
        ? db.conversationThreads
            .where('profileId')
            .equals(profile.id)
            .reverse()
            .sortBy('updatedAt')
        : [],
    [profile?.id],
  )
  const [threadId, setThreadId] = useState<string>()

  useEffect(() => {
    if (!threadId && threads?.[0]) setThreadId(threads[0].id)
  }, [threadId, threads])

  const createThread = async () => {
    if (!profile) return
    const timestamp = nowIso()
    const thread: ConversationThread = {
      id: createId('thread'),
      profileId: profile.id,
      title: 'New conversation',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.conversationThreads.add(thread)
    setThreadId(thread.id)
  }

  return (
    <div className="module-layout">
      <aside className="module-panel">
        <div className="module-panel-header">
          <div>
            <p className="eyebrow">{profile?.name}</p>
            <h1>Conversation</h1>
          </div>
          <button
            className="icon-button"
            onClick={createThread}
            aria-label="New conversation"
          >
            <Plus />
          </button>
        </div>
        <div className="document-list">
          {(threads ?? []).map((thread) => (
            <button
              className={thread.id === threadId ? 'document-item active' : 'document-item'}
              onClick={() => setThreadId(thread.id)}
              key={thread.id}
            >
              <MessageCircle size={17} />
              <span>
                <strong>{thread.title}</strong>
                <small>{new Date(thread.updatedAt).toLocaleDateString()}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="chat-pane">
        {threadId && profile ? (
          <Conversation threadId={threadId} profileId={profile.id} />
        ) : (
          <div className="empty-state large">
            <MessageCircle size={38} />
            <h2>Talk about anything</h2>
            <p>Assistant replies will weave in items from your learning set.</p>
            <button className="primary-button" onClick={createThread}>
              Start a conversation
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function Conversation({
  threadId,
  profileId,
}: {
  threadId: string
  profileId: string
}) {
  const profile = useLiveQuery(() => db.profiles.get(profileId), [profileId])
  const messages = useLiveQuery(
    () =>
      db.conversationMessages
        .where('threadId')
        .equals(threadId)
        .sortBy('createdAt'),
    [threadId],
  )
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const controllerRef = useRef<AbortController>()

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const content = draft.trim()
    if (!content || !profile || sending) return
    setDraft('')
    setError('')
    setSending(true)
    const timestamp = nowIso()
    const userMessage: ConversationMessage = {
      id: createId('message'),
      threadId,
      role: 'user',
      canonicalContent: content,
      annotations: [],
      status: 'completed',
      createdAt: timestamp,
    }
    const assistantMessage: ConversationMessage = {
      id: createId('message'),
      threadId,
      role: 'assistant',
      canonicalContent: '',
      annotations: [],
      status: 'pending',
      createdAt: nowIso(),
    }
    await db.conversationMessages.bulkAdd([userMessage, assistantMessage])
    await db.conversationThreads.update(threadId, {
      title:
        (messages?.length ?? 0) === 0 ? content.slice(0, 48) : undefined,
      updatedAt: nowIso(),
    })

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const history = [...(messages ?? []), userMessage]
        .filter((message) => message.status === 'completed')
        .map((message) => ({
          role: message.role,
          content: message.canonicalContent,
        }))
      const generated = await invokeAIOperation(
        'conversation.generateTurn',
        {
          targetLanguage: profile.targetLanguage,
          messages: history,
        },
        controller.signal,
      )

      await db.conversationMessages.update(assistantMessage.id, {
        canonicalContent: generated.content,
        status: 'completed',
      })

      try {
        const annotations = await analyzeAndWeaveText(
          profile,
          generated.content,
          'conversation',
          controller.signal,
        )
        await db.conversationMessages.update(assistantMessage.id, { annotations })
      } catch (weaveError) {
        setError(
          `The reply was saved, but weaving failed: ${
            weaveError instanceof Error ? weaveError.message : 'Unknown error'
          }`,
        )
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Generation failed.'
      await db.conversationMessages.update(assistantMessage.id, {
        status: 'failed',
        error: message,
      })
      setError(message)
    } finally {
      controllerRef.current = undefined
      setSending(false)
    }
  }

  return (
    <div className="conversation">
      <div className="messages" aria-live="polite">
        {(messages ?? []).map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="message-label">
              {message.role === 'user' ? 'You' : 'LinguaWeave'}
            </div>
            {message.status === 'pending' ? (
              <div className="typing">
                <LoaderCircle className="spin" /> Thinking…
              </div>
            ) : message.annotations.length ? (
              <WovenText
                content={message.canonicalContent}
                annotations={message.annotations}
              />
            ) : (
              <p>{message.canonicalContent || message.error}</p>
            )}
          </article>
        ))}
      </div>
      {error && <div className="error-banner">{error}</div>}
      <form className="composer" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask or talk about anything…"
          rows={2}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        {sending ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => controllerRef.current?.abort()}
            aria-label="Stop response"
          >
            <StopCircle />
          </button>
        ) : (
          <button className="primary-button" aria-label="Send message">
            <Send />
          </button>
        )}
      </form>
    </div>
  )
}
