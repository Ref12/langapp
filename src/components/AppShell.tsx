import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, BookText, Home, Languages, Settings } from 'lucide-react'
import { db } from '../core/database'
import { setActiveProfile } from '../core/profiles'
import { moduleRegistry } from '../modules/registry'
import { HashLink } from './HashLink'

function navClass(currentPath: string, target: string, exact = false) {
  const active = exact
    ? currentPath === target
    : currentPath === target || currentPath.startsWith(`${target}/`)
  return active ? 'nav-link active' : 'nav-link'
}

export function AppShell({
  currentPath,
  children,
}: {
  currentPath: string
  children: React.ReactNode
}) {
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? []
  const activeSetting = useLiveQuery(
    () => db.settings.get('activeProfileId'),
    [],
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            <Languages size={22} />
          </span>
          <span>LinguaWeave</span>
        </div>

        <nav aria-label="Primary navigation">
          <HashLink className={navClass(currentPath, '/', true)} to="/">
            <Home size={19} />
            Home
          </HashLink>
          {moduleRegistry.map((module) => {
            const Icon = module.icon
            return (
              <HashLink
                className={navClass(currentPath, module.path)}
                to={module.path}
                key={module.id}
              >
                <Icon size={19} />
                {module.label}
              </HashLink>
            )
          })}
          <HashLink
            className={navClass(currentPath, '/dictionary')}
            to="/dictionary"
          >
            <BookText size={19} />
            Dictionary
          </HashLink>
          <HashLink
            className={navClass(currentPath, '/settings')}
            to="/settings"
          >
            <Settings size={19} />
            Settings
          </HashLink>
        </nav>

        <div className="sidebar-footer">
          <label>
            <span>Language profile</span>
            <select
              value={activeSetting?.value ?? profiles[0]?.id ?? ''}
              onChange={async (event) => {
                await setActiveProfile(event.target.value)
              }}
            >
              {profiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            <BookOpen size={14} /> Stored locally
          </p>
        </div>
      </aside>
      <main className="main-content">
        {children}
      </main>
    </div>
  )
}
