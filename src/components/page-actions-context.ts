import { createContext, useContext, useEffect } from 'react'

/** One item of the header's page menu: a plain action, or a checkable toggle when `checked` is set. */
export interface PageAction { id: string; label: string; onSelect: () => void; checked?: boolean; disabled?: boolean; /** Smaller muted line under the label. */ description?: string }

export const PageActionsContext = createContext<PageAction[]>([])
export const PageActionsSetContext = createContext<(actions: PageAction[]) => void>(() => undefined)

/** A page registers its menu items while mounted; they are cleared on unmount. */
export function usePageActions(actions: PageAction[]) {
  const set = useContext(PageActionsSetContext)
  useEffect(() => { set(actions) })
  useEffect(() => () => set([]), [set])
}
