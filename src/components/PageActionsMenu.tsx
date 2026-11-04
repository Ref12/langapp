import { useContext, useState, type ReactNode } from 'react'
import { Check, MoreVertical } from 'lucide-react'
import { ActionMenu } from './assistant/ActionMenu'
import { PageActionsContext, PageActionsSetContext, type PageAction } from './page-actions-context'

/** Holds the menu items the current page registered. */
export function PageActionsProvider({ children }: { children: ReactNode }) {
  const [actions, set] = useState<PageAction[]>([])
  return <PageActionsSetContext.Provider value={set}><PageActionsContext.Provider value={actions}>{children}</PageActionsContext.Provider></PageActionsSetContext.Provider>
}

/** The header's ⋮ overflow menu; absent when the page registered nothing. */
export function PageActionsMenu() {
  const actions = useContext(PageActionsContext)
  if (!actions.length) return null
  return <ActionMenu label="Page actions" className="page-actions" trigger={<MoreVertical size={20} />}>
    {close => <div className="page-actions-list" role="menu" aria-label="Page actions">
      {actions.map(action => <PageActionItem key={action.id} action={action} close={close} />)}
    </div>}
  </ActionMenu>
}

function PageActionItem({ action, close }: { action: PageAction; close: (restoreFocus?: boolean) => void }) {
  const checkable = action.checked !== undefined
  return <button type="button" role={checkable ? 'menuitemcheckbox' : 'menuitem'} aria-checked={checkable ? action.checked : undefined}
    className="page-actions-item" disabled={action.disabled} onClick={() => { action.onSelect(); close() }}>
    <span className="page-actions-check" aria-hidden="true">{action.checked && <Check size={14} />}</span>{action.label}</button>
}
