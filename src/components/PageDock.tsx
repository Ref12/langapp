import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The app shell's bottom dock: a slot under the page, pinned to the bottom of the screen. */
export const PageDockContext = createContext<HTMLElement | null>(null)

/** Shows its children in the page's bottom dock, outside any card, so a page's main action bar sits at the bottom of the screen. Without a dock (tests, a page rendered alone) it renders in place. */
export function PageDock({ children }: { children: ReactNode }) {
  const dock = useContext(PageDockContext)
  return dock ? createPortal(children, dock) : <>{children}</>
}
