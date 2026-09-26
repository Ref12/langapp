import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, Square, Trash2 } from 'lucide-react'
import { db } from '../core/database'
import { savePreferences } from '../core/learning'
import { moveBookReading, removeBook } from '../core/library/store'
import { translateBook } from '../core/library/translation'
import { translationText, type BookTranslation, type LibraryBook } from '../core/library/contracts'
import { navigate } from '../core/routing'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { SnippetActions } from '../components/assistant/SnippetActions'
import './reading.css'

function Translation({ translation, pinyin }: { translation: BookTranslation; pinyin: boolean }) {
  const [selected, setSelected] = useState<{ text: string; pinyin: string; meaning: string }>()
  return <>
    <div className="reading-text book-translation" lang="zh-Hans">{translation.blocks.map((block, index) => <p key={index}>{block.map((token, word) => <span key={word}>
      <button type="button" className="reading-token" aria-label={`Word help: ${token.text}`} onClick={() => setSelected(token)}>
        {pinyin && token.pinyin ? <ruby className="mandarin-word">{token.text}<rt aria-hidden="true" data-assistant-exclude>{token.pinyin}</rt></ruby> : token.text}
      </button>{token.trailing}
    </span>)}</p>)}</div>
    {selected && <p className="notice" role="status"><strong lang="zh-Hans">{selected.text}</strong> {selected.pinyin} / {selected.meaning}</p>}
  </>
}

function BookReader({ book, workspace, run, busy }: PageProps & { book: LibraryBook }) {
  const [progress, setProgress] = useState<{ completed: number; total: number }>()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const controller = useRef<AbortController>()
  const mounted = useRef(true)
  const connection = useLiveQuery(() => db.aiConnections.get('assistant'), [])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; controller.current?.abort() }
  }, [])
  const position = book.passage
  const passage = book.passages[position]
  const chapterPositions = book.passages.flatMap((item, index) => item.chapter === passage.chapter ? [index] : [])
  const translated = chapterPositions.filter(index => book.passages[index].translation).length
  const mode = workspace.preferences.readingMode === 'target' ? 'target' : 'source'
  const translating = progress !== undefined
  const locked = busy || translating
  const startTranslation = async (positions: number[]) => {
    if (controller.current) return
    const active = new AbortController()
    controller.current = active
    setProgress({ completed: 0, total: positions.length })
    setError('')
    setMessage('')
    try {
      await translateBook(book.id, positions, active.signal, (completed, total) => {
        if (mounted.current) setProgress({ completed, total })
      })
      if (mounted.current) {
        await savePreferences({ readingMode: 'target' })
        setMessage('Translation saved on this device.')
      }
    } catch (reason) {
      if (mounted.current) {
        if (active.signal.aborted) setMessage('Translation stopped. Completed passages are saved; translate again to resume.')
        else setError(reason instanceof Error ? reason.message : 'Translation could not be completed.')
      }
    } finally {
      if (controller.current === active) controller.current = undefined
      if (mounted.current) setProgress(undefined)
    }
  }
  return <>
    <a className="back-link" href="#library"><ArrowLeft size={16} /> Library</a>
    <PageHeading eyebrow="YOUR LIBRARY" title={book.title} action={<button className="button secondary" disabled={locked} onClick={() => setConfirmDelete(value => !value)}><Trash2 size={16} /> Remove book</button>}>
      {book.author ?? 'Imported book'} / {book.chapters.length} chapters
    </PageHeading>
    {confirmDelete && <div className="notice" role="alert"><p>Remove this book, its reading place, and its saved translations from this profile?</p><div className="button-row">
      <button className="button secondary" disabled={locked} onClick={() => setConfirmDelete(false)}>Keep book</button>
      <button className="button primary" disabled={locked} onClick={() => void run(async () => { await removeBook(book.id); navigate('library') })}>Confirm removal</button>
    </div></div>}
    <div className="reader-toolbar">
      <label className="book-chapters">Chapter<select aria-label="Chapter" value={passage.chapter} disabled={locked} onChange={event => {
        const target = book.passages.findIndex(item => item.chapter === Number(event.target.value))
        void run(() => moveBookReading(book.id, position, target))
      }}>{book.chapters.map((title, index) => <option key={index} value={index}>{index + 1}. {title}</option>)}</select></label>
      <div className="segmented" role="group" aria-label="Reading mode">{(['source', 'target'] as const).map(value => <button key={value} disabled={busy} aria-pressed={mode === value}
        onClick={() => void run(() => savePreferences({ readingMode: value }))}>{value === 'source' ? 'English' : 'Mandarin'}</button>)}</div>
      {mode === 'target' && <label className="toggle"><input type="checkbox" disabled={busy} checked={workspace.preferences.pinyin}
        onChange={event => void run(() => savePreferences({ pinyin: event.target.checked }))} /> Show pinyin</label>}
    </div>
    <section className="panel book-translation-controls" aria-label="Book translation">
      <p>{translated} of {chapterPositions.length} passages translated in this chapter.</p>
      <p className="small muted">Translate sends the selected English passage or chapter, in small parts, to your configured AI provider. Usage may incur charges. Completed translations stay cached; no automatic whole-book requests.</p>
      {!connection && <p><a className="text-link" href="#settings">Configure an AI connection in Settings</a> to translate. English reading works without one.</p>}
      <div className="button-row">
        <button className="button secondary" disabled={locked || !connection || Boolean(passage.translation)} onClick={() => void startTranslation([position])}>
          {passage.translation ? 'Passage translated' : 'Translate passage'}</button>
        <button className="button primary" disabled={locked || !connection || translated === chapterPositions.length} onClick={() => void startTranslation(chapterPositions)}>
          {translated === chapterPositions.length ? 'Chapter translated' : translated ? 'Resume chapter translation' : 'Translate chapter'}</button>
        {translating && <button className="button secondary" onClick={() => controller.current?.abort()}><Square size={16} /> Cancel translation</button>}
      </div>
      {progress && <p role="status">Translating: {progress.completed} of {progress.total} passages saved...</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error} Completed passages remain saved.</p>}
    </section>
    <article className="reading-surface imported-reading">
      <p className="eyebrow">{book.chapters[passage.chapter]} / PASSAGE {chapterPositions.indexOf(position) + 1} OF {chapterPositions.length}</p>
      {mode === 'source' ? <div className="reading-text book-source" lang="en">{passage.source}</div>
        : passage.translation ? <Translation key={position} translation={passage.translation} pinyin={workspace.preferences.pinyin} />
          : <div className="empty-state"><h2>This passage has not been translated yet</h2><p>Choose Translate passage or Translate chapter above, or switch to English to read the original.</p></div>}
      {(mode === 'source' || passage.translation) && <SnippetActions key={`${position}:${mode}`} source={{
        text: mode === 'source' ? passage.source : translationText(passage.translation!),
        title: `${book.title}, passage ${position + 1}`.slice(0, 200), route: `book/${book.id}`, locale: mode === 'source' ? 'en-US' : 'zh-Hans',
      }} />}
      <div className="button-row reader-navigation">
        <button className="button secondary" disabled={locked || position === 0} onClick={() => void run(() => moveBookReading(book.id, position, position - 1))}><ArrowLeft size={16} /> Previous</button>
        <button className="button secondary" disabled={locked || position === book.passages.length - 1} onClick={() => void run(() => moveBookReading(book.id, position, position + 1))}>Next <ArrowRight size={16} /></button>
        <button className="button primary" disabled={locked} onClick={() => void run(() => moveBookReading(book.id, position, Math.min(position + 1, book.passages.length - 1), true))}>
          {position === book.passages.length - 1 ? 'Mark passage read' : 'Read & continue'} <ArrowRight size={16} /></button>
      </div>
      <p className="small muted">{book.completed.length} of {book.passages.length} passages read. Your reading place is saved automatically; only Mark passage read or Read & continue counts as reading.</p>
    </article>
    <p className="page-footnote">Mandarin, pinyin, and word meanings are AI-generated and may contain mistakes. Select a translated word for its contextual meaning. Reading and translating do not change vocabulary proficiency.</p>
  </>
}

export function ImportedReader({ id, ...props }: PageProps & { id: string }) {
  const book = useLiveQuery(async () => await db.libraryBooks.get(id) ?? null, [id])
  if (book === undefined) return <p role="status">Opening your saved book...</p>
  if (!book) return <EmptyState title="This book is not in your library"><p>It may have been removed or belong to another profile.</p><a className="button secondary" href="#library">Return to library</a></EmptyState>
  return <BookReader key={book.id} {...props} book={book} />
}
