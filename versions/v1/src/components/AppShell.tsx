import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ReactNode } from 'react'
import {
  BookOpen,
  BookText,
  Dumbbell,
  Home,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-react'
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
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('app-sidebar') === 'collapsed',
  )
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? []
  const activeSetting = useLiveQuery(
    () => db.settings.get('activeProfileId'),
    [],
  )

  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <button
          className="sidebar-toggle"
          onClick={() =>
            setCollapsed((current) => {
              const next = !current
              localStorage.setItem(
                'app-sidebar',
                next ? 'collapsed' : 'expanded',
              )
              return next
            })
          }
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            <Languages size={22} />
          </span>
          <span className="brand-label">LinguaWeave</span>
        </div>

        <nav aria-label="Primary navigation">
          <HashLink
            className={navClass(currentPath, '/', true)}
            to="/"
            ariaLabel="Home"
          >
            <Home size={19} />
            <span className="nav-label">Home</span>
          </HashLink>
          {moduleRegistry.map((module) => {
            const Icon = module.icon
            return (
              <HashLink
                className={navClass(currentPath, module.path)}
                to={module.path}
                ariaLabel={module.label}
                key={module.id}
              >
                <Icon size={19} />
                <span className="nav-label">{module.label}</span>
              </HashLink>
            )
          })}
          <HashLink
            className={navClass(currentPath, '/dictionary')}
            to="/dictionary"
            ariaLabel="Dictionary"
          >
            <BookText size={19} />
            <span className="nav-label">Dictionary</span>
          </HashLink>
          <HashLink
            className={navClass(currentPath, '/review')}
            to="/review"
            ariaLabel="Review"
          >
            <Dumbbell size={19} />
            <span className="nav-label">Review</span>
          </HashLink>
          <HashLink
            className={navClass(currentPath, '/settings')}
            to="/settings"
            ariaLabel="Settings"
          >
            <Settings size={19} />
            <span className="nav-label">Settings</span>
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
