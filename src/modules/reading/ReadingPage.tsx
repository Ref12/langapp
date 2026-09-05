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
  StopCircle,
  Trash2,
} from 'lucide-react'
import { useActiveProfile } from '../../core/activeProfile'
import { invokeAIOperation } from '../../core/ai/operations'
import { db } from '../../core/database'
import {
  speechLanguage,
  type ChapterWordSuggestion,
  type DocumentChapter,
  type EnglishWordSelection,
  type ImmersionBlock,
  type LanguageProfile,
  type LearningItem,
  type LibraryItem,
  type ReadingProgress,
  type WeaveAnnotation,
} from '../../core/domain'
import { createId, localDateKey, nowIso } from '../../core/ids'
import { normalizeImmersionToken } from '../../core/immersion'
import {
  chaptersFor,
  importFile,
  importUrl,
  splitIntoChapters,
  type ImportedDocument,
} from '../../core/importers'
import { contextAroundSelection } from '../../core/textContext'
import { splitTextForAnalysis } from '../../core/textChunks'
import {
  detectProperNames,
  frequentContentWords,
} from '../../core/wordFrequency'
import { ImmersionText } from '../../components/ImmersionText'
import { SpeechControls } from '../../components/SpeechControls'
import { ModuleFrame } from '../../components/ModuleFrame'
import { WovenText } from '../../components/WovenText'
import {
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

async function patchDocumentChapter(
  documentId: string,
  chapterId: string,
  patch: Partial<DocumentChapter>,
): Promise<void> {
  const current = await db.libraryItems.get(documentId)
  if (!current) return
  const chapters = chaptersFor(current).map((chapter) =>
    chapter.id === chapterId ? { ...chapter, ...patch } : chapter,
  )
  await db.libraryItems.update(documentId, {
    chapters,
    updatedAt: nowIso(),
  })
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
  const [readingMode, setReadingMode] = useState<'weave' | 'immersion'>(
    'weave',
  )
  const [immersionProgress, setImmersionProgress] = useState('')
  const immersionController = useRef<AbortController>()
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(
    new Set(),
  )
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
    mode: 'weave',
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
              mode: 'weave',
              updatedAt: nowIso(),
            }
      setReadingMode(latestProgress.current.mode ?? 'weave')
      setChapterId(restoredChapter)
      setLookup(undefined)
      setSelectedSuggestions(new Set())
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
      mode: readingMode,
      updatedAt: nowIso(),
    }
    await db.readingProgress.put(latestProgress.current)
    window.setTimeout(() => {
      const maximum =
        document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo({ top: maximum * ratio, behavior: 'smooth' })
    }, 30)

    const nextChapter = chapters.find(
      (candidate) => candidate.id === nextChapterId,
    )
    if (
      readingMode === 'immersion' &&
      nextChapter &&
      !nextChapter.immersion
    ) {
      void translateImmersionChapter(nextChapter)
    }
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
      )?.analysisError ?? '',
      updatedAt: nowIso(),
    })
  }

  const translateImmersionChapter = async (
    targetChapter: DocumentChapter,
  ) => {
    if (targetChapter.immersion?.status === 'translating') return
    setImmersionProgress('Preparing immersion translation…')
    setNotice('')
    immersionController.current?.abort()
    const controller = new AbortController()
    immersionController.current = controller
    await patchDocumentChapter(item.id, targetChapter.id, {
      immersion: {
        status: 'translating',
        blocks: targetChapter.immersion?.blocks ?? [],
        error: '',
      },
    })

    try {
      const chunks = splitTextForAnalysis(targetChapter.content, 1_500)
      const properNames = new Set(detectProperNames(targetChapter.content))
      const results: Array<ImmersionBlock[] | undefined> = new Array(
        chunks.length,
      )
      let nextChunk = 0
      let completed = 0
      const worker = async () => {
        while (nextChunk < chunks.length) {
          const chunkIndex = nextChunk
          nextChunk += 1
          setImmersionProgress(
            `Translated ${completed}/${chunks.length} · processing chunk ${
              chunkIndex + 1
            }`,
          )
          const translated = await invokeAIOperation(
            'language.translateImmersion',
            {
              text: chunks[chunkIndex].text,
              targetLanguage: profile.targetLanguage,
              romanization: profile.romanization,
              properNames: [...properNames].filter((name) =>
                chunks[chunkIndex].text.includes(name),
              ),
            },
            controller.signal,
          )
          results[chunkIndex] = translated.blocks.map((tokens, blockIndex) => ({
            id: `immersion:${targetChapter.id}:${chunkIndex}:${blockIndex}`,
            tokens: tokens.flatMap((token, tokenIndex) => {
              const normalized = normalizeImmersionToken(
                token,
                properNames,
                `immersion:${targetChapter.id}:${chunkIndex}:${blockIndex}:${tokenIndex}`,
              )
              return normalized ? [normalized] : []
            }),
          }))
          completed += 1
          const partialBlocks = results.flatMap((result) => result ?? [])
          setImmersionProgress(`Translated ${completed}/${chunks.length}`)
          await patchDocumentChapter(item.id, targetChapter.id, {
            immersion: {
              status: 'translating',
              blocks: partialBlocks,
              error: '',
            },
          })
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(3, chunks.length) }, () => worker()),
      )
      const blocks = results.flatMap((result) => result ?? [])

      await patchDocumentChapter(item.id, targetChapter.id, {
        immersion: {
          status: 'ready',
          blocks,
          error: '',
          translatedAt: nowIso(),
        },
      })
      setNotice(
        `Immersion translation completed with ${blocks
          .flatMap((block) => block.tokens)
          .length.toLocaleString()} annotated units.`,
      )
    } catch (error) {
      controller.abort()
      const detail =
        error instanceof Error ? error.message : 'Immersion translation failed.'
      const current = await db.libraryItems.get(item.id)
      const partialBlocks =
        chaptersFor(current ?? item).find(
          (candidate) => candidate.id === targetChapter.id,
        )?.immersion?.blocks ?? []
      await patchDocumentChapter(item.id, targetChapter.id, {
        immersion: {
          status: 'failed',
          blocks: partialBlocks,
          error: `Chapter length: ${targetChapter.content.length.toLocaleString()} characters. ${detail}`,
        },
      })
    } finally {
      immersionController.current = undefined
      setImmersionProgress('')
    }
  }

  const changeReadingMode = async (mode: 'weave' | 'immersion') => {
    setReadingMode(mode)
    setLookup(undefined)
    latestProgress.current = {
      ...latestProgress.current,
      mode,
      updatedAt: nowIso(),
    }
    await db.readingProgress.put(latestProgress.current)
    if (mode === 'immersion' && chapter.immersion?.status !== 'ready') {
      void translateImmersionChapter(chapter)
    }
  }

  const analyze = async () => {
    setBusy(true)
    setAnalysisProgress('Finding frequent words…')
    await updateChapter({
      analysisStatus: 'analyzing',
      analysisError: '',
    })
    try {
      const states = await db.userItemStates
        .where('profileId')
        .equals(profile.id)
        .toArray()
      const trackedItems = (
        await db.learningItems.bulkGet(states.map((state) => state.itemId))
      ).filter((item): item is LearningItem => item !== undefined)
      const frequentWords = frequentContentWords(
        chapter.content,
        25,
        trackedItems.map((item) => item.sourceText),
      )

      if (!frequentWords.length) {
        await updateChapter({
          suggestions: [],
          analysisStatus: 'ready',
          analysisError: '',
        })
        setNotice('No untracked content words were found in this chapter.')
        return
      }

      setAnalysisProgress(`Translating ${frequentWords.length} candidates…`)
      const translated = await invokeAIOperation(
        'language.suggestFrequentItems',
        {
          targetLanguage: profile.targetLanguage,
          romanization: profile.romanization,
          candidates: frequentWords.map((word) => ({
            sourceText: word.sourceText,
            occurrenceCount: word.count,
            context: word.context,
          })),
        },
      )
      const translationBySource = new Map(
        translated.suggestions.map((suggestion) => [
          suggestion.sourceText.toLocaleLowerCase(),
          suggestion,
        ]),
      )
      const suggestions: ChapterWordSuggestion[] = frequentWords.flatMap(
        (word) => {
          const translation = translationBySource.get(
            word.sourceText.toLocaleLowerCase(),
          )
          return translation
            ? [
                {
                  id: `suggestion:${chapter.id}:${word.sourceText.toLocaleLowerCase()}`,
                  sourceText: word.sourceText,
                  targetText: translation.targetText,
                  romanization: translation.romanization,
                  gloss: translation.gloss,
                  occurrenceCount: word.count,
                },
              ]
            : []
        },
      )
      await updateChapter({
        suggestions,
        analysisStatus: 'ready',
        analysisError: '',
      })
      setSelectedSuggestions(new Set())
      setNotice(
        `Found ${suggestions.length} frequent content-word candidates in this ${chapter.content.length.toLocaleString()}-character chapter.`,
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Analysis failed.'
      await updateChapter({
        analysisStatus: 'failed',
        analysisError: `Chapter length: ${chapter.content.length.toLocaleString()} characters. ${detail}`,
      })
    } finally {
      setBusy(false)
      setAnalysisProgress('')
    }
  }

  const addSelectedSuggestions = async () => {
      const suggestions = (chapter.suggestions ?? []).filter((suggestion) =>
        selectedSuggestions.has(suggestion.id),
      )
      if (!suggestions.length) return

      const today = localDateKey()
      const introducedToday = (
        await db.evidenceEvents
          .where('profileId')
          .equals(profile.id)
          .filter(
            (event) =>
              event.type === 'introduced' && event.createdAt.startsWith(today),
          )
          .toArray()
      ).length
      const remaining = Math.max(
        profile.dailyNewItemLimit - introducedToday,
        0,
      )
      if (
        suggestions.length > remaining &&
        !window.confirm(
          `You have ${remaining} new-item slots left today. Add all ${suggestions.length} selected items anyway?`,
        )
      ) {
        return
      }

      const timestamp = nowIso()
      const items: LearningItem[] = []
      for (const suggestion of suggestions) {
        const existing = await db.learningItems
          .where('targetLanguage')
          .equals(profile.targetLanguage)
          .filter(
            (candidate) =>
              candidate.sourceText.toLocaleLowerCase() ===
                suggestion.sourceText.toLocaleLowerCase() &&
              candidate.targetText === suggestion.targetText,
          )
          .first()
        items.push(
          existing ?? {
            id: createId('item'),
            targetLanguage: profile.targetLanguage,
            sourceText: suggestion.sourceText,
            targetText: suggestion.targetText,
            romanization: suggestion.romanization,
            gloss: suggestion.gloss,
            itemType: 'word',
            createdAt: timestamp,
          },
        )
      }

      await db.transaction(
        'rw',
        [db.learningItems, db.userItemStates, db.evidenceEvents],
        async () => {
          await db.learningItems.bulkPut(items)
          for (const itemToAdd of items) {
            const stateId = `${profile.id}:${itemToAdd.id}`
            if (await db.userItemStates.get(stateId)) continue
            await db.userItemStates.add({
              id: stateId,
              profileId: profile.id,
              itemId: itemToAdd.id,
              tier: 'learning',
              confidence: 0.15,
              showRomanization: true,
              showEnglish: false,
              introducedAt: timestamp,
              updatedAt: timestamp,
            })
            await db.evidenceEvents.add({
              id: createId('event'),
              profileId: profile.id,
              itemId: itemToAdd.id,
              sourceModuleId: 'reading',
              type: 'introduced',
              createdAt: timestamp,
            })
          }
        },
      )

      let occurrenceCount = 0
      for (const itemToAdd of items) {
        occurrenceCount += await propagateLearningItemAcrossLibrary(
          profile.id,
          itemToAdd,
          'learning',
        )
      }
      await updateChapter({
        suggestions: (chapter.suggestions ?? []).filter(
          (suggestion) => !selectedSuggestions.has(suggestion.id),
        ),
      })
      setSelectedSuggestions(new Set())
      setNotice(
        `Added ${items.length} ${
          items.length === 1 ? 'item' : 'items'
        } to the weave across ${occurrenceCount.toLocaleString()} library occurrences.`,
      )
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
        <div className="reader-header-actions">
          <div className="mode-toggle" aria-label="Reading mode">
            <button
              type="button"
              className={readingMode === 'weave' ? 'active' : ''}
              onClick={() => void changeReadingMode('weave')}
            >
              Weave
            </button>
            <button
              type="button"
              className={readingMode === 'immersion' ? 'active' : ''}
              onClick={() => void changeReadingMode('immersion')}
            >
              Immersion
            </button>
          </div>
          {readingMode === 'weave' ? (
            <button
              className="primary-button"
              disabled={busy}
              onClick={analyze}
            >
              {busy ? <LoaderCircle className="spin" /> : <Sparkles />}
              {analysisProgress ||
                (chapter.suggestions?.length
                  ? 'Refresh candidates'
                  : 'Analyze chapter')}
            </button>
          ) : (
            <>
              {immersionProgress ||
              chapter.immersion?.status === 'translating' ? (
                <button
                  className="danger-button"
                  onClick={() => immersionController.current?.abort()}
                >
                  <StopCircle size={17} /> Cancel translation
                </button>
              ) : (
                <button
                  className="primary-button"
                  onClick={() => void translateImmersionChapter(chapter)}
                >
                  {chapter.immersion?.status === 'ready'
                    ? 'Refresh translation'
                    : 'Translate chapter'}
                </button>
              )}
            </>
          )}
        </div>
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
      {readingMode === 'immersion' && chapter.immersion?.error && (
        <div className="error-banner">{chapter.immersion.error}</div>
      )}
      {notice && <div className="success-banner">{notice}</div>}
      {readingMode === 'weave' &&
        (chapter.suggestions?.length ?? 0) > 0 && (
        <section className="candidate-panel">
          <div className="candidate-header">
            <div>
              <p className="eyebrow">Chapter candidates</p>
              <h2>Choose words to weave</h2>
              <p>
                Frequent content words are ranked by occurrence count. Nothing
                is added until you select it.
              </p>
            </div>
            <div className="candidate-actions">
              <button
                type="button"
                onClick={() =>
                  setSelectedSuggestions(
                    new Set(
                      (chapter.suggestions ?? []).map(
                        (suggestion) => suggestion.id,
                      ),
                    ),
                  )
                }
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setSelectedSuggestions(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="candidate-grid">
            {(chapter.suggestions ?? []).map((suggestion) => (
              <label className="candidate-card" key={suggestion.id}>
                <input
                  type="checkbox"
                  checked={selectedSuggestions.has(suggestion.id)}
                  onChange={(event) =>
                    setSelectedSuggestions((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(suggestion.id)
                      else next.delete(suggestion.id)
                      return next
                    })
                  }
                />
                <span>
                  <strong>{suggestion.sourceText}</strong>
                  <small>
                    {suggestion.occurrenceCount}{' '}
                    {suggestion.occurrenceCount === 1
                      ? 'occurrence'
                      : 'occurrences'}
                  </small>
                </span>
                <span>
                  <strong>{suggestion.targetText}</strong>
                  <small>{suggestion.romanization}</small>
                </span>
                <span className="candidate-gloss">{suggestion.gloss}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={!selectedSuggestions.size}
            onClick={addSelectedSuggestions}
          >
            Add selected to weave ({selectedSuggestions.size})
          </button>
        </section>
      )}
      {readingMode === 'weave' ? (
        <>
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
        </>
      ) : chapter.immersion?.blocks.length ? (
        <>
          {chapter.immersion.status === 'translating' && (
            <div className="translation-progress">
              <LoaderCircle className="spin" />
              {immersionProgress || 'Translating remaining chunks…'}
            </div>
          )}
          <ImmersionText blocks={chapter.immersion.blocks} profile={profile} />
        </>
      ) : (
        <div className="immersion-empty">
          {chapter.immersion?.status === 'translating' || immersionProgress ? (
            <>
              <LoaderCircle className="spin" />
              <h2>{immersionProgress || 'Translating chapter…'}</h2>
              <p>
                The AI is producing structured target text with romanization
                and English annotations.
              </p>
            </>
          ) : (
            <>
              <h2>Translate this chapter for immersion</h2>
              <p>
                The translation is cached locally after it is generated.
              </p>
              <button
                className="primary-button"
                onClick={() => void translateImmersionChapter(chapter)}
              >
                Translate chapter
              </button>
            </>
          )}
        </div>
      )}

      {readingMode === 'weave' && lookup && (
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
