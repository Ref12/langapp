import { createContext, useContext, useEffect, type ReactNode } from 'react'

export interface PageSettingsEntry { title?: string; content: ReactNode }

export const PageSettingsEntryContext = createContext<PageSettingsEntry | null>(null)
export const PageSettingsSetContext = createContext<(entry: PageSettingsEntry | null) => void>(() => undefined)

/** A page registers its settings panel while mounted; it is cleared on unmount. */
export function usePageSettings({ title, content }: PageSettingsEntry) {
  const set = useContext(PageSettingsSetContext)
  useEffect(() => { set({ title, content }) })
  useEffect(() => () => set(null), [set])
}
