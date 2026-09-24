import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, MessageCircle, Mic, PanelLeftClose, PanelLeftOpen, Plus, Search, Send, Settings, Square, Trash2, X } from 'lucide-react'
import { db } from '../core/database'
import { normalizeSearch } from '../core/search'
import { navigate } from '../core/routing'
import { MAX_DRAFT_LENGTH, practiceInputSchema, speechLocaleSchema, speechRateSchema, type AssistantMessage, type AssistantThread, type SpeechBlock } from '../core/assistant/contracts'
import { createConversation, deleteThread, expireAssistantRuns, saveDraft, selectPracticePhrase, updateThread } from '../core/assistant/store'
import { cancelAssistantRun, sendAssistantTurn } from '../core/assistant/runtime'
import { AssistantText } from '../components/assistant/AssistantText'
import { MessageActions } from '../components/assistant/MessageActions'
import { HearButton, SnippetActions } from '../components/assistant/SnippetActions'
import { PhrasePractice } from '../components/assistant/PhrasePractice'
import { PracticeResultBubble } from '../components/assistant/PracticeResultBubble'
import { getPlaybackState, playBrowserSpeech, stopBrowserSpeech } from '../core/assistant/speech'
import { LocalSpeechSetupContext, LocalSpeechRateSetupContext } from '../components/assistant/local-ai-setup-context'
import type { SpeechConnection } from '../core/assistant/speech-contracts'
import { registerDraftEditor } from '../core/assistant/draft-actions'
import { appendContextText, finishDraftSave, getDraftFailures, getUnsavedDraft, rememberDraft } from '../core/assistant/drafts'
import { useConversationVoice } from '../components/assistant/useConversationVoice'

function ConversationList({ selectedId, collapsed = false, expand, returnRoute = 'overview' }: {
  selectedId?: string; collapsed?: boolean; expand?: () => void; returnRoute?: string
}) {
  const threads = useLiveQuery(() => db.assistantThreads.orderBy('updatedAt').reverse().toArray(), [])
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const speedSetup = useContext(LocalSpeechRateSetupContext)
  const [error, setError] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const focusSearch = useRef(false)
  const matches = threads?.filter(thread => normalizeSearch(`${thread.title} ${thread.mode}`).includes(normalizeSearch(query))) ?? []
  useEffect(() => {
    if (!collapsed && focusSearch.current) {
      focusSearch.current = false
      search.current?.focus()
    }
  }, [collapsed])
  return <div className={`conversation-picker ${collapsed ? 'picker-collapsed' : ''}`}>
    <div className="conversation-picker-heading"><h2>Assistant</h2>{expand && <button className="icon-button" title={collapsed ? 'Expand conversations' : 'Collapse conversations'} aria-label={collapsed ? 'Expand conversations' : 'Collapse conversations'} onClick={expand}>
      {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
    </button>}</div>
    <button className="button primary" disabled={pending || speedSetup === 'loading'} title="New conversation" aria-label="New conversation" onClick={() => {
      setPending(true)
      setError('')
      void createConversation(undefined, returnRoute).then(id => navigate(`conversation/${id}`),
        reason => setError(reason instanceof Error ? reason.message : 'The conversation could not be created.')).finally(() => setPending(false))
    }}><Plus size={18} /><span>New conversation</span></button>
    {collapsed ? <button className="icon-button" title="Find a conversation" aria-label="Find a conversation" onClick={() => {
      focusSearch.current = true
      expand?.()
    }}><Search size={18} /></button> : null}
    <label className="search-field"><Search size={16} /><input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label="Find a conversation" placeholder="Find a conversation" /></label>
    <nav className="conversation-threads" aria-label="Conversations">
      {matches.map(thread => <a key={thread.id} href={`#conversation/${thread.id}`} aria-current={thread.id === selectedId ? 'page' : undefined}>
        <MessageCircle size={17} /><span><strong>{thread.title}</strong><small>{thread.mode === 'shadow' ? 'Shadow' : 'Conversation'}</small></span>
      </a>)}
    </nav>
    {!collapsed && threads && !matches.length && <p className="small muted">{query ? 'No matching conversations.' : 'Start a conversation. Nothing is sent until you choose Send.'}</p>}
    {error && <p className="small" role="alert">{error}</p>}
  </div>
}

export function AssistantSidebar({ selectedId, collapsed, toggle, returnRoute }: {
  selectedId?: string; collapsed: boolean; toggle: () => void; returnRoute: string
}) {
  const thread = useLiveQuery(() => selectedId ? db.assistantThreads.get(selectedId) : undefined, [selectedId])
  return <div className="assistant-desktop-picker"><ConversationList selectedId={selectedId} collapsed={collapsed} expand={toggle} returnRoute={thread?.returnRoute ?? returnRoute} /></div>
}

interface InlinePracticeControls {
  activeId?: string
  activate: (id: string) => void
  close: (id: string) => Promise<void>
  busy: boolean
  connection?: SpeechConnection
  loading: boolean
}

function ConversationPhraseActions({ message, blockIndex, phrase, thread, controls }: {
  message: AssistantMessage; blockIndex: number; phrase: SpeechBlock; thread: AssistantThread; controls: InlinePracticeControls
}) {
  const key = JSON.stringify([message.id, blockIndex, phrase, thread.practiceInput ?? 'listen-repeat',
    thread.speechFeedback ?? true, controls.connection?.revision])
  return <PhrasePractice key={key} thread={thread} phrase={phrase} busy={controls.busy}
    speechConnection={controls.connection} connectionLoading={controls.loading}
    inline={{ message, blockIndex, active: controls.activeId === key, activate: () => controls.activate(key) }}
    onClose={() => controls.close(key)} />
}

function Message({ message, thread, onExplain, onPractice, inlinePractice }: {
  message: AssistantMessage; thread: AssistantThread; onExplain: (phrase: SpeechBlock) => void; onPractice: (phrase: SpeechBlock) => void
  inlinePractice: InlinePracticeControls
}) {
  if (message.role === 'event') return <p className="assistant-mode-marker">{message.text}</p>
  if (message.role === 'practice') return <PracticeResultBubble message={message} rate={thread.speechRate} romanization={thread.romanization} />
  return <article className={`assistant-message message-${message.role}`} aria-label={message.role === 'user' ? 'Your message' : 'Assistant reply'}>
    <p className="eyebrow">{message.role === 'user' ? 'YOU' : 'ASSISTANT'}{message.mode === 'shadow' ? ' / SHADOW' : ''}</p>
    {message.source && <details className="message-source"><summary>{message.source.title}</summary><blockquote>{message.source.text}</blockquote>
      <a className="text-link" href={`#${message.source.route}`}>Open source</a></details>}
    {message.role === 'user' && <p className="user-message-text">{message.text}</p>}
    {message.practice && <details className="message-source"><summary>Translation practice / reviewed speech transcript</summary>
      <blockquote lang="zh-Hans">{message.practice.phrase.text}</blockquote>
      <p className="small">Feedback compares wording, not pronunciation.</p>
    </details>}
    {message.blocks.map((block, index) => block.type === 'text'
      ? <div key={index}><AssistantText markdown={block.markdown} /></div>
      : <div className="speech-block" key={index}>
        <p lang={block.locale} className={block.locale === 'zh-Hans' ? 'speech-native' : ''}>{block.text}</p>
        {thread.romanization && block.romanization && <p className="pinyin" data-assistant-exclude>{block.romanization}</p>}
        {block.meaning && <p className="small muted">{block.meaning}</p>}
        {block.locale === 'zh-Hans'
          ? thread.mode === 'conversation' && message.role === 'assistant' && message.status === 'completed'
            ? <ConversationPhraseActions message={message} blockIndex={index} phrase={block} thread={thread} controls={inlinePractice} />
            : <SnippetActions source={{ text: block.text, meaning: block.meaning, locale: block.locale, title: 'Assistant phrase', route: `conversation/${thread.id}` }}
            rate={thread.speechRate} onPractice={() => onPractice(block)} />
          : <HearButton text={block.text} locale={block.locale} />}
        {thread.mode === 'shadow' && message.mode === 'shadow' && block.locale === 'zh-Hans' && <div className="button-row shadow-actions" data-assistant-exclude>
          <button className="button secondary" onClick={() => onExplain(block)}>Explain more</button>
        </div>}
      </div>)}
    {message.status === 'pending' && <p className="small muted" role="status">Working on your reply...</p>}
    {message.error && <p className="small connection-error">{message.error}</p>}
    <MessageActions message={message} />
  </article>
}

function Conversation({ thread }: { thread: AssistantThread }) {
  const messages = useLiveQuery(() => db.assistantMessages.where('threadId').equals(thread.id).sortBy('sequence'), [thread.id])
  const runs = useLiveQuery(() => db.assistantRuns.where('threadId').equals(thread.id).toArray(), [thread.id])
  const connection = useLiveQuery(() => db.aiConnections.get('assistant'), [])
  const speechSetup = useLiveQuery(async () => ({ connection: await db.speechConnections.get('assistant-speech') }), [])
  const localSpeechSetup = useContext(LocalSpeechSetupContext)
  const [draft, setDraft] = useState(() => getUnsavedDraft(thread.id) ?? thread.draft)
  const [error, setError] = useState(() => getDraftFailures().includes(thread.id) ? 'Draft not saved. Your unsaved text was retained in memory.' : '')
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [inlinePracticeId, setInlinePracticeId] = useState<string>()
  const previewPlaybackId = `practice-preview-${thread.id}`
  const writes = useRef<Promise<void>>(Promise.resolve())
  const sendVersion = useRef(0)
  const sendPending = useRef(false)
  const latestDraft = useRef(draft)
  const input = useRef<HTMLTextAreaElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const settings = useRef<HTMLDivElement>(null)
  const active = runs?.some(run => run.status === 'running') ?? false
  const busy = sending || active
  const practicePhrase = thread.practicePhrase ?? (thread.shadowIntent === 'repeat' ? thread.shadowPhrase : undefined)
  const lastFailed = [...(messages ?? [])].reverse().find(message => message.role === 'assistant' && ['failed', 'cancelled'].includes(message.status))
  const lastMessage = messages?.[messages.length - 1]
  const retryUser = lastFailed && lastMessage?.id === lastFailed.id
    ? messages?.find(message => message.role === 'user' && message.runId === lastFailed.runId && message.intent !== 'repeat' && !message.practice) : undefined

  useEffect(() => () => {
    if (getPlaybackState().activeId === previewPlaybackId) stopBrowserSpeech()
  }, [previewPlaybackId, thread.mode])

  const save = useCallback((value: string, source?: AssistantThread['source']) => {
    rememberDraft(thread.id, value)
    setSaving(true)
    const write = () => saveDraft(thread.id, value, source)
    const pending = writes.current.then(write, write)
    writes.current = pending
    void pending.then(() => {
      finishDraftSave(thread.id, value, true)
      if (writes.current === pending) { setSaving(false); setError('') }
    }, reason => {
      finishDraftSave(thread.id, value, false)
      if (writes.current === pending) setSaving(false)
      setError(`Draft not saved. ${reason instanceof Error ? reason.message : 'Browser storage is unavailable.'}`)
    })
    return pending
  }, [thread.id])
  const voice = useConversationVoice({
    thread, disabled: busy || deleting,
    getDraft: () => latestDraft.current,
    changeDraft: value => { latestDraft.current = value; setDraft(value) },
    save, send,
  })
  const cancelVoice = voice.cancel
  useEffect(() => registerDraftEditor(thread.id, async source => {
    if (deleting || (sending && !active)) throw new Error('Wait for the current action to finish before adding context.')
    cancelVoice()
    const value = appendContextText(latestDraft.current, source)
    latestDraft.current = value
    setDraft(value)
    await save(value, thread.source ?? source)
    if (!document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) input.current?.focus()
  }), [thread.id, thread.source, deleting, sending, active, save, cancelVoice])
  useEffect(() => {
    const expire = () => { void expireAssistantRuns().catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to recover interrupted replies.')) }
    expire()
    const timer = window.setInterval(expire, 10000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (lastMessage?.role === 'practice') document.getElementById(`practice-result-${lastMessage.id}`)?.scrollIntoView?.({ block: 'start' })
    else history.current?.scrollTo?.({ top: history.current.scrollHeight })
  }, [lastMessage?.id, lastMessage?.role, lastMessage?.status, busy, practicePhrase?.text])
  useEffect(() => {
    if (!settingsOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSettingsOpen(false); input.current?.focus() } }
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !settings.current?.contains(event.target)) setSettingsOpen(false) }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', outside) }
  }, [settingsOpen])

  const action = async (operation: () => Promise<void>) => {
    setError('')
    try { await operation() } catch (reason) { setError(reason instanceof Error ? reason.message : 'This Assistant action could not be completed.') }
  }
  async function send(text: string) {
    if (busy || sendPending.current || deleting || !text.trim()) return
    sendPending.current = true
    const version = ++sendVersion.current
    let reply: ReturnType<typeof voice.prepareReply> | undefined
    setSending(true)
    setError('')
    let persisted = false
    const started = Date.now()
    try {
      reply = voice.prepareReply()
      await save(text)
      persisted = true
      if (version !== sendVersion.current) return
      setDraft('')
      latestDraft.current = ''
      const message = await sendAssistantTurn(thread.id, { text })
      if (version === sendVersion.current) reply.play(message)
    } catch (reason) {
      if (persisted && !latestDraft.current) {
        try {
          const submitted = await db.assistantMessages.where('threadId').equals(thread.id)
            .filter(message => message.role === 'user' && message.text === text && message.createdAt >= started).count()
          if (!submitted) { setDraft(text); latestDraft.current = text }
        } catch {
          setDraft(text)
          latestDraft.current = text
          setError('The message could not be confirmed in browser storage. Your text is retained in the composer; check the conversation before sending again.')
          return
        }
      }
      setError(reason instanceof Error ? reason.message : 'The message could not be sent.')
    } finally { reply?.finish(); sendPending.current = false; setSending(false) }
  }
  const sendAdditional = async (request: Parameters<typeof sendAssistantTurn>[1]) => {
    if (busy || sendPending.current || deleting) return
    sendPending.current = true
    let reply: ReturnType<typeof voice.prepareReply> | undefined
    setSending(true)
    try { await action(async () => {
      reply = voice.prepareReply()
      reply.play(await sendAssistantTurn(thread.id, request))
    }) }
    finally { reply?.finish(); sendPending.current = false; setSending(false) }
  }
  const voiceStatus = busy ? 'Thinking...' : voice.speaking ? 'Speaking...'
    : voice.capture?.phase === 'listening' ? 'Listening...'
      : voice.capture?.phase === 'cue' ? 'Get ready...'
        : voice.capture?.phase === 'starting' ? 'Starting microphone...'
          : voice.capture ? 'Finishing recording...' : ''
  return <section className="assistant-conversation" aria-label="Assistant conversation">
    <header className="conversation-header">
      <a className="icon-button mobile-conversation-back" href="#conversation" aria-label="All conversations"><ArrowLeft size={20} /></a>
      <div><h1>{thread.title}</h1><p className="small muted">{thread.mode === 'shadow' ? 'Shadow / reflect, repeat, understand' : 'Conversation / English and Mandarin'}</p></div>
      <button className="icon-button" aria-label="Delete conversation" title="Delete conversation" onClick={() => setConfirmDelete(true)}><Trash2 size={18} /></button>
    </header>
    <div ref={history} className="assistant-history" tabIndex={0} aria-label="Conversation history">
      {!messages?.length && <div className="assistant-welcome"><MessageCircle size={32} className="accent" /><h2>A partner in your learning.</h2>
        <p>Ask about a word, explore a lesson, or switch to Shadow to practice expressing a thought in Mandarin.</p><p className="small muted">Conversation is practice, not proof of mastery. AI explanations can be mistaken.</p></div>}
      {messages?.map(message => <Message key={message.id} message={message} thread={thread}
        inlinePractice={{
          activeId: inlinePracticeId, activate: setInlinePracticeId,
          close: async id => setInlinePracticeId(current => current === id ? undefined : current),
          busy: busy || deleting, connection: speechSetup?.connection, loading: !speechSetup || localSpeechSetup === 'loading',
        }}
        onPractice={phrase => {
          if (busy) { setError('Stop or finish the current reply before practicing.'); return }
          playBrowserSpeech(previewPlaybackId, phrase.text, phrase.locale, thread.speechRate)
          void action(() => selectPracticePhrase(thread.id, phrase))
        }}
        onExplain={phrase => {
          if (busy) { setError('Stop or finish the current reply before requesting an explanation.'); return }
          void sendAdditional({
            text: `Please explain this Mandarin phrase: ${phrase.text}`, intent: 'explain', preserveDraft: true,
            source: { text: phrase.text, title: 'Mandarin translation', route: `conversation/${thread.id}`, locale: phrase.locale, meaning: phrase.meaning },
          })
        }} />)}
      {thread.mode === 'shadow' && practicePhrase && <PhrasePractice key={JSON.stringify([practicePhrase, thread.practiceInput ?? 'listen-repeat', thread.speechFeedback ?? true, speechSetup?.connection?.revision ?? 'missing'])}
        thread={thread} phrase={practicePhrase} busy={busy || deleting} speechConnection={speechSetup?.connection} connectionLoading={!speechSetup || localSpeechSetup === 'loading'}
        onClose={async () => {
          if (getPlaybackState().activeId === previewPlaybackId) stopBrowserSpeech()
          await selectPracticePhrase(thread.id)
          input.current?.focus()
        }} />}
      {retryUser && !busy && <button className="button secondary" onClick={() => {
        void sendAdditional({ text: retryUser.text, source: retryUser.source, intent: retryUser.intent, preserveDraft: true })
      }}>Retry reply</button>}
      {confirmDelete && <div className="notice" role="alert"><p>Delete this conversation, its drafts, and replies? Your learning progress will not change.</p>
        <div className="button-row"><button className="button secondary" disabled={deleting} onClick={() => {
          setDeleting(true)
          voice.cancel()
          void action(async () => {
            // Confirmed deletion discards the draft even if its last save failed.
            await Promise.allSettled([writes.current])
            await cancelAssistantRun(thread.id)
            await deleteThread(thread.id)
            navigate('conversation')
          }).finally(() => setDeleting(false))
        }}>Delete permanently</button><button className="button secondary" onClick={() => setConfirmDelete(false)}>Keep conversation</button></div>
      </div>}
    </div>
    <div className="assistant-composer">
      {!connection && <p className="notice small">Set up your provider in <a href="#settings">AI connection settings</a> before sending. Your draft is saved locally.</p>}
      {thread.source && <div className="draft-context"><details><summary>Context: {thread.source.title}</summary><blockquote>{thread.source.text}</blockquote>
        {thread.source.meaning && <p className="small">{thread.source.meaning}</p>}</details>
        <button className="icon-button" aria-label="Remove context" title="Remove context" onClick={() => {
          voice.cancel()
          void action(async () => { await writes.current; await saveDraft(thread.id, latestDraft.current, null) })
        }}><X size={16} /></button></div>}
      {thread.mode === 'shadow' && <p className="small muted">Share a thought in English for a Mandarin translation and explanation. Use Practice on the translation when ready.</p>}
      <form onSubmit={event => { event.preventDefault(); void voice.submit() }}>
        <label className="visually-hidden" htmlFor={`draft-${thread.id}`}>Message Assistant</label>
        <textarea id={`draft-${thread.id}`} ref={input} rows={3} value={draft} maxLength={MAX_DRAFT_LENGTH} disabled={deleting} readOnly={!!voice.capture}
          placeholder={thread.mode === 'shadow' ? 'Write a thought to express in Mandarin...' : 'Ask, explore, or practice...'}
          onChange={event => { const value = event.target.value; latestDraft.current = value; setDraft(value); void save(value) }}
          onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
        <div className="composer-controls">
          <div className="assistant-settings-anchor" ref={settings}>
            <button className="icon-button" type="button" aria-label="Assistant settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}><Settings size={20} /></button>
            {settingsOpen && <div className="assistant-settings-popup" aria-label="Assistant settings">
              <label>Mode<select value={thread.mode} onChange={event => { voice.cancel(); const mode = event.target.value === 'shadow' ? 'shadow' : 'conversation'; void action(() => updateThread(thread.id, { mode })) }}>
                <option value="conversation">Conversation</option><option value="shadow">Shadow</option></select></label>
              <label className="toggle"><input type="checkbox" checked={thread.voiceEnabled ?? false} onChange={event => {
                voice.cancel()
                const voiceEnabled = event.target.checked
                void action(() => updateThread(thread.id, { voiceEnabled }))
              }} /> Voice input and replies</label>
              {thread.voiceEnabled && <>
                <label>Voice input language<select value={thread.voiceInputLocale ?? 'en-US'} onChange={event => {
                  voice.cancel()
                  const voiceInputLocale = speechLocaleSchema.parse(event.target.value)
                  void action(() => updateThread(thread.id, { voiceInputLocale }))
                }}><option value="en-US">English</option><option value="zh-Hans">Mandarin</option></select></label>
                <p className="small muted">Your browser may use an online speech service. Transcripts go to the AI tutor only when you send.</p>
                {!voice.supported && <p className="small connection-error" role="status">Voice input is unavailable in this browser. You can still type and hear replies.</p>}
              </>}
              <label>Practice input<select value={thread.practiceInput ?? 'listen-repeat'} onChange={event => {
                const value = event.target.value
                void action(() => updateThread(thread.id, { practiceInput: practiceInputSchema.parse(value) }))
              }}>
                <option value="listen-repeat">Listen and repeat (no recording)</option>
                <option value="spoken-feedback">Listen and record</option>
              </select></label>
              <label className="toggle"><input type="checkbox" checked={thread.speechFeedback ?? true} onChange={event => {
                const speechFeedback = event.target.checked
                void action(() => updateThread(thread.id, { speechFeedback }))
              }} /> Speech feedback</label>
              <p className="small muted">Azure pronunciation scores when configured; otherwise a local transcript comparison.</p>
              <label>Mandarin speech speed<select value={thread.speechRate} onChange={event => {
                const rate = Number(event.target.value)
                void action(() => updateThread(thread.id, { speechRate: speechRateSchema.parse(rate) }))
              }}>{speechRateSchema.options.map(({ value: rate }) => <option key={rate} value={rate}>{rate}x</option>)}</select></label>
              <label className="toggle"><input type="checkbox" checked={thread.romanization} onChange={event => { const romanization = event.target.checked; void action(() => updateThread(thread.id, { romanization })) }} /> Show romanization</label>
              <a className="text-link" href="#settings">Voices, AI and speech connections, and appearance</a>
              <button type="button" className="button secondary" onClick={() => setSettingsOpen(false)}>Close settings</button>
            </div>}
          </div>
          {thread.voiceEnabled && <button className={`icon-button composer-mic${voice.capture ? ' recording' : ''}`} type="button"
            aria-label={voice.capture ? 'Stop recording' : 'Start voice input'} title={voice.capture ? 'Stop recording and review' : `Speak in ${thread.voiceInputLocale === 'zh-Hans' ? 'Mandarin' : 'English'}`}
            disabled={busy || deleting || !voice.supported || (!!voice.capture && voice.capture.phase !== 'listening')}
            onClick={voice.capture ? voice.stop : voice.begin}>
            {voice.capture ? <Square size={18} /> : <Mic size={20} />}
          </button>}
          {(voice.capture || voice.speaking) && <button className="icon-button" type="button" aria-label={voice.capture ? 'Cancel recording' : 'Stop speaking'}
            title={voice.capture ? 'Cancel recording' : 'Stop speaking'} onClick={voice.cancel}><X size={18} /></button>}
          {voiceStatus ? <span className="small muted" role="status">{voiceStatus}</span>
            : saving ? <span className="small muted" role="status">Saving draft...</span> : null}
          {busy ? <button className="button secondary" type="button" onClick={() => {
            sendVersion.current++
            voice.cancel()
            void action(() => cancelAssistantRun(thread.id))
          }}><Square size={16} />Stop reply</button>
            : <button className="button primary composer-send" type="submit" aria-label={voice.capture ? 'Submit' : 'Send'} title={voice.capture ? 'Submit' : 'Send'}
              disabled={(!draft.trim() && voice.capture?.phase !== 'listening') || !connection || deleting || (!!voice.capture && voice.capture.phase !== 'listening')}><Send size={18} /></button>}
        </div>
      </form>
      {error && <div className="composer-error" role="alert"><p>{error}</p>
        {error.startsWith('Draft not saved') && <button className="button secondary" onClick={() => { void save(draft) }}>Retry saving draft</button>}
      </div>}
      {voice.error && <p className="composer-error" role="alert">{voice.error}</p>}
      <p className="composer-footnote">Ctrl+Enter to send. AI can make mistakes. Practice feedback is not sent to the AI tutor.</p>
    </div>
  </section>
}

export function Assistant({ threadId, returnRoute }: { threadId?: string; returnRoute: string }) {
  const result = useLiveQuery(async () => ({ thread: threadId ? await db.assistantThreads.get(threadId) : undefined }), [threadId])
  if (!result) return <p role="status">Loading your conversation...</p>
  if (threadId && !result.thread) return <div className="empty-state"><h1>Conversation not found</h1><p>It may have been deleted or replaced by a backup.</p><a className="button secondary" href="#conversation">All conversations</a></div>
  if (result.thread) return <Conversation key={result.thread.id} thread={result.thread} />
  return <>
    <div className="assistant-mobile-picker"><ConversationList returnRoute={returnRoute} /></div>
    <div className="assistant-desktop-welcome"><MessageCircle size={44} className="accent" /><h1>Your Mandarin, in conversation.</h1>
      <p>Choose a conversation or start a new one. Bring a word from reading, explore your lessons, or try Shadow.</p>
      <p className="small muted">Saved locally. Sent only through your configured AI connection.</p><a className="button secondary" href="#settings">AI connection settings</a>
    </div>
  </>
}
