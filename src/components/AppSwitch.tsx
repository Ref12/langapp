import { appHref, labApps } from '../core/language/apps'
import { buildChannel, buildLanguage } from '../core/storage-names'

/** Top-bar switch between the Lab language apps (glyph links, the current one marked). Lab builds only; Stable has one app. */
export function AppSwitch() {
  const apps = labApps()
  if (buildChannel() !== 'lab' || apps.length < 2) return null
  const current = buildLanguage()
  return <nav className="language-switch" aria-label="Language apps">
    {apps.map(app => <a key={app.id} href={appHref(app.id, current)} lang={app.id} title={app.name} aria-label={app.name}
      aria-current={app.id === current ? 'page' : undefined} className={app.id === current ? 'active' : undefined}>{app.glyph}</a>)}
  </nav>
}
