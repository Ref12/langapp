import { useEffect, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Globe2,
  LoaderCircle,
  Sparkles,
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
import { SpeechControls } from '../../components/SpeechControls'
import { ModuleFrame } from '../../components/ModuleFrame'
import { WovenText } from '../../components/WovenText'
import {
  analyzeAndWeaveText,
  removeOverlaps,
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

  useEffect(() => {
    if (!selectedId && library?.[0]) setSelectedId(library[0].id)
  }, [library, selectedId])

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
              setSelectedId(id)
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
                onClick={() => setSelectedId(item.id)}
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
    const item: LibraryItem = {
      id: createId('document'),
      profileId,
      annotations: [],
      analysisStatus: 'not-analyzed',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...imported,
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

function Reader({
  item,
  profile,
}: {
  item: LibraryItem
  profile: LanguageProfile
}) {
  const chapters = chaptersFor(item)
  const firstChapterId = chapters[0]?.id
  const [chapterId, setChapterId] = useState(firstChapterId)
  const [busy, setBusy] = useState(false)
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
    setChapterId(firstChapterId)
    setLookup(undefined)
  }, [item.id, firstChapterId])

  const chapterIndex = Math.max(
    chapters.findIndex((chapter) => chapter.id === chapterId),
    0,
  )
  const chapter = chapters[chapterIndex]
  if (!chapter) return null

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
    await updateChapter({
      analysisStatus: 'analyzing',
      analysisError: undefined,
    })
    try {
      const annotations = await analyzeAndWeaveText(
        profile,
        chapter.content,
        'reading',
      )
      await updateChapter({
        annotations,
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
    }
  }

  const selectEnglish = async (selection: EnglishWordSelection) => {
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
    }
    await updateChapter({
      annotations: removeOverlaps([...chapter.annotations, annotation]),
      analysisStatus: 'ready',
    })
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
          {chapter.annotations.length ? 'Refresh chapter' : 'Analyze chapter'}
        </button>
      </header>

      <nav className="chapter-navigation" aria-label="Chapter navigation">
        <button
          className="icon-button"
          disabled={chapterIndex === 0}
          onClick={() => setChapterId(chapters[chapterIndex - 1]?.id)}
          aria-label="Previous chapter"
        >
          <ChevronLeft />
        </button>
        <select
          value={chapter.id}
          onChange={(event) => {
            setChapterId(event.target.value)
            setLookup(undefined)
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
          onClick={() => setChapterId(chapters[chapterIndex + 1]?.id)}
          aria-label="Next chapter"
        >
          <ChevronRight />
        </button>
      </nav>

      {chapter.analysisError && (
        <div className="error-banner">{chapter.analysisError}</div>
      )}
      <p className="reader-hint">
        Select any English word to translate, hear, replace, or add to your
        ongoing weave.
      </p>
      <WovenText
        content={chapter.content}
        annotations={chapter.annotations}
        onSelectEnglish={selectEnglish}
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
