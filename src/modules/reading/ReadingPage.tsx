import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  BookOpen,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Globe2,
  LoaderCircle,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useActiveProfile } from '../../core/activeProfile'
import { invokeAIOperation } from '../../core/ai/operations'
import { db } from '../../core/database'
import {
  speechLanguage,
  type DocumentChapter,
  type EnglishWordSelection,
  type LanguageProfile,
  type LearningItem,
  type LibraryItem,
  type ReadingProgress,
  type WeaveAnnotation,
} from '../../core/domain'
import { createId, nowIso } from '../../core/ids'
import {
  chaptersFor,
  importFile,
  importUrl,
  splitIntoChapters,
  type ImportedDocument,
} from '../../core/importers'
import { contextAroundSelection } from '../../core/textContext'
import { splitTextForAnalysis } from '../../core/textChunks'
import { SpeechControls } from '../../components/SpeechControls'
import { ModuleFrame } from '../../components/ModuleFrame'
import { WovenText } from '../../components/WovenText'
import {
  analyzeAndWeaveText,
  propagateLearningItemAcrossLibrary,
  removeOverlaps,
  weaveTrackedItemsIntoChapters,
} from '../../techniques/diglotWeave'

export function ReadingPage() {
  const profile = useActiveProfile()
  const library = useLiveQuery(
    () =>
      profile
        ? db.libraryItems
            .where('profileId')
            .equals(profile.id)
            .reverse()
            .sortBy('updatedAt')
        : [],
    [profile?.id],
  )
  const [selectedId, setSelectedId] = useState<string>()
  const [showImport, setShowImport] = useState(false)
  const lastDocumentSetting = useLiveQuery(
    () =>
      profile
        ? db.settings.get(`lastReadingDocument:${profile.id}`)
        : undefined,
    [profile?.id],
  )

  useEffect(() => {
    if (!library?.length) return
    if (selectedId && library.some((item) => item.id === selectedId)) return
    const preferred = library.find(
      (item) => item.id === lastDocumentSetting?.value,
    )
    setSelectedId(preferred?.id ?? library[0].id)
  }, [lastDocumentSetting?.value, library, selectedId])

  const selectDocument = async (documentId: string) => {
    setSelectedId(documentId)
    if (profile) {
      await db.settings.put({
        key: `lastReadingDocument:${profile.id}`,
        value: documentId,
      })
    }
  }

  const selected = library?.find((item) => item.id === selectedId)

  return (
    <ModuleFrame
      storageKey="reading-side-pane"
      mainClassName="reader-pane"
      panel={
        <>
        <div className="module-panel-header">
          <div>
            <p className="eyebrow">{profile?.name}</p>
            <h1>Reading</h1>
          </div>
          <button
            className="icon-button"
            onClick={() => setShowImport((current) => !current)}
            aria-label="Import a text"
          >
            <FilePlus2 />
          </button>
        </div>

        {showImport && profile && (
          <ImportPanel
            profileId={profile.id}
            onImported={(id) => {
              void selectDocument(id)
              setShowImport(false)
            }}
          />
        )}

        <div className="document-list">
          {(library ?? []).map((item) => {
            const chapterCount = chaptersFor(item).length
            return (
              <button
                className={
                  item.id === selectedId
                    ? 'document-item active'
                    : 'document-item'
                }
                onClick={() => void selectDocument(item.id)}
                key={item.id}
              >
                <BookOpen size={17} />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {chapterCount} {chapterCount === 1 ? 'chapter' : 'chapters'} ·{' '}
                    {item.analysisStatus.replace('-', ' ')}
                  </small>
                </span>
              </button>
            )
          })}
        </div>
        </>
      }
    >
        {selected && profile ? (
          <Reader item={selected} profile={profile} />
        ) : (
          <div className="empty-state large">
            <BookOpen size={38} />
            <h2>Your reading shelf is empty</h2>
            <p>Paste text, upload a file or EPUB, or import a CORS-enabled URL.</p>
            <button
              className="primary-button"
              onClick={() => setShowImport(true)}
            >
              Import your first text
            </button>
          </div>
        )}
    </ModuleFrame>
  )
}

function ImportPanel({
  profileId,
  onImported,
}: {
  profileId: string
  onImported: (id: string) => void
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [loadingUrl, setLoadingUrl] = useState(false)

  const saveImported = async (imported: ImportedDocument) => {
    const timestamp = nowIso()
    const chapters = await weaveTrackedItemsIntoChapters(
      profileId,
      imported.chapters,
    )
    const item: LibraryItem = {
      id: createId('document'),
      profileId,
      annotations: [],
      analysisStatus: 'not-analyzed',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...imported,
      chapters,
    }
    await db.libraryItems.add(item)
    onImported(item.id)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !content.trim()) return
    const normalizedTitle = title.trim()
    const chapters = splitIntoChapters(content.trim(), normalizedTitle)
    await saveImported({
      title: normalizedTitle,
      content: chapters.map((chapter) => chapter.content).join('\n\n'),
      sourceType: 'paste',
      chapters,
    })
  }

  return (
    <div className="import-panel">
      <form onSubmit={save} className="form-stack compact">
        <label>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Text
          <textarea
            rows={6}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Paste text. Markdown headings or “Chapter 1” lines create chapters."
          />
        </label>
        <button className="primary-button">Add to library</button>
      </form>
      <div className="import-divider">or</div>
      <label className="file-button full-width">
        <FilePlus2 size={17} /> Upload text, Markdown, or EPUB
        <input
          type="file"
          accept=".txt,.md,.markdown,.epub"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              setError('')
              await saveImported(await importFile(file))
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : 'Import failed.',
              )
            }
          }}
        />
      </label>
      <div className="url-import">
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/article"
        />
        <button
          type="button"
          disabled={loadingUrl}
          onClick={async () => {
            setLoadingUrl(true)
            setError('')
            try {
              await saveImported(await importUrl(url))
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : 'Import failed.',
              )
            } finally {
              setLoadingUrl(false)
            }
          }}
        >
          <Globe2 size={17} /> {loadingUrl ? 'Fetching…' : 'Import URL'}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

function overallStatus(
  chapters: DocumentChapter[],
): LibraryItem['analysisStatus'] {
  if (chapters.some((chapter) => chapter.analysisStatus === 'analyzing')) {
    return 'analyzing'
  }
  if (chapters.some((chapter) => chapter.analysisStatus === 'failed')) {
    return 'failed'
  }
  if (chapters.every((chapter) => chapter.analysisStatus === 'ready')) {
    return 'ready'
  }
  return 'not-analyzed'
}

function currentScrollRatio(): number {
  const maximum = document.documentElement.scrollHeight - window.innerHeight
  return maximum > 0
    ? Math.min(1, Math.max(0, window.scrollY / maximum))
    : 0
}

function Reader({
  item,
  profile,
}: {
  item: LibraryItem
  profile: LanguageProfile
}) {
  const chapters = useMemo(() => chaptersFor(item), [item])
  const firstChapterId = chapters[0]!.id
  const [chapterId, setChapterId] = useState(firstChapterId)
  const [busy, setBusy] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState('')
  const [notice, setNotice] = useState('')
  const [selectionShowRomanization, setSelectionShowRomanization] =
    useState(true)
  const [selectionShowEnglish, setSelectionShowEnglish] = useState(false)
  const progressId = `${profile.id}:${item.id}`
  const scrollSaveTimer = useRef<number>()
  const latestProgress = useRef<ReadingProgress>({
    id: progressId,
    profileId: profile.id,
    documentId: item.id,
    chapterId: firstChapterId,
    scrollRatio: 0,
    updatedAt: nowIso(),
  })
  const validChapterIds = useMemo(
    () => new Set(chapters.map((chapter) => chapter.id)),
    [chapters],
  )
  const bookmarks =
    useLiveQuery(
      () =>
        db.readingBookmarks
          .where('documentId')
          .equals(item.id)
          .sortBy('createdAt'),
      [item.id],
    ) ?? []
  const [lookup, setLookup] = useState<{
    selection: EnglishWordSelection
    loading: boolean
    result?: {
      targetText: string
      romanization: string
      gloss: string
    }
    error?: string
  }>()

  useEffect(() => {
    let active = true
    db.readingProgress.get(progressId).then((progress) => {
      if (!active) return
      const restoredChapter =
        progress && validChapterIds.has(progress.chapterId)
          ? progress.chapterId
          : firstChapterId
      latestProgress.current =
        progress && progress.chapterId === restoredChapter
          ? progress
          : {
              id: progressId,
              profileId: profile.id,
              documentId: item.id,
              chapterId: restoredChapter,
              scrollRatio: 0,
              updatedAt: nowIso(),
            }
      setChapterId(restoredChapter)
      setLookup(undefined)
      window.setTimeout(() => {
        if (!active) return
        const maximum =
          document.documentElement.scrollHeight - window.innerHeight
        window.scrollTo({
          top: maximum * latestProgress.current.scrollRatio,
        })
      }, 50)
    })
    return () => {
      active = false
      window.clearTimeout(scrollSaveTimer.current)
      void db.readingProgress.put({
        ...latestProgress.current,
        scrollRatio: currentScrollRatio(),
        updatedAt: nowIso(),
      })
    }
  }, [
    firstChapterId,
    item.id,
    profile.id,
    progressId,
    validChapterIds,
  ])

  const chapterIndex = Math.max(
    chapters.findIndex((chapter) => chapter.id === chapterId),
    0,
  )
  const chapter = chapters[chapterIndex] ?? chapters[0]!

  useEffect(() => {
    const persist = () => db.readingProgress.put(latestProgress.current)
    const save = () => {
      latestProgress.current = {
        ...latestProgress.current,
        scrollRatio: currentScrollRatio(),
        updatedAt: nowIso(),
      }
      window.clearTimeout(scrollSaveTimer.current)
      scrollSaveTimer.current = window.setTimeout(() => {
        void persist()
      }, 250)
    }
    const saveBeforeUnload = () => {
      void persist()
    }
    window.addEventListener('scroll', save, { passive: true })
    window.addEventListener('beforeunload', saveBeforeUnload)
    return () => {
      window.removeEventListener('scroll', save)
      window.removeEventListener('beforeunload', saveBeforeUnload)
      window.clearTimeout(scrollSaveTimer.current)
    }
  }, [])

  const openChapter = async (nextChapterId: string, ratio = 0) => {
    window.clearTimeout(scrollSaveTimer.current)
    setChapterId(nextChapterId)
    setLookup(undefined)
    latestProgress.current = {
      id: progressId,
      profileId: profile.id,
      documentId: item.id,
      chapterId: nextChapterId,
      scrollRatio: ratio,
      updatedAt: nowIso(),
    }
    await db.readingProgress.put(latestProgress.current)
    window.setTimeout(() => {
      const maximum =
        document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo({ top: maximum * ratio, behavior: 'smooth' })
    }, 30)
  }

  const updateChapter = async (
    chapterPatch: Partial<DocumentChapter>,
  ): Promise<void> => {
    const nextChapters = chapters.map((candidate) =>
      candidate.id === chapter.id
        ? { ...candidate, ...chapterPatch }
        : candidate,
    )
    await db.libraryItems.update(item.id, {
      chapters: nextChapters,
      analysisStatus: overallStatus(nextChapters),
      analysisError: nextChapters.find(
        (candidate) => candidate.analysisStatus === 'failed',
      )?.analysisError,
      updatedAt: nowIso(),
    })
  }

  const analyze = async () => {
    setBusy(true)
    setAnalysisProgress('')
    await updateChapter({
      analysisStatus: 'analyzing',
      analysisError: undefined,
    })
    try {
      const chunks = splitTextForAnalysis(chapter.content)
      const annotations: WeaveAnnotation[] = []
      for (const [index, chunk] of chunks.entries()) {
        setAnalysisProgress(
          chunks.length > 1 ? `Analyzing ${index + 1}/${chunks.length}` : '',
        )
        try {
          const chunkAnnotations = await analyzeAndWeaveText(
            profile,
            chunk.text,
            'reading',
          )
          annotations.push(
            ...chunkAnnotations.map((annotation) => ({
              ...annotation,
              start: annotation.start + chunk.start,
              end: annotation.end + chunk.start,
            })),
          )
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : 'Analysis failed.'
          throw new Error(
            `Chapter length: ${chapter.content.length.toLocaleString()} characters. Failed chunk ${
              index + 1
            }/${chunks.length}: ${chunk.text.length.toLocaleString()} characters. ${detail}`,
          )
        }
      }
      await updateChapter({
        annotations: removeOverlaps(annotations),
        analysisStatus: 'ready',
        analysisError: undefined,
      })
    } catch (error) {
      await updateChapter({
        analysisStatus: 'failed',
        analysisError:
          error instanceof Error ? error.message : 'Analysis failed.',
      })
    } finally {
      setBusy(false)
      setAnalysisProgress('')
    }
  }

  const selectEnglish = async (selection: EnglishWordSelection) => {
    setSelectionShowRomanization(true)
    setSelectionShowEnglish(false)
    setNotice('')
    setLookup({ selection, loading: true })
    try {
      const result = await invokeAIOperation('language.translateSelection', {
        word: selection.text,
        context: contextAroundSelection(chapter.content, selection, 2),
        targetLanguage: profile.targetLanguage,
        romanization: profile.romanization,
      })
      setLookup({ selection, loading: false, result })
    } catch (error) {
      setLookup({
        selection,
        loading: false,
        error: error instanceof Error ? error.message : 'Translation failed.',
      })
    }
  }

  const applySelection = async (trackForFuture: boolean) => {
    if (!lookup?.result) return
    const { selection, result } = lookup
    let learningItem = await db.learningItems
      .where('targetLanguage')
      .equals(profile.targetLanguage)
      .filter(
        (candidate) =>
          candidate.sourceText.toLocaleLowerCase() ===
            selection.text.toLocaleLowerCase() &&
          candidate.targetText === result.targetText,
      )
      .first()

    if (!learningItem) {
      learningItem = {
        id: createId('item'),
        targetLanguage: profile.targetLanguage,
        sourceText: selection.text,
        targetText: result.targetText,
        romanization: result.romanization,
        gloss: result.gloss,
        itemType: 'word',
        createdAt: nowIso(),
      } satisfies LearningItem
      await db.learningItems.add(learningItem)
    }

    const stateId = `${profile.id}:${learningItem.id}`
    const existingState = await db.userItemStates.get(stateId)
    if (trackForFuture && !existingState) {
      const timestamp = nowIso()
      await db.transaction(
        'rw',
        [db.userItemStates, db.evidenceEvents],
        async () => {
          await db.userItemStates.add({
            id: stateId,
            profileId: profile.id,
            itemId: learningItem.id,
            tier: 'learning',
            confidence: 0.15,
            showRomanization: selectionShowRomanization,
            showEnglish: selectionShowEnglish,
            introducedAt: timestamp,
            updatedAt: timestamp,
          })
          await db.evidenceEvents.add({
            id: createId('event'),
            profileId: profile.id,
            itemId: learningItem.id,
            sourceModuleId: 'reading',
            type: 'introduced',
            createdAt: timestamp,
          })
        },
      )
    } else if (trackForFuture && existingState) {
      await db.userItemStates.update(existingState.id, {
        showRomanization: selectionShowRomanization,
        showEnglish: selectionShowEnglish,
        updatedAt: nowIso(),
      })
    }

    if (trackForFuture) {
      const occurrenceCount = await propagateLearningItemAcrossLibrary(
        profile.id,
        learningItem,
        existingState?.tier ?? 'learning',
      )
      setNotice(
        `Added “${selection.text}” to the weave in ${occurrenceCount} ${
          occurrenceCount === 1 ? 'occurrence' : 'occurrences'
        } across your library.`,
      )
      setLookup(undefined)
      return
    }

    const annotation: WeaveAnnotation = {
      id: createId('annotation'),
      itemId: learningItem.id,
      start: selection.start,
      end: selection.end,
      sourceText: selection.text,
      targetText: result.targetText,
      romanization: result.romanization,
      gloss: result.gloss,
      tier: existingState?.tier ?? 'learning',
      showRomanization: selectionShowRomanization,
      showEnglish: selectionShowEnglish,
    }
    await updateChapter({
      annotations: removeOverlaps([...chapter.annotations, annotation]),
      analysisStatus: 'ready',
    })
    setNotice(`Replaced this occurrence of “${selection.text}”.`)
    setLookup(undefined)
  }

  return (
    <article className="reader">
      <header className="reader-header">
        <div>
          <p className="eyebrow">Your library</p>
          <h1>{item.title}</h1>
          <p className="chapter-title">{chapter.title}</p>
        </div>
        <button className="primary-button" disabled={busy} onClick={analyze}>
          {busy ? <LoaderCircle className="spin" /> : <Sparkles />}
          {analysisProgress ||
            (chapter.annotations.length ? 'Refresh chapter' : 'Analyze chapter')}
        </button>
      </header>

      <nav className="chapter-navigation" aria-label="Chapter navigation">
        <button
          className="icon-button"
          disabled={chapterIndex === 0}
          onClick={() => {
            const previous = chapters[chapterIndex - 1]
            if (previous) openChapter(previous.id)
          }}
          aria-label="Previous chapter"
        >
          <ChevronLeft />
        </button>
        <select
          value={chapter.id}
          onChange={(event) => {
            openChapter(event.target.value)
          }}
          aria-label="Select chapter"
        >
          {chapters.map((candidate, index) => (
            <option value={candidate.id} key={candidate.id}>
              {index + 1}. {candidate.title}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          disabled={chapterIndex === chapters.length - 1}
          onClick={() => {
            const next = chapters[chapterIndex + 1]
            if (next) openChapter(next.id)
          }}
          aria-label="Next chapter"
        >
          <ChevronRight />
        </button>
      </nav>

      <div className="bookmark-toolbar">
        <button
          type="button"
          onClick={async () => {
            const ratio = currentScrollRatio()
            await db.readingBookmarks.add({
              id: createId('bookmark'),
              profileId: profile.id,
              documentId: item.id,
              chapterId: chapter.id,
              scrollRatio: ratio,
              label: `${chapter.title} · ${Math.round(ratio * 100)}%`,
              createdAt: nowIso(),
            })
            setNotice('Bookmark saved.')
          }}
        >
          <BookmarkPlus size={16} /> Add bookmark
        </button>
        {bookmarks.length > 0 && (
          <div className="bookmark-list">
            {bookmarks.map((bookmark) => (
              <span className="bookmark-chip" key={bookmark.id}>
                <button
                  type="button"
                  onClick={() =>
                    openChapter(bookmark.chapterId, bookmark.scrollRatio)
                  }
                >
                  {bookmark.label}
                </button>
                <button
                  type="button"
                  aria-label={`Delete bookmark ${bookmark.label}`}
                  onClick={() => db.readingBookmarks.delete(bookmark.id)}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {chapter.analysisError && (
        <div className="error-banner">{chapter.analysisError}</div>
      )}
      {notice && <div className="success-banner">{notice}</div>}
      <p className="reader-hint">
        Select any English word to translate, hear, replace, or add to your
        ongoing weave.
      </p>
      <WovenText
        content={chapter.content}
        annotations={chapter.annotations}
        onSelectEnglish={selectEnglish}
        profileId={profile.id}
        onUpdateDisplay={async (annotation, preferences) => {
          await updateChapter({
            annotations: chapter.annotations.map((candidate) =>
              candidate.id === annotation.id
                ? { ...candidate, ...preferences }
                : candidate,
            ),
          })
        }}
        speechLang={speechLanguage[profile.targetLanguage]}
      />

      {lookup && (
        <div
          className="word-popover selection-popover"
          role="dialog"
          aria-label={`Translation for ${lookup.selection.text}`}
        >
          <button
            className="close-button"
            onClick={() => setLookup(undefined)}
            aria-label="Close translation"
          >
            ×
          </button>
          <div className="selected-english">
            English: {lookup.selection.text}
          </div>
          {lookup.loading && (
            <div className="typing">
              <LoaderCircle className="spin" /> Translating…
            </div>
          )}
          {lookup.error && <p className="error-text">{lookup.error}</p>}
          {lookup.result && (
            <>
              <div className="word-native">{lookup.result.targetText}</div>
              <div className="word-romanization">
                {lookup.result.romanization}
              </div>
              <div className="word-gloss">{lookup.result.gloss}</div>
              <SpeechControls
                text={lookup.result.targetText}
                language={speechLanguage[profile.targetLanguage]}
              />
              <div className="display-preferences">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectionShowRomanization}
                    onChange={(event) =>
                      setSelectionShowRomanization(event.target.checked)
                    }
                  />
                  Show romanization in replacements
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectionShowEnglish}
                    onChange={(event) =>
                      setSelectionShowEnglish(event.target.checked)
                    }
                  />
                  Show English in replacements
                </label>
              </div>
              <div className="word-action-grid">
                <button type="button" onClick={() => applySelection(false)}>
                  Replace here
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => applySelection(true)}
                >
                  Add to weave
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  )
}
