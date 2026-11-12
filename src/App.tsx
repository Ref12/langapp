import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, BookText, Clapperboard, Dumbbell, Gamepad2, History as HistoryIcon, Home, Layers, LibraryBig, MessageCircle, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { initializeWorkspace, loadWorkspace } from './core/database'
import { requestPersistence } from './core/backup/service'
import { removeBackgroundBackupRegistrations } from './core/backup/cleanup'
import { recordStartup, timePhase } from './core/backup/diagnostics'
import { savePreferences } from './core/learning'
import { redirect, useRoute } from './core/routing'
import { lessons, stories } from './data/mandarin'
import { curriculumLevels } from './data/curriculum'
import { EmptyState, type PageProps } from './components/shared'
import { PageSettingsButton, PageSettingsProvider } from './components/PageSettings'
import { PageActionsMenu, PageActionsProvider } from './components/PageActionsMenu'
import { PageDockContext } from './components/PageDock'
import { MobileNavigation } from './components/MobileNavigation'
import { Overview } from './pages/Overview'
import { Library, Reader } from './pages/Reading'
import { ImportedReader } from './pages/ImportedReader'
import { LessonDetail, Lessons } from './pages/Lessons'
import { Study, StudySessionPage } from './pages/Study'
import { Practice, PracticeSessionPage } from './pages/Practice'
import { Mahjong } from './pages/Mahjong'
import { Games } from './pages/Games'
import { Sudoku } from './pages/Sudoku'
import { Memory } from './pages/Memory'
import { Defender } from './pages/Defender'
import { Potions } from './pages/Potions'
import { Dictionary } from './pages/Dictionary'
import { LessonsList } from './pages/LessonsList'
import { Writing } from './pages/Writing'
import { WritingPreview } from './pages/WritingPreview'
import { WritingSheetHost } from './components/WritingSheet'
import { Settings } from './pages/Settings'
import { LevelDetail } from './pages/Curriculum'
import { Assistant, AssistantSidebar } from './pages/Assistant'
import { History } from './pages/History'
import { Media } from './pages/Media'
import { Collections } from './pages/Collections'
import { Drills } from './pages/drills/Drills'
import { DRILLS_LABEL } from './core/drills/contracts'
import { TERM } from './core/collections/terms'
import { PlaybackStatus, SelectionActions } from './components/assistant/SnippetActions'
import { DraftStatus } from './components/assistant/DraftStatus'
import { LocalAIConnectionSetup } from './components/assistant/LocalAIConnectionSetup'
import { setDefaultSpeechRate, setSpeechVoicePreferences, stopBrowserSpeech } from './core/assistant/speech'
import { interruptAudio } from './core/assistant/audio-owner'
import { getActiveProfile, initializeProfiles, markLocalSettingsImported, needsLocalSettingsImport, resetSelectedProfile } from './core/profiles/store'
import { bootstrapDefaultProfile } from './core/profiles/bootstrap'
import { BuildSwitch, LabMark } from './components/BuildSwitch'
import { StableCopyDialog } from './components/StableCopyDialog'
import { markCleanupNoticed, removeForeignLanguageRows, unseenCleanupCount } from './core/profiles/language-cleanup'
import { labProfileIsEmpty } from './core/profiles/stable-import'
import { buildChannel, buildLanguage, storageNames } from './core/storage-names'
import { areaOfRoute, buildDisplayName, getPack, isAreaOn, type Area } from './core/language'
import { PinyinFormatContext, ReadingSettingsContext } from './components/pinyin-context'
import { DEFAULT_PINYIN_FORMAT } from './core/pinyin'
import { BackupNow } from './components/BackupNow'
import { useBackupBoundaries } from './components/useBackupBoundaries'
import { SetupLinkStatus } from './components/SetupQr'
import './App.css'
import './components/assistant/assistant.css'
import { UpdateBar } from './components/UpdateBar'
import { GroupDetail } from './pages/GroupDetail'
import { DisplaySettingsProvider } from './components/display-context'
import { resolveDisplaySettings } from './components/display-settings'
import { AppSwitch } from './components/AppSwitch'
import { appHref, appSwitchShown, labApps } from './core/language/apps'
import { ToneColourProvider } from './components/ToneText'
import { applyToneColours } from './core/tone-colour'

/** The navigation of the app; an entry with an area is shown only where the build's language pack has that area on. */
const navigation: { id: string; label: string; icon: typeof Home; area?: Area }[] = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'lessons', label: 'Lessons', icon: BookOpen },
  { id: 'practice', label: DRILLS_LABEL, icon: Dumbbell },
  { id: 'library', label: 'Library', icon: LibraryBig, area: 'library' },
  { id: 'media', label: 'Media', icon: Clapperboard, area: 'media' },
  { id: 'collections', label: TERM.Plural, icon: Layers, area: 'collections' },
  { id: 'games', label: 'Games', icon: Gamepad2, area: 'games' },
  { id: 'conversation', label: 'Assistant', icon: MessageCircle, area: 'assistant' },
  { id: 'history', label: 'History', icon: HistoryIcon, area: 'history' },
  { id: 'dictionary', label: 'Dictionary', icon: BookText, area: 'dictionary' },
]

/** What a switched-off area shows: one plain line. */
function NotAvailable() {
  return <div className="empty-state"><p>{`Not available in the ${getPack().name} app yet.`}</p></div>
}

function NotFound() {
  return <EmptyState title="This page is not available"><p>The story, lesson, or saved session may no longer be in this workspace.</p><a className="button primary" href="#overview">Return to overview</a></EmptyState>
}

function CurrentPage({ route, returnRoute, assistantHeader, ...props }: PageProps & { route: string; returnRoute: string; assistantHeader: HTMLElement | null }) {
  const [routePath, ...queryParts] = route.split('?')
  const [page, id, lessonPage] = routePath.split('/')
  if (!isAreaOn(getPack(), areaOfRoute(routePath))) return <NotAvailable />
  if (page === 'overview') return <Overview {...props} />
  if (page === 'library') return <Library {...props} />
  if (page === 'book' && id) return <ImportedReader {...props} id={id} />
  if (page === 'reader') {
    const story = stories.find(item => item.id === (id ?? stories[0].id))
    return story ? <Reader key={story.id} {...props} story={story} /> : <NotFound />
  }
  if (page === 'lessons' && id === 'session' && lessonPage) {
    const session = props.workspace.exerciseSessions.find(item => item.id === lessonPage)
    return session ? <StudySessionPage {...props} session={session} /> : <NotFound />
  }
  // The old Japanese and Korean lesson screens are gone (the Japanese app is its own build); their old links are not found.
  if (page === 'lessons' && (id === 'ja' || id === 'ko')) return <NotFound />
  if (page === 'lessons' && id === 'group' && lessonPage) return <GroupDetail {...props} id={lessonPage} />
  if (page === 'lessons' && id === 'list') return <LessonsList {...props} />
  if (page === 'lessons') return <Study {...props} />
  if (page === 'curriculum') return <Lessons {...props} />
  if (page === 'level') {
    const level = curriculumLevels.find(item => item.id === id)
    return level ? <LevelDetail {...props} level={level} /> : <NotFound />
  }
  if (page === 'lesson') {
    const lesson = lessons.find(item => item.id === id)
    return lesson ? <LessonDetail {...props} lesson={lesson} page={lessonPage} /> : <NotFound />
  }
  if (page === 'practice' && id === 'mahjong') return <Mahjong {...props} />
  if (page === 'games' && id === 'mahjong') return <Mahjong {...props} />
  if (page === 'games' && id === 'sudoku') return <Sudoku {...props} />
  if (page === 'games' && id === 'memory') return <Memory {...props} />
  if (page === 'games' && id === 'defender') return <Defender {...props} />
  if (page === 'games' && id === 'potions') return <Potions {...props} />
  if (page === 'games' && !id) return <Games />
  // Hands-free is an activity of a practice set now. Old links (#practice/handsfree/<run id>) land on the migrated set's Hands-free activity.
  if (page === 'practice' && id === 'handsfree') return <Redirect to={lessonPage ? `practice/set/${lessonPage}/handsfree` : 'practice'} />
  if (page === 'practice' && (!id || id === 'set')) return <Drills {...props} route={route} />
  if (page === 'practice' && id) {
    const session = props.workspace.sessions.find(item => item.id === id)
    return session ? <PracticeSessionPage {...props} session={session} /> : <NotFound />
  }
  if (page === 'review') return <Practice {...props} />
  if (page === 'dictionary') return <Dictionary {...props} section={id} initialScope={lessonPage} initialQuery={new URLSearchParams(queryParts.join('?')).get('q') ?? undefined} initialWrite={new URLSearchParams(queryParts.join('?')).get('write') ?? undefined} />
  if (import.meta.env.DEV && page === 'devwriting') return <WritingPreview query={queryParts.join('?')} />
  if (page === 'writing') return <Writing {...props} codepoint={id} scope={lessonPage} query={queryParts.join('?')} />
  if (page === 'settings') return <Settings {...props} />
  if (page === 'media') return <Media {...props} route={routePath} />
  if (page === 'collections') return <Collections {...props} route={routePath} />
  if (page === 'history') return <History />
  if (page === 'conversation') return <Assistant threadId={id} returnRoute={returnRoute} headerTarget={assistantHeader} />
  return <NotFound />
}

function WorkspaceApp() {
  const profile = getActiveProfile()
  const workspace = useLiveQuery(loadWorkspace, [])
  // Copy profile from Stable: from the build switch's menu, or offered once up front on an empty Lab profile.
  const [copyDialog, setCopyDialog] = useState<'menu' | 'offer' | undefined>()
  const copyItems = useMemo(() => storageNames().stableCopy ? [{ label: storageNames().stableCopy === 'profile' ? 'Copy profile from Stable…' : 'Copy settings from Stable…', onSelect: () => setCopyDialog('menu') }] : [], [])
  useEffect(() => {
    if (buildChannel() !== 'lab' || storageNames().stableCopy !== 'profile') return undefined
    let live = true
    try { if (localStorage.getItem(storageNames().labOnly.copyOfferDeclined)) return undefined } catch { /* no storage */ }
    void labProfileIsEmpty().then(empty => { if (live && empty) setCopyDialog('offer') }, () => undefined)
    return () => { live = false }
  }, [])
  const [removedCount, setRemovedCount] = useState(0)
  useEffect(() => { void unseenCleanupCount().then(setRemovedCount, () => undefined) }, [])
  const route = useRoute()
  const [pending, setPending] = useState(0)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)
  const [assistantHeader, setAssistantHeader] = useState<HTMLDivElement | null>(null)
  const [dock, setDock] = useState<HTMLDivElement | null>(null)
  const main = useRef<HTMLElement>(null)
  const returnRoute = useRef('overview')
  const run = useCallback(async (operation: () => Promise<void>) => {
    setPending(value => value + 1)
    setError('')
    try {
      await operation()
    } catch (reason) {
      setError(`Unable to complete this action. ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setPending(value => value - 1)
    }
  }, [])
  const page = route.split('/')[0]
  const assistant = page === 'conversation'
  const section = route === 'practice/mahjong' ? 'games' : page === 'reader' || page === 'book' ? 'library' : ['lesson', 'level', 'curriculum'].includes(page) ? 'lessons' : page === 'review' || page === 'practice' ? 'practice' : page === 'writing' ? (isAreaOn(getPack(), 'dictionary') ? 'dictionary' : 'practice') : page
  const label = page === 'writing' ? 'Writing' : navigation.find(item => item.id === section)?.label ?? (page === 'settings' ? 'Settings' : 'Overview')
  const sourceTitle = page === 'reader' ? stories.find(story => story.id === route.split('/')[1])?.title
    : page === 'lesson' ? lessons.find(lesson => lesson.id === route.split('/')[1])?.title : undefined
  useEffect(() => {
    if (!assistant) returnRoute.current = route
    try { interruptAudio() } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Audio could not be stopped. Close this page before trying again.')
    }
    stopBrowserSpeech()
    document.title = `${label} / ${buildChannel() === 'lab' && getPack().id !== 'zh' ? buildDisplayName('lab', getPack()) : 'LinguaWeave'}`
    main.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [route, label, assistant])
  useEffect(() => {
    if (!assistant || !window.visualViewport) return
    const viewport = window.visualViewport
    const resize = () => document.documentElement.style.setProperty('--assistant-viewport-height', `${viewport.height}px`)
    resize()
    viewport.addEventListener('resize', resize)
    return () => {
      viewport.removeEventListener('resize', resize)
      document.documentElement.style.removeProperty('--assistant-viewport-height')
    }
  }, [assistant])
  useEffect(() => {
    if (workspace) document.documentElement.dataset.theme = workspace.preferences.theme
  }, [workspace])
  useEffect(() => {
    if (workspace) applyToneColours(document.documentElement, workspace.preferences, workspace.preferences.theme)
  }, [workspace])
  useEffect(() => {
    setSpeechVoicePreferences(workspace?.preferences.speechVoices)
  }, [workspace?.preferences.speechVoices])
  useEffect(() => {
    setDefaultSpeechRate(workspace?.preferences.defaultSpeechRate)
    return () => setDefaultSpeechRate()
  }, [workspace?.preferences.defaultSpeechRate])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const practicingNow = workspace !== undefined && ((page === 'practice' && workspace.sessions.some(session => session.id === route.split('/')[1] && session.status === 'active'))
    || (page === 'lessons' && workspace.exerciseSessions.some(session => session.id === route.split('/')[2] && session.status === 'active')))
  useBackupBoundaries(route, practicingNow)
  if (!workspace) return <div className="opening-workspace" role="status">Opening your saved workspace...</div>
  const { preferences } = workspace
  const displaySettings = resolveDisplaySettings(preferences)
  const collapsed = preferences.sidebarCollapsed
  const due = workspace.words.filter(word => word.dueAt <= now).length
  const busy = pending > 0
  const currentPage = <CurrentPage key={route.replace(/^(history)\?.*$/, '$1')} route={route} returnRoute={returnRoute.current} assistantHeader={assistantHeader} workspace={workspace} busy={busy} now={now} run={run} />
  const practicing = (page === 'practice' && workspace.sessions.some(session => session.id === route.split('/')[1] && session.status === 'active'))
    || (page === 'lessons' && workspace.exerciseSessions.some(session => session.id === route.split('/')[2] && session.status === 'active'))
  const workspaceNavigation = <>
        <p className="workspace-label">YOUR WORKSPACE</p>
        <nav className="primary-nav" aria-label="Main navigation">{navigation.filter(item => isAreaOn(getPack(), item.area)).map(item => <a href={`#${item.id}`} key={item.id} aria-current={section === item.id ? 'page' : undefined} title={item.label}>
          <item.icon size={19} aria-hidden="true" /><span>{item.label}</span>{item.id === 'practice' && due > 0 && <small className="nav-count">{due}</small>}
        </a>)}</nav>
        <div className="sidebar-bottom"><BackupNow />
          <BuildSwitch className="profile" settingsHref="#settings" extraItems={copyItems} apps={labApps().map(app => ({ label: app.name, glyph: app.glyph, lang: app.id, href: appHref(app.id), current: app.id === buildLanguage() }))}><span className="avatar">{preferences.name.slice(0, 1).toUpperCase()}</span><span><strong>{preferences.name}</strong><small>{`English / ${getPack().wording.language}`}</small></span></BuildSwitch></div>
        </>
  return <PinyinFormatContext.Provider value={preferences.pinyinFormat ?? DEFAULT_PINYIN_FORMAT}><ReadingSettingsContext.Provider value={{ show: preferences.pinyin, japanese: preferences.japaneseReading ?? 'romaji' }}><DisplaySettingsProvider settings={displaySettings}><ToneColourProvider on={getPack().tones === true && preferences.toneColours === true}><PageSettingsProvider><PageActionsProvider><PageDockContext.Provider value={dock}>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); main.current?.focus() }}>Skip to content</a>
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''} ${assistant ? 'assistant-shell' : ''}`}>
      <aside className="sidebar" aria-label="Workspace navigation">
        {assistant && <AssistantSidebar selectedId={route.split('/')[1]} collapsed={collapsed}
          toggle={() => void run(() => savePreferences({ sidebarCollapsed: !collapsed }))} returnRoute={returnRoute.current} />}
        <div className="workspace-navigation">
          <div className="sidebar-header"><a className="brand" href="#overview" aria-label="LinguaWeave home"><span className="brand-mark">lw.</span><span className="brand-name">linguaweave</span></a><LabMark className="sidebar-mark" />
            <button className="icon-button sidebar-toggle" disabled={busy} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}
              onClick={() => void run(() => savePreferences({ sidebarCollapsed: !collapsed }))}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
          {workspaceNavigation}
        </div>
      </aside>
      <div className="workspace"><header className="topbar"><div className="topbar-leading">
        <MobileNavigation route={route}>{workspaceNavigation}</MobileNavigation>
        {assistant && route.split('/')[1] ? <div className="assistant-topbar-title" ref={setAssistantHeader} />
          : <div className="breadcrumb"><strong>{label}</strong></div>}</div>
        <div className="topbar-actions"><span className="language-pill profile-pill" title={profile.name} aria-label={`Active profile: ${profile.name}`}>{profile.name}</span><AppSwitch />{!appSwitchShown() && <span className="language-pill"><span lang={getPack().learningTag}>{getPack().glyph}</span> {getPack().wording.language}</span>}
          <PageActionsMenu />
          <PageSettingsButton route={route} label={label} page={page} workspace={workspace} busy={busy} run={run} />
        </div></header>
        <main id="main" ref={main} tabIndex={-1} className={assistant ? 'assistant-main' : ['practice/mahjong', 'games/mahjong'].includes(route) ? 'mahjong-main' : route === 'games/sudoku' ? 'sudoku-main' : route === 'games/memory' ? 'memory-main' : route === 'games/defender' ? 'defender-main' : route === 'games/potions' ? 'potions-main' : practicing ? 'practice-main' : page === 'writing' && route.split('?')[0].split('/')[1] ? 'writing-main' : page === 'lesson' ? 'lesson-main' : undefined}>
          {removedCount > 0 && <div role="status" className="notice"><p>{`Removed ${removedCount} ${removedCount === 1 ? 'item' : 'items'} of another language that came in with an imported profile.`}</p><button className="icon-button" aria-label="Dismiss notice" onClick={() => { setRemovedCount(0); void markCleanupNoticed() }}><X size={18} /></button></div>}
          {error && <div role="alert" className="notice error"><p>{error}</p><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={18} /></button></div>}
          {currentPage}
        </main>
        <div className="page-dock" ref={setDock} />
      </div>
      <WritingSheetHost workspace={workspace} busy={busy} now={now} run={run} />
      <UpdateBar />
      {copyDialog && <StableCopyDialog mode={copyDialog} onClose={() => setCopyDialog(undefined)} />}
        <PlaybackStatus debug={preferences.speechDebugMessages ?? false} />
      <DraftStatus />
      {page !== 'settings' && <SelectionActions route={route} title={sourceTitle ?? label} rate={preferences.defaultSpeechRate ?? 1} />}
    </div>
  </PageDockContext.Provider></PageActionsProvider></PageSettingsProvider></ToneColourProvider></DisplaySettingsProvider></ReadingSettingsContext.Provider></PinyinFormatContext.Provider>
}

function StorageFailure({ error }: { error: string }) {
  const [resetError, setResetError] = useState('')
  return <main className="opening-workspace"><h1>Your workspace could not be opened.</h1><p role="alert">{resetError || error}</p><p>No v1 data has been changed. Check that browser storage is available, then try again. You can also return to the default profile without deleting any profiles.</p>
    <div className="button-row"><button className="button primary" onClick={() => window.location.reload()}>Retry</button>
      <button className="button secondary" onClick={() => {
        try {
          resetSelectedProfile()
          window.location.reload()
        } catch (reason) {
          setResetError(reason instanceof Error ? reason.message : 'Profile selection could not be reset.')
        }
      }}>Open default profile</button></div>
  </main>
}

class WorkspaceBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  render() {
    return this.state.error ? <StorageFailure error={this.state.error} /> : this.props.children
  }
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [bootstrap, setBootstrap] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    const began = performance.now()
    initializeProfiles().then(async () => {
      await timePhase('profiles', async () => undefined)
      await timePhase('bootstrap', bootstrapDefaultProfile)
      await timePhase('workspace', initializeWorkspace)
      await removeForeignLanguageRows().catch(() => 0) // once per profile; a failure leaves the rows, which are never shown anyway
      const pending = import.meta.env.DEV && import.meta.env.DEV_LOCAL_SETTINGS === 'true' && await needsLocalSettingsImport()
      if (!disposed) setBootstrap(pending)
    }).then(
      () => { if (!disposed) { setReady(true); recordStartup(performance.now() - began) } },
      reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) },
    )
    return () => { disposed = true }
  }, [])
  useEffect(() => { void removeBackgroundBackupRegistrations() }, [])
  useEffect(() => {
    if (!ready) return undefined
    void requestPersistence()
  }, [ready])
  if (error) return <StorageFailure error={error} />
  return ready ? <><SetupLinkStatus /><WorkspaceBoundary>
    {bootstrap
      ? <LocalAIConnectionSetup onImported={markLocalSettingsImported}><WorkspaceApp /></LocalAIConnectionSetup>
      : <WorkspaceApp />}
  </WorkspaceBoundary></> : <div className="opening-workspace" role="status">{`Opening your ${getPack().wording.language} workspace...`}</div>
}

function Redirect({ to }: { to: string }) {
  useEffect(() => redirect(to), [to])
  return <div className="opening-workspace" role="status">Opening...</div>
}
