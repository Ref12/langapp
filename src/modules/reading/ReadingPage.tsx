import { useEffect, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  BookOpen,
  FilePlus2,
  Globe2,
  LoaderCircle,
  Sparkles,
} from 'lucide-react'
import { useActiveProfile } from '../../core/activeProfile'
import { db } from '../../core/database'
import type { LibraryItem } from '../../core/domain'
import { createId, nowIso } from '../../core/ids'
import { importFile, importUrl } from '../../core/importers'
import { WovenText } from '../../components/WovenText'
import { analyzeAndWeaveText } from '../../techniques/diglotWeave'

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
    <div className="module-layout">
      <aside className="module-panel">
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
          {(library ?? []).map((item) => (
            <button
              className={item.id === selectedId ? 'document-item active' : 'document-item'}
              onClick={() => setSelectedId(item.id)}
              key={item.id}
            >
              <BookOpen size={17} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.analysisStatus.replace('-', ' ')}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="reader-pane">
        {selected && profile ? (
          <Reader item={selected} profileId={profile.id} />
        ) : (
          <div className="empty-state large">
            <BookOpen size={38} />
            <h2>Your reading shelf is empty</h2>
            <p>Paste text, upload a file or EPUB, or import a CORS-enabled URL.</p>
            <button className="primary-button" onClick={() => setShowImport(true)}>
              Import your first text
            </button>
          </div>
        )}
      </section>
    </div>
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

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !content.trim()) return
    const timestamp = nowIso()
    const item: LibraryItem = {
      id: createId('document'),
      profileId,
      title: title.trim(),
      content: content.trim(),
      sourceType: 'paste',
      annotations: [],
      analysisStatus: 'not-analyzed',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await db.libraryItems.add(item)
    onImported(item.id)
  }

  const saveImported = async (
    imported: Pick<LibraryItem, 'title' | 'content' | 'sourceType'>,
  ) => {
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

  return (
    <div className="import-panel">
      <form onSubmit={save} className="form-stack compact">
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Text
          <textarea
            rows={6}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Paste something you want to read…"
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
              setError(caught instanceof Error ? caught.message : 'Import failed.')
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
              const imported = await importUrl(url)
              await saveImported({ ...imported, sourceType: 'text' })
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Import failed.')
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

function Reader({
  item,
  profileId,
}: {
  item: LibraryItem
  profileId: string
}) {
  const profile = useLiveQuery(() => db.profiles.get(profileId), [profileId])
  const [busy, setBusy] = useState(false)

  const analyze = async () => {
    if (!profile) return
    setBusy(true)
    await db.libraryItems.update(item.id, {
      analysisStatus: 'analyzing',
      analysisError: undefined,
    })
    try {
      const annotations = await analyzeAndWeaveText(
        profile,
        item.content,
        'reading',
      )
      await db.libraryItems.update(item.id, {
        annotations,
        analysisStatus: 'ready',
        analysisError: undefined,
        updatedAt: nowIso(),
      })
    } catch (error) {
      await db.libraryItems.update(item.id, {
        analysisStatus: 'failed',
        analysisError:
          error instanceof Error ? error.message : 'Analysis failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="reader">
      <header className="reader-header">
        <div>
          <p className="eyebrow">Your library</p>
          <h1>{item.title}</h1>
        </div>
        <button
          className="primary-button"
          disabled={busy}
          onClick={analyze}
        >
          {busy ? <LoaderCircle className="spin" /> : <Sparkles />}
          {item.annotations.length ? 'Refresh weave' : 'Analyze & weave'}
        </button>
      </header>
      {item.analysisError && <div className="error-banner">{item.analysisError}</div>}
      {item.annotations.length ? (
        <WovenText content={item.content} annotations={item.annotations} />
      ) : (
        <div className="reading-text">{item.content}</div>
      )}
    </article>
  )
}
