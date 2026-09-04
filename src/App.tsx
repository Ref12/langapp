import { AppShell } from './components/AppShell'
import { ProfileGate } from './components/ProfileGate'
import { UpdatePrompt } from './components/UpdatePrompt'
import { useHashPath } from './core/hashRoute'
import { moduleRegistry } from './modules/registry'
import { DashboardPage } from './pages/DashboardPage'
import { DictionaryPage } from './pages/DictionaryPage'
import { SettingsPage } from './pages/SettingsPage'
import { ReviewPage } from './pages/ReviewPage'
import './App.css'

function CurrentPage({ path }: { path: string }) {
  if (path === '/') return <DashboardPage />
  if (path === '/dictionary') return <DictionaryPage />
  if (path === '/settings') return <SettingsPage />
  if (path === '/review') return <ReviewPage />

  const matchedModule = moduleRegistry.find(
    (module) => path === module.path || path.startsWith(`${module.path}/`),
  )
  if (matchedModule) {
    const ModuleComponent = matchedModule.component
    return <ModuleComponent />
  }

  return (
    <div className="page">
      <h1>Page not found</h1>
      <a href="#/">Return home</a>
    </div>
  )
}

export default function App() {
  const path = useHashPath()
  return (
    <ProfileGate>
      <>
        <AppShell currentPath={path}>
          <CurrentPage path={path} />
        </AppShell>
        <UpdatePrompt />
      </>
    </ProfileGate>
  )
}
