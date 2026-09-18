import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, BookText, ChevronRight, Home, LibraryBig, MessageCircle, Moon, PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon, ShieldCheck, Sparkles, Sun, X } from 'lucide-react'
import { initializeWorkspace, loadWorkspace } from './core/database'
import { savePreferences } from './core/learning'
import { useRoute } from './core/routing'
import { lessons, stories } from './data/mandarin'
import { curriculumLevels } from './data/curriculum'
import { EmptyState, type PageProps } from './components/shared'
import { MobileNavigation } from './components/MobileNavigation'
import { Overview } from './pages/Overview'
import { Library, Reader } from './pages/Reading'
import { LessonDetail, Lessons } from './pages/Lessons'
import { Practice, PracticeSessionPage } from './pages/Practice'
import { Dictionary } from './pages/Dictionary'
import { Settings } from './pages/Settings'
import { LevelDetail } from './pages/Curriculum'
import { Assistant, AssistantSidebar } from './pages/Assistant'
import { PlaybackStatus, SelectionActions } from './components/assistant/SnippetActions'
import { DraftStatus } from './components/assistant/DraftStatus'
import { LocalAIConnectionSetup } from './components/assistant/LocalAIConnectionSetup'
import { setDefaultSpeechRate, setSpeechVoicePreferences, stopBrowserSpeech } from './core/assistant/speech'
import { interruptAudio } from './core/assistant/audio-owner'
import './App.css'
import './components/assistant/assistant.css'

const navigation = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'library', label: 'Library', icon: LibraryBig },
  { id: 'lessons', label: 'Lessons', icon: BookOpen },
  { id: 'practice', label: 'Practice', icon: Sparkles },
  { id: 'conversation', label: 'Assistant', icon: MessageCircle },
  { id: 'dictionary', label: 'Dictionary', icon: BookText },
]

function NotFound() {
  return <EmptyState title="This page is not available"><p>The story, lesson, or saved session may no longer be in this workspace.</p><a className="button primary" href="#overview">Return to overview</a></EmptyState>
}

function CurrentPage({ route, returnRoute, ...props }: PageProps & { route: string; returnRoute: string }) {
  const [page, id, lessonPage] = route.split('/')
  if (page === 'overview') return <Overview {...props} />
  if (page === 'library') return <Library {...props} />
  if (page === 'reader') {
    const story = stories.find(item => item.id === (id ?? stories[0].id))
    return story ? <Reader key={story.id} {...props} story={story} /> : <NotFound />
  }
  if (page === 'lessons') return <Lessons {...props} />
  if (page === 'level') {
    const level = curriculumLevels.find(item => item.id === id)
    return level ? <LevelDetail {...props} level={level} /> : <NotFound />
  }
  if (page === 'lesson') {
    const lesson = lessons.find(item => item.id === id)
    return lesson ? <LessonDetail {...props} lesson={lesson} page={lessonPage} /> : <NotFound />
  }
  if (page === 'practice' && id) {
    const session = props.workspace.sessions.find(item => item.id === id)
    return session ? <PracticeSessionPage {...props} session={session} /> : <NotFound />
  }
  if (page === 'practice' || page === 'review') return <Practice {...props} />
  if (page === 'dictionary') return <Dictionary {...props} />
  if (page === 'settings') return <Settings {...props} />
  if (page === 'conversation') return <Assistant threadId={id} returnRoute={returnRoute} />
  return <NotFound />
}

function WorkspaceApp() {
  const workspace = useLiveQuery(loadWorkspace, [])
  const route = useRoute()
  const [pending, setPending] = useState(0)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)
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
  const section = page === 'reader' ? 'library' : ['lesson', 'level'].includes(page) ? 'lessons' : page === 'review' ? 'practice' : page
  const label = navigation.find(item => item.id === section)?.label ?? (page === 'settings' ? 'Settings' : 'Workspace')
  const sourceTitle = page === 'reader' ? stories.find(story => story.id === route.split('/')[1])?.title
    : page === 'lesson' ? lessons.find(lesson => lesson.id === route.split('/')[1])?.title : undefined
  useEffect(() => {
    if (!assistant) returnRoute.current = route
    try { interruptAudio() } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Audio could not be stopped. Close this page before trying again.')
    }
    stopBrowserSpeech()
    document.title = `${label} / LinguaWeave`
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
  if (!workspace) return <div className="opening-workspace" role="status">Opening your saved workspace...</div>
  const { preferences } = workspace
  const collapsed = preferences.sidebarCollapsed
  const due = workspace.words.filter(word => word.dueAt <= now).length
  const busy = pending > 0
  const currentPage = <CurrentPage key={route} route={route} returnRoute={returnRoute.current} workspace={workspace} busy={busy} now={now} run={run} />
  const practicing = page === 'practice' && workspace.sessions.some(session => session.id === route.split('/')[1] && session.status === 'active')
  const workspaceNavigation = <>
        <p className="workspace-label">YOUR WORKSPACE</p>
        <nav className="primary-nav" aria-label="Main navigation">{navigation.map(item => <a href={`#${item.id}`} key={item.id} aria-current={section === item.id ? 'page' : undefined} title={item.label}>
          <item.icon size={19} aria-hidden="true" /><span>{item.label}</span>{item.id === 'practice' && due > 0 && <small className="nav-count">{due}</small>}
        </a>)}</nav>
        <div className="sidebar-bottom"><div className="workspace-note"><ShieldCheck size={18} /><p>Your own pace.<br />Your own space.<small>Saved on this device.</small></p></div>
          <a className="profile" href="#settings"><span className="avatar">{preferences.name.slice(0, 1).toUpperCase()}</span><span><strong>{preferences.name}</strong><small>English / Mandarin</small></span></a>
          <a className="legacy-link" href="./v1/">Original app / v1</a></div>
        </>
  return <>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); main.current?.focus() }}>Skip to content</a>
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''} ${assistant ? 'assistant-shell' : ''}`}>
      <aside className="sidebar" aria-label="Workspace navigation">
        {assistant && <AssistantSidebar selectedId={route.split('/')[1]} collapsed={collapsed}
          toggle={() => void run(() => savePreferences({ sidebarCollapsed: !collapsed }))} returnRoute={returnRoute.current} />}
        <div className="workspace-navigation">
          <div className="sidebar-header"><a className="brand" href="#overview" aria-label="LinguaWeave home"><span className="brand-mark">lw.</span><span className="brand-name">linguaweave</span></a>
            <button className="icon-button sidebar-toggle" disabled={busy} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}
              onClick={() => void run(() => savePreferences({ sidebarCollapsed: !collapsed }))}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
          {workspaceNavigation}
        </div>
      </aside>
      <div className="workspace"><header className="topbar"><div className="topbar-leading">
        <MobileNavigation route={route}>{workspaceNavigation}</MobileNavigation>
        <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{label}</strong></div></div>
        <div className="topbar-actions"><span className="language-pill"><span lang="zh-Hans">&#x4E2D;</span> Mandarin</span>
          <button className="icon-button" disabled={busy} aria-label={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={() => void run(() => savePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' }))}>{preferences.theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>
          <a href="#settings" className="icon-button" aria-label="Workspace settings" aria-current={page === 'settings' ? 'page' : undefined}><SettingsIcon size={20} /></a>
        </div></header>
        <main id="main" ref={main} tabIndex={-1} className={assistant ? 'assistant-main' : practicing ? 'practice-main' : page === 'lesson' ? 'lesson-main' : undefined}>
          {error && <div role="alert" className="notice error"><p>{error}</p><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={18} /></button></div>}
          {currentPage}
        </main>
      </div>
      <PlaybackStatus />
      <DraftStatus />
      {page !== 'settings' && <SelectionActions route={route} title={sourceTitle ?? label} />}
    </div>
  </>
}

function StorageFailure({ error }: { error: string }) {
  return <main className="opening-workspace"><h1>Your workspace could not be opened.</h1><p role="alert">{error}</p><p>No v1 data has been changed. Check that browser storage is available, then try again.</p>
    <div className="button-row"><button className="button primary" onClick={() => window.location.reload()}>Retry</button><a href="./v1/" className="button secondary">Open v1</a></div>
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
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    initializeWorkspace().then(
      () => { if (!disposed) setReady(true) },
      reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) },
    )
    return () => { disposed = true }
  }, [])
  if (error) return <StorageFailure error={error} />
  return ready ? <WorkspaceBoundary>
    {import.meta.env.DEV && import.meta.env.DEV_LOCAL_SETTINGS === 'true'
      ? <LocalAIConnectionSetup><WorkspaceApp /></LocalAIConnectionSetup>
      : <WorkspaceApp />}
  </WorkspaceBoundary> : <div className="opening-workspace" role="status">Opening your Mandarin workspace...</div>
}
