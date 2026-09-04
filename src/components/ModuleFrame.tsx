import { useState, type ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

export function ModuleFrame({
  storageKey,
  panel,
  mainClassName,
  children,
}: {
  storageKey: string
  panel: ReactNode
  mainClassName: string
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(storageKey) === 'collapsed',
  )

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current
      localStorage.setItem(storageKey, next ? 'collapsed' : 'expanded')
      return next
    })
  }

  return (
    <div className={`module-layout ${collapsed ? 'module-panel-collapsed' : ''}`}>
      <aside className={`module-panel ${collapsed ? 'collapsed' : ''}`}>
        <button
          className="panel-toggle"
          onClick={toggle}
          aria-label={collapsed ? 'Expand side pane' : 'Collapse side pane'}
          title={collapsed ? 'Expand side pane' : 'Collapse side pane'}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
        <div className="module-panel-content" aria-hidden={collapsed}>
          {panel}
        </div>
      </aside>
      <section className={mainClassName}>{children}</section>
    </div>
  )
}
