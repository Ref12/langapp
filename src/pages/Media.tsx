import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../core/database'
import { navigate } from '../core/routing'
import { EmptyState, PageHeading, type PageProps } from '../components/shared'
import { PracticeSnippet } from '../components/assistant/SnippetActions'
import { Pinyin } from '../components/Pinyin'
import { useCatalog } from '../components/study/useCatalog'
import { currentLine, lineView, nudge, offsetAt, withAnchor, type MediaItem, type MediaLine, type SourceEntry, type SyncAnchor, type WovenToken } from '../core/media/contracts'
import { HELPER_INSTALL_PAGE, normalizeMediaUrl, HelperUnreachable, appUrl, createJob, fetchSync, helperIntentUrl, launcher, parseTranscriptFile, probeHelper, putSync, timing, videoUrl, waitForJob, type JobStatus } from '../core/media/helper'
import { nextInterval, nextLines } from '../core/media/study'
import { lineUnits } from '../core/media/readings'
import { translateMedia } from '../core/media/translation'
import { linkEntries } from '../core/media/entries'
import { sendTrack, trackFiles, type TrackKind } from '../core/media/tracks'
import { studyLines } from '../core/collections/store'
import { removeMedia, saveMedia, saveSync } from '../core/media/store'
import { PhraseKnowledge } from '../components/assistant/PhraseKnowledge'
import { CollectLine } from '../components/collections/CollectLine'
import './media.css'

type Phase = { kind: 'idle' } | { kind: 'working'; message: string; progress?: number } | { kind: 'unreachable'; id: string } | { kind: 'failed'; message: string }

const statusText: Record<JobStatus['state'], string> = { queued: 'Waiting for Medusa...', fetching: 'Medusa is fetching the subtitles...', downloading: 'Medusa is downloading the video...', done: 'Saving...', failed: 'Medusa could not fetch this link.' }

function formatTime(seconds: number): string {
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('This file could not be read.'))
    reader.readAsText(file)
  })
}

function ImportFile({ onError }: { onError: (message: string) => void }) {
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const id = await saveMedia(parseTranscriptFile(await readText(file)))
      navigate(`media/${id}`)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'This file could not be imported.')
    }
  }
  return <label className="button secondary">Import transcript file<input type="file" accept=".json,.media.json,.medusa.json,application/json" hidden onChange={choose} /></label>
}

const JOB_URL_KEY = 'linguaweave-media-job-url:'

/** Follows one helper job until its transcript is saved; reports an unreachable helper so the page can offer the file fallback. */
function useJobFollower(setPhase: (phase: Phase) => void) {
  const abort = useRef<AbortController>()
  useEffect(() => () => abort.current?.abort(), [])
  return useCallback(async (id: string, url?: string) => {
    if (url) { try { sessionStorage.setItem(JOB_URL_KEY + id, url) } catch { /* private mode */ } }
    let resubmitUrl = url
    if (!resubmitUrl) { try { resubmitUrl = sessionStorage.getItem(JOB_URL_KEY + id) ?? undefined } catch { /* private mode */ } }
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setPhase({ kind: 'working', message: statusText.queued })
    try {
      const result = await waitForJob(id, { signal: controller.signal, resubmitUrl, onStatus: status => setPhase({ kind: 'working', message: status.state === 'downloading' ? statusText.downloading : status.message ?? statusText[status.state], progress: status.state === 'downloading' ? status.progress : undefined }) })
      await saveMedia(result, id)
      navigate(`media/${id}`)
    } catch (reason) {
      if (controller.signal.aborted) return
      if (reason instanceof HelperUnreachable) setPhase({ kind: 'unreachable', id })
      else setPhase({ kind: 'failed', message: reason instanceof Error ? reason.message : 'Something went wrong.' })
    }
  }, [setPhase])
}

function PhaseNotice({ phase, retry, onError }: { phase: Phase; retry: (id: string) => void; onError: (message: string) => void }) {
  if (phase.kind === 'working') return <div className="notice" role="status"><p>{phase.message}</p>{phase.progress !== undefined && <progress max={1} value={phase.progress} aria-label="Download progress" />}</div>
  if (phase.kind === 'failed') return <p className="notice error" role="alert">{phase.message}</p>
  if (phase.kind === 'unreachable') return <div className="notice" role="status">
    <p>This page could not reach Medusa. If it finished, use Save subtitles on its screen and import the .media.json file here.</p>
    <div className="button-row"><ImportFile onError={onError} /><button className="button secondary" onClick={() => retry(phase.id)}>Try again</button><a href="#media/install">Install Medusa</a></div>
  </div>
  return null
}

function MediaHome({ busy }: Pick<PageProps, 'busy'>) {
  const items = useLiveQuery(() => db.mediaItems.orderBy('savedAt').reverse().toArray(), [])
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const follow = useJobFollower(setPhase)
  const waitingFor = phase.kind === 'working' || phase.kind === 'unreachable' ? phase : undefined
  const lastLaunched = useRef<string>()
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible' && lastLaunched.current && waitingFor?.kind === 'unreachable') void follow(lastLaunched.current) }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [follow, waitingFor])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const link = url.trim()
    try { new URL(link) } catch { setPhase({ kind: 'failed', message: 'Paste a full link, starting with https://' }); return }
    const id = crypto.randomUUID()
    lastLaunched.current = id
    setPhase({ kind: 'working', message: 'Looking for Medusa...' })
    if (await probeHelper()) {
      try {
        await createJob(id, link)
        await follow(id, link)
      } catch (reason) { setPhase({ kind: 'failed', message: reason instanceof Error ? reason.message : 'Medusa could not start this job.' }) }
      return
    }
    launcher.open(helperIntentUrl(id, link, appUrl(`media/job/${id}`), appUrl('media/install')))
    setPhase({ kind: 'working', message: 'Opening Medusa...' })
    void follow(id, link)
  }
  const saved = useMemo(() => { const key = url.trim() ? normalizeMediaUrl(url) : undefined; return key ? items?.find(item => normalizeMediaUrl(item.url) === key) : undefined }, [items, url])
  const [captureAgain, setCaptureAgain] = useState('')
  const offerSaved = saved && captureAgain !== normalizeMediaUrl(url)
  return <>
    <PageHeading eyebrow="Media" title="Media">Save a video and its subtitles with Medusa, then watch with the lines beside the video.</PageHeading>
    <form className="media-add" onSubmit={submit}>
      <input type="url" inputMode="url" aria-label="Link to a video" placeholder="Paste a video link" value={url} onChange={event => setUrl(event.target.value)} />
      {offerSaved ? <>
        <a className="button primary" href={`#media/${saved.id}`}>Open saved</a>
        <button className="button secondary" type="button" onClick={() => setCaptureAgain(normalizeMediaUrl(url))}>Download again</button>
      </> : <button className="button primary" type="submit" disabled={busy || !url.trim() || phase.kind === 'working'}>Get transcript</button>}
    </form>
    {offerSaved && <p className="small muted" role="status">This video is already saved: {saved.title}</p>}
    <PhaseNotice phase={phase} retry={id => void follow(id)} onError={message => setPhase({ kind: 'failed', message })} />
    <p className="small muted">Needs the Medusa app on this phone. <a href="#media/install">Install it</a> or <span>import a transcript file instead:</span> <ImportFile onError={message => setPhase({ kind: 'failed', message })} /></p>
    <h2>Saved media</h2>
    {items?.length === 0 && <p className="muted">Nothing saved yet.</p>}
    <ul className="media-list">{items?.map(item => <li className="media-item" key={item.id}>
      <div><h3>{item.title}</h3><p className="small muted">{item.source === 'auto-captions' ? 'Auto captions' : item.source === 'asr' ? 'Speech recognition' : 'Captions'} / {item.lines.length} lines / {new Date(item.savedAt).toLocaleDateString()}</p></div>
      <div className="media-item-actions"><a className="button primary" href={`#media/${item.id}`} aria-label={`Open ${item.title}`}>Open</a>
        <button className="button secondary" disabled={busy} aria-label={`Delete ${item.title}`} onClick={() => void removeMedia(item.id)}>Delete</button></div>
    </li>)}</ul>
  </>
}

function MediaInstall() {
  return <>
    <PageHeading eyebrow="Media" title="Install Medusa">A small separate app that saves videos and subtitles for links.</PageHeading>
    <p>Medusa is a separate open-source Android app. It saves a video and its timed subtitles from a link and hands them to LinguaWeave. Everything happens on your phone.</p>
    <ol>
      <li>Download the app from <a href={HELPER_INSTALL_PAGE} target="_blank" rel="noreferrer">the Medusa releases page</a>.</li>
      <li>Allow your browser or file manager to install apps when Android asks.</li>
      <li>Open Medusa once, then come back here.</li>
    </ol>
    <div className="button-row"><a className="button primary" href="#media">Try again</a></div>
  </>
}

function MediaJob({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'working', message: statusText.queued })
  const follow = useJobFollower(setPhase)
  useEffect(() => {
    void follow(id)
    const visible = () => { if (document.visibilityState === 'visible') void follow(id) }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [id, follow])
  return <>
    <PageHeading eyebrow="Media" title="Getting your transcript">Waiting for Medusa to finish.</PageHeading>
    <PhaseNotice phase={phase} retry={retryId => void follow(retryId)} onError={message => setPhase({ kind: 'failed', message })} />
    <p><a href="#media">Back to Media</a></p>
  </>
}

const PAUSE_KEY = 'linguaweave-media-pause-after-line'

/** Where a tapped word can be looked up in the Dictionary (characters, when it is one). */
const dictionaryLink = (text: string) => `#dictionary/${Array.from(text).length === 1 ? 'characters' : 'vocabulary'}/all?q=${encodeURIComponent(text)}`

function Picked({ text, pinyin, meaning, note, context }: { text: string; pinyin?: string; meaning?: string; note?: string; context?: string }) {
  return <p className="notice media-picked" role="status"><strong lang="zh-Hans">{text}</strong>{pinyin && <> <Pinyin text={pinyin} /></>}{meaning ? <> / {meaning}</> : null}{note && <span className="tag"> {note}</span>}{context && context !== meaning && <span className="small muted"> (here: {context})</span>} <a href={dictionaryLink(text)}>Look up in Dictionary</a></p>
}

/** A line with a reading and a tap target on every Han character: catalog words as words, everything else character by character. */
function WordLine({ text, pinyin, lookup, className = 'media-now' }: { className?: string; text: string; pinyin: boolean; lookup: { readings: Map<string, Set<string>>; meanings: Map<string, string> } }) {
  const [selected, setSelected] = useState<{ text: string; pinyin?: string; meaning?: string }>()
  const units = useMemo(() => lineUnits(text, lookup.readings), [text, lookup.readings])
  return <>
    <p className={className} lang="zh-Hans">{units.map((unit, index) => {
      if (!unit.pinyin) return <span key={index} className="media-plain">{unit.text}</span>
      const meaning = lookup.meanings.get(unit.text)
      return <ruby key={index} className="mandarin-word"><button type="button" className="word" onClick={() => setSelected({ text: unit.text, pinyin: unit.pinyin, meaning })}>{unit.text}</button>
        {pinyin && <rt aria-hidden="true" data-assistant-exclude><Pinyin text={unit.pinyin} /></rt>}</ruby>
    })}</p>
    {selected && <Picked {...selected} />}
  </>
}

/** One line from the AI pass: per-word pinyin and (optionally) glosses, with a tap for the contextual meaning. */
type EntryInfo = { ref: string; pinyin: string; meaning: string; source: boolean }

function WovenLine({ tokens, pinyin, glosses, className = 'media-now', entryOf }: { tokens: WovenToken[]; pinyin: boolean; glosses: boolean; className?: string; entryOf?: (text: string) => EntryInfo | undefined }) {
  const [selected, setSelected] = useState<WovenToken>()
  return <>
    <p className={className} lang="zh-Hans">{tokens.map((token, index) => <span key={index} className="woven-token">
      <ruby className="mandarin-word"><button type="button" className="word" onClick={() => setSelected(token)}>{token.text}</button>
        {pinyin && token.pinyin && <rt aria-hidden="true" data-assistant-exclude><Pinyin text={token.pinyin} /></rt>}</ruby>
      {glosses && token.meaning && <span className="woven-gloss" data-assistant-exclude>{token.meaning}</span>}
      {token.trailing}</span>)}</p>
    {selected && (() => {
      // Once pass 2 has run, the tapped word shows its entry (curriculum or from this source); the line's own gloss is the fallback.
      const entry = entryOf?.(selected.text)
      return entry ? <Picked text={selected.text} pinyin={entry.pinyin} meaning={entry.meaning} note={entry.source ? 'From your media' : 'Curriculum'} context={selected.meaning} /> : <Picked text={selected.text} pinyin={selected.pinyin} meaning={selected.meaning} />
    })()}
  </>
}

/** The aligned English for a line; tap to see the whole sentence it belongs to. */
function Fragment({ translation, className = 'media-fragment' }: { translation?: { fragment: string; sentence: string; shared: boolean }; className?: string }) {
  const [open, setOpen] = useState(false)
  if (!translation) return null
  const more = translation.sentence !== translation.fragment
  return <div className={className}>
    <button type="button" className="media-fragment-text" aria-expanded={more ? open : undefined} disabled={!more} onClick={() => setOpen(value => !value)}>{translation.fragment}</button>
    {open && more && <p className="small muted" role="status">{translation.sentence}</p>}
  </div>
}

function Watch({ item, workspace, route }: { item: MediaItem; workspace: PageProps['workspace']; route: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [sync, setSync] = useState<SyncAnchor[]>(item.sync ?? [])
  const syncRef = useRef(sync)
  const [time, setTime] = useState(0)
  const [videoFailed, setVideoFailed] = useState(false)
  const [current, setCurrent] = useState(-1)
  const [pauseAfter, setPauseAfter] = useState(() => localStorage.getItem(PAUSE_KEY) === 'true')
  const pauseRef = useRef(pauseAfter)
  const pausedAt = useRef(-2)
  const currentRow = useRef<HTMLLIElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const [view, setView] = useState<'learn' | 'lines' | 'watch'>('learn')
  const container = useRef<HTMLDivElement>(null)
  const [annotated, setAnnotated] = useState(false)
  const [overlayTranslation, setOverlayTranslation] = useState(false)
  const [glosses, setGlosses] = useState(() => localStorage.getItem('linguaweave-media-glosses') === 'true')
  const [translating, setTranslating] = useState<{ done: number; total: number; model?: string } | undefined>()
  const [translateError, setTranslateError] = useState('')
  const [studyTitle, setStudyTitle] = useState(false)
  const hasChineseTitle = /[\u3400-\u9fff]/.test(item.title)
  const translateAbort = useRef<AbortController>()
  useEffect(() => () => translateAbort.current?.abort(), [])
  const aligned = item.aligned
  const translated = aligned ? aligned.upTo >= item.lines.length : false
  const [linking, setLinking] = useState<{ done: number; total: number; model?: string } | undefined>()
  const [linkError, setLinkError] = useState('')
  const linkAbort = useRef<AbortController>()
  useEffect(() => () => linkAbort.current?.abort(), [])
  const startLink = async () => {
    linkAbort.current?.abort()
    const controller = new AbortController()
    linkAbort.current = controller
    setLinkError('')
    setLinking({ done: 0, total: item.entries?.total ?? 0 })
    let model: string | undefined
    try { await linkEntries(item.id, controller.signal, (done, total) => setLinking({ done, total, model }), { onModel: name => { model = name; setLinking(previous => previous && { ...previous, model }) } }) }
    catch (reason) { if (!controller.signal.aborted) setLinkError(reason instanceof Error ? reason.message : 'Linking the words failed.') }
    finally { setLinking(undefined) }
  }
  const startTranslate = async () => {
    translateAbort.current?.abort()
    const controller = new AbortController()
    translateAbort.current = controller
    setTranslateError('')
    setTranslating({ done: aligned?.upTo ?? 0, total: item.lines.length })
    let model: string | undefined
    let finished = false
    try { await translateMedia(item.id, controller.signal, (done, total) => setTranslating({ done, total, model }), { onModel: name => { model = name; setTranslating(previous => previous && { ...previous, model }) } }); finished = true }
    catch (reason) { if (!controller.signal.aborted) setTranslateError(reason instanceof Error ? reason.message : 'The translation failed.') }
    finally { setTranslating(undefined) }
    // Pass 2 follows pass 1 automatically.
    if (finished && !controller.signal.aborted) await startLink()
  }
  const [trackNote, setTrackNote] = useState('')
  const [trackFallback, setTrackFallback] = useState<TrackKind>()
  const addTrack = async (kind: TrackKind) => {
    setTrackNote(''); setTrackFallback(undefined)
    try {
      const result = await sendTrack(item, kind)
      if (result.ok) setTrackNote(kind === 'translation' ? 'Sent the English track to Medusa.' : 'Sent the pinyin track to Medusa.')
      else { setTrackNote(result.message); if (result.reason !== 'failed') setTrackFallback(kind) }
    } catch (reason) { setTrackNote(reason instanceof Error ? reason.message : 'The track could not be sent.') }
  }
  const saveFiles = (kind: TrackKind) => {
    const files = trackFiles(item, kind)
    for (const file of [files.srt, files.json]) {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([file.text], { type: 'text/plain;charset=utf-8' }))
      link.download = file.name
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    }
  }
  const toggleGlosses = (value: boolean) => { setGlosses(value); localStorage.setItem('linguaweave-media-glosses', String(value)) }
  const [picker, setPicker] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [count, setCount] = useState(5)
  const [studied, setStudied] = useState('')
  const push = useRef<number>()
  const dirtyOnOpen = useRef(item.syncDirty)
  const canWatch = !!item.hasVideo && !!item.videoPath && !videoFailed
  const { catalog } = useCatalog()
  const sourceWords = useLiveQuery(async () => {
    const refs = [...new Set(Object.values(item.entries?.links ?? {}))].filter(ref => ref.startsWith('source:')).map(ref => ref.slice('source:'.length))
    return new Map<string, SourceEntry>((await db.sourceEntries.bulkGet(refs)).flatMap(entry => entry ? [[`source:${entry.id}`, entry] as [string, SourceEntry]] : []))
  }, [item.entries?.updatedAt])
  const entryOf = useCallback((text: string): EntryInfo | undefined => {
    const ref = item.entries?.links[text]
    if (!ref) return undefined
    if (ref.startsWith('source:')) { const entry = sourceWords?.get(ref); return entry && { ref, pinyin: entry.pinyin, meaning: entry.meanings.join('; '), source: true } }
    const unit = catalog?.units.get(ref)
    return unit?.kind === 'vocabulary' ? { ref, pinyin: unit.record.pr, meaning: unit.record.ds, source: false } : undefined
  }, [item.entries, sourceWords, catalog])
  const lookup = useMemo(() => {
    const readings = new Map<string, Set<string>>()
    const meanings = new Map<string, string>()
    for (const unit of catalog?.units.values() ?? []) {
      if (unit.kind !== 'vocabulary') continue
      const set = readings.get(unit.record.ch) ?? new Set<string>()
      set.add(unit.record.pr)
      readings.set(unit.record.ch, set)
      if (!meanings.has(unit.record.ch)) meanings.set(unit.record.ch, unit.record.ds)
    }
    return { readings, meanings }
  }, [catalog])
  const apply = useCallback((next: SyncAnchor[]) => {
    syncRef.current = next
    setSync(next)
    void saveSync(item.id, next, true)
    if (!item.mediaId) return
    window.clearTimeout(push.current)
    push.current = window.setTimeout(() => { void putSync(item.mediaId!, next).then(ok => { if (ok) void saveSync(item.id, next, false) }) }, timing.syncDebounceMs)
  }, [item.id, item.mediaId])
  useEffect(() => () => window.clearTimeout(push.current), [])
  // On open, prefer Medusa's copy unless we have changes it has not seen.
  useEffect(() => {
    if (!item.mediaId) return
    let live = true
    void fetchSync(item.mediaId).then(remote => {
      if (!live || !remote) return
      if (dirtyOnOpen.current) void putSync(item.mediaId!, syncRef.current).then(ok => { if (ok) void saveSync(item.id, syncRef.current, false) })
      else if (JSON.stringify(remote) !== JSON.stringify(syncRef.current)) { syncRef.current = remote; setSync(remote); void saveSync(item.id, remote, false) }
    })
    return () => { live = false }
  }, [item.id, item.mediaId])
  useEffect(() => {
    const element = video.current
    if (!canWatch || !element) return undefined
    const timer = window.setInterval(() => {
      const now = element.currentTime
      setTime(now)
      const index = currentLine(item.lines, now, syncRef.current)
      setCurrent(index)
      if (pauseRef.current && index >= 0 && !element.paused) {
        const end = item.lines[index].end + offsetAt(syncRef.current, item.lines[index].start)
        if (now >= end - 0.05 && pausedAt.current !== index) { pausedAt.current = index; element.pause() }
      }
    }, timing.tickMs)
    return () => window.clearInterval(timer)
  }, [canWatch, item.lines])
  // Follow the current line by moving only the list's own scrollTop; scrollIntoView would also scroll the page and lose the video.
  const followNow = useCallback(() => {
    const box = scroller.current, row = currentRow.current
    if (!box || !row) return
    box.scrollTop = Math.max(0, row.offsetTop - (box.clientHeight - row.offsetHeight) / 2)
  }, [])
  useEffect(() => { if (following && view === 'lines') followNow() }, [current, following, view, followNow])
  useEffect(() => {
    const changed = () => { if (!document.fullscreenElement) setView(value => value === 'watch' ? 'learn' : value) }
    document.addEventListener('fullscreenchange', changed)
    return () => { document.removeEventListener('fullscreenchange', changed); if (document.fullscreenElement) void document.exitFullscreen?.() }
  }, [])
  const enterWatch = () => { setView('watch'); void Promise.resolve(container.current?.requestFullscreen?.()).catch(() => undefined) }
  const exitWatch = () => { setPicker(false); setView('learn'); if (document.fullscreenElement) void document.exitFullscreen?.() }
  const openPicker = () => {
    video.current?.pause()
    const from = Math.max(0, current)
    setPicked(new Set(nextLines(item.lines, from, count)))
    setPicker(true)
  }
  const confirmPicker = async () => {
    const chosen = [...picked].sort((a, b) => a - b).map(index => ({ text: item.lines[index].text, source: { mediaId: item.id, title: item.title, line: index, start: item.lines[index].start, text: item.lines[index].text } }))
    setStudied('')
    try {
      const session = await studyLines(chosen)
      setPicker(false)
      navigate(`lessons/session/${session}`)
    } catch (reason) { setStudied(reason instanceof Error ? reason.message : 'These lines could not be saved.') }
  }
  const togglePicked = (index: number) => setPicked(previous => { const next = new Set(previous); if (next.has(index)) next.delete(index); else next.add(index); return next })
  const stopFollowing = () => setFollowing(false)
  const shifted = (line: MediaLine) => line.start + offsetAt(sync, line.start)
  const seek = (line: MediaLine, index: number) => {
    pausedAt.current = -2
    if (video.current) { video.current.currentTime = Math.max(0, shifted(line)); void video.current.play?.() }
    setCurrent(index)
  }
  const toggle = (value: boolean) => { setPauseAfter(value); pauseRef.current = value; localStorage.setItem(PAUSE_KEY, String(value)) }
  const line = current >= 0 ? item.lines[current] : undefined
  const now = () => video.current?.currentTime ?? time
  const shift = (delta: number) => apply(nudge(sync, now(), (line ?? item.lines[0]).start, delta))
  const syncTo = (entry: MediaLine) => apply(withAnchor(sync, { at: entry.start, offset: Math.round((now() - entry.start) * 100) / 100 }))
  const resetHere = () => { const active = [...sync].reverse().find(entry => entry.at <= now()); if (active) apply(sync.filter(entry => entry !== active)) }
  const viewOf = (index: number) => lineView(aligned, index)
  const lineLearn = (entry: MediaLine, index: number) => <><PhraseKnowledge text={entry.text} label="Add to my knowledge set" /><CollectLine line={{ text: entry.text, source: { mediaId: item.id, title: item.title, line: index, start: entry.start, text: entry.text } }} /></>
  const source = (text: string) => ({ text, locale: 'zh-Hans' as const, title: item.title, route })
  const candidates = item.lines.map((entry, index) => ({ entry, index })).slice(Math.max(0, current), Math.max(0, current) + 120)
  return <>
    <div className="media-watch" ref={container} data-view={view}>
      <div className="media-pin">
        {canWatch
          ? <div className="media-stage">
            <video className="media-video" ref={video} crossOrigin="anonymous" controls playsInline src={videoUrl(item.videoPath!)} onError={() => setVideoFailed(true)} />
            {view === 'watch' && <>
              <div className="media-overlay-bar">
                <button type="button" className="button secondary" onClick={exitWatch}>Exit fullscreen</button>
                <label><input type="checkbox" checked={annotated} onChange={event => setAnnotated(event.target.checked)} /> Annotated subtitles</label>
                {aligned && <label><input type="checkbox" checked={overlayTranslation} onChange={event => setOverlayTranslation(event.target.checked)} /> Translation</label>}
                <button type="button" className="button primary" onClick={openPicker}>Learn</button>
              </div>
              {line && <div className="media-overlay-line">{annotated
                ? (viewOf(current).tokens
                  ? <WovenLine key={current} tokens={viewOf(current).tokens!} pinyin={workspace.preferences.pinyin} glosses={glosses} className="media-overlay-text" entryOf={entryOf} />
                  : <WordLine key={current} text={line.text} pinyin={workspace.preferences.pinyin} lookup={lookup} className="media-overlay-text" />)
                : <p className="media-overlay-text" lang="zh-Hans">{line.text}</p>}
                {overlayTranslation && viewOf(current).translation && <p className="media-overlay-text media-overlay-second">{viewOf(current).translation!.fragment}</p>}</div>}
              {picker && <div className="media-picker" role="dialog" aria-label="Choose lines to study">
                <div className="media-controls">
                  <button type="button" className="button secondary" onClick={() => setPicked(new Set(nextInterval(item.lines, now(), 120)))}>Next 2 minutes</button>
                  <label>Next <input type="number" min={1} max={200} value={count} aria-label="Number of lines" onChange={event => setCount(Math.max(1, Number(event.target.value) || 1))} /> lines</label>
                  <button type="button" className="button secondary" onClick={() => setPicked(new Set(nextLines(item.lines, Math.max(0, current), count)))}>Pick {count}</button>
                </div>
                <ul className="media-picker-list">{candidates.map(({ entry, index }) => <li key={index}><label><input type="checkbox" checked={picked.has(index)} onChange={() => togglePicked(index)} /> <span lang="zh-Hans">{entry.text}</span>{viewOf(index).translation && <span className="small muted"> / {viewOf(index).translation!.fragment}</span>}</label></li>)}</ul>
                <div className="media-controls">
                  <button type="button" className="button primary" disabled={picked.size === 0} onClick={() => void confirmPicker()}>Study {picked.size} line{picked.size === 1 ? '' : 's'}</button>
                  <button type="button" className="button secondary" onClick={() => setPicker(false)}>Cancel</button>
                </div>
              </div>}
            </>}
          </div>
          : <div className="notice" role="status">
            <p>{item.hasVideo ? 'Open Medusa to watch this video.' : 'This one has no video here; read the transcript below.'}</p>
            {item.hasVideo && <div className="button-row"><button className="button secondary" onClick={() => setVideoFailed(false)}>Try again</button><a href="#media/install">Install Medusa</a></div>}
            <p><a href={item.url} target="_blank" rel="noreferrer">Open the original</a></p>
          </div>}
      </div>
      {studied && <p className="notice" role="status">{studied}</p>}
      <h1 className="media-title" lang={/[\u3400-\u9fff]/.test(item.title) ? 'zh-Hans' : undefined}>{item.title}</h1>
      <p className="small muted media-title-meta">{item.lines.length} lines / <a href="#media">All media</a>{hasChineseTitle && <> / <button type="button" className="link-button" aria-expanded={studyTitle} onClick={() => setStudyTitle(value => !value)}>Study the title</button></>}</p>
      {hasChineseTitle && studyTitle && <div className="media-title-teach">
        <WordLine text={item.title} pinyin={workspace.preferences.pinyin} lookup={lookup} className="media-title-line" />
        <PracticeSnippet source={source(item.title)} />
      </div>}
      {canWatch && <div className="media-views" role="group" aria-label="Watch view">
        <button type="button" aria-pressed={view === 'learn'} onClick={() => setView('learn')}>Learning</button>
        <button type="button" aria-pressed={view === 'lines'} onClick={() => setView('lines')}>Lines</button>
        <button type="button" aria-pressed={view === 'watch'} onClick={enterWatch}>Fullscreen</button>
      </div>}
      <div className="media-toolbar">
        {translating
          ? <><progress max={translating.total} value={translating.done} aria-label="Translation progress" /><span className="small muted">Translating {translating.done} of {translating.total} lines{translating.model ? ` with ${translating.model}` : ''}...</span>
            <button type="button" className="button secondary" onClick={() => translateAbort.current?.abort()}>Cancel</button></>
          : translated
            ? <><span className="small muted">AI translation ready.</span>
              {linking
                ? <><progress max={Math.max(linking.total, 1)} value={linking.done} aria-label="Word linking progress" /><span className="small muted">Linking words {linking.done} of {linking.total}{linking.model ? ` with ${linking.model}` : ''}...</span>
                  <button type="button" className="button secondary" onClick={() => linkAbort.current?.abort()}>Cancel</button></>
                : item.entries?.complete
                  ? <span className="small muted">{item.entries.total} words linked.</span>
                  : <button type="button" className="button secondary" onClick={() => void startLink()}>{linkError ? 'Retry linking words' : item.entries ? 'Continue linking words' : 'Link words'}</button>}
              {linkError && <span className="notice error" role="alert">{linkError}</span>}
              <details className="media-menu"><summary className="button secondary" aria-label="More translation actions">...</summary><div className="media-menu-items">
                {item.mediaId && <><button type="button" className="button secondary" onClick={() => void addTrack('translation')}>Add translation to Medusa</button>
                  <button type="button" className="button secondary" onClick={() => void addTrack('pinyin')}>Add pinyin to Medusa</button></>}
                {(trackFallback || !item.mediaId) && <button type="button" className="button secondary" onClick={() => saveFiles(trackFallback ?? 'translation')}>Save as subtitle file</button>}
              </div></details></>
            : <button type="button" className="button secondary" onClick={() => void startTranslate()}>{translateError ? 'Retry translating' : aligned?.upTo ? `Continue translating (${aligned.upTo} of ${item.lines.length} done)` : 'Translate with AI'}</button>}
        {translateError && <p className="notice error" role="alert">{translateError}</p>}
        {trackNote && <p className="small muted" role="status">{trackNote}</p>}
      </div>
      {canWatch && <div className="media-footer" hidden={view === 'watch'}>
        {viewOf(current).tokens
          ? <WovenLine key={current} tokens={viewOf(current).tokens!} pinyin={workspace.preferences.pinyin} glosses={glosses} entryOf={entryOf} />
          : <WordLine key={current} text={line?.text ?? ''} pinyin={workspace.preferences.pinyin} lookup={lookup} />}
        <Fragment key={`f${current}`} translation={viewOf(current).translation} />
        {aligned && <label className="small"><input type="checkbox" checked={glosses} onChange={event => toggleGlosses(event.target.checked)} /> Word meanings</label>}
        {line && <PracticeSnippet source={source(line.text)} learn={lineLearn(line, current)} />}
        <div className="media-controls media-controls-row" role="group" aria-label="Playback and subtitle sync">
          <button className="button secondary" disabled={!line} onClick={() => line && seek(line, current)}>Replay</button>
          <label className="small"><input type="checkbox" checked={pauseAfter} onChange={event => toggle(event.target.checked)} /> Pause after each line</label>
          <button className="button secondary" onClick={() => shift(-0.25)}>Earlier</button>
          <button className="button secondary" onClick={() => shift(0.25)}>Later</button>
          <details className="media-menu"><summary className="button secondary" aria-label="More sync options">Reset</summary><div className="media-menu-items">
            <button className="button secondary" onClick={resetHere}>Reset here</button>
            <button className="button secondary" onClick={() => apply([])}>Reset all</button></div></details>
          <span className="small muted">{offsetAt(sync, now()) >= 0 ? '+' : ''}{offsetAt(sync, now()).toFixed(2)} s</span>
        </div>
      </div>}
      <div className="media-list-panel" hidden={canWatch && view !== 'lines'}>
        {!following && canWatch && <div className="media-list-bar"><button type="button" className="button secondary" onClick={() => { setFollowing(true); followNow() }}>Back to current line</button></div>}
        <div className="media-lines-scroll" ref={scroller} data-testid="media-lines-scroll" onWheel={stopFollowing} onTouchMove={stopFollowing} onKeyDown={stopFollowing}>
          <ol className="media-lines">{item.lines.map((entry, index) => <li key={index} className="media-line" aria-current={index === current ? 'true' : undefined} ref={index === current ? currentRow : undefined}>
            <button type="button" className="media-line-seek" disabled={!canWatch} onClick={() => seek(entry, index)} aria-label={`Play from ${formatTime(shifted(entry))}`}>
              <span className="media-line-time">{formatTime(shifted(entry))}</span><span className="media-line-text"><span lang="zh-Hans">{entry.text}</span>{viewOf(index).translation && <span className="media-line-fragment small muted">{viewOf(index).translation!.fragment}</span>}</span></button>
            {canWatch && <button type="button" className="button secondary" onClick={() => syncTo(entry)}>Sync to this line</button>}
            <PracticeSnippet source={source(entry.text)} learn={lineLearn(entry, index)} />
          </li>)}</ol>
        </div>
      </div>
    </div>
  </>
}

export function Media({ workspace, busy, route }: PageProps & { route: string }) {
  const [, id, jobId] = route.split('?')[0].split('/')
  const item = useLiveQuery(async () => id && id !== 'install' && id !== 'job' ? (await db.mediaItems.get(id)) ?? null : null, [id])
  if (!id) return <MediaHome busy={busy} />
  if (id === 'install') return <MediaInstall />
  if (id === 'job' && jobId) return <MediaJob id={jobId} />
  if (item === undefined) return <p role="status">Opening...</p>
  if (!item) return <EmptyState title="This media is not saved"><p>It may have been deleted from this workspace.</p><a className="button primary" href="#media">Back to Media</a></EmptyState>
  return <Watch key={item.id} item={item} workspace={workspace} route={route} />
}
