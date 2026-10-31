import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { closeWritingSheet, getWritingSheet, subscribeWritingSheet } from '../core/characters/writing-sheet'
import { WritingStage } from '../pages/Writing'
import type { PageProps } from './shared'

/** Writing practice as a nearly full-screen overlay over the current page, like phrase practice: nothing underneath navigates or scrolls. */
export function WritingSheetHost(props: PageProps) {
  const request = useSyncExternalStore(subscribeWritingSheet, getWritingSheet)
  return request ? <WritingSheet key={request.word.join('') + request.fromList} {...props} request={request} /> : null
}

function WritingSheet({ request, ...props }: PageProps & { request: NonNullable<ReturnType<typeof getWritingSheet>> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(request.index)
  useEffect(() => {
    const element = dialog.current!
    if (!element.open) element.showModal()
    window.addEventListener('hashchange', closeWritingSheet)
    return () => { window.removeEventListener('hashchange', closeWritingSheet); if (element.open) element.close() }
  }, [])
  return createPortal(<dialog ref={dialog} className="practice-playlist writing-overlay" aria-label="Writing practice" data-assistant-exclude
    onCancel={event => { event.preventDefault(); closeWritingSheet() }}>
    <header className="practice-playlist-header">
      <h2>Writing practice</h2>
      <div className="practice-header-actions">
        <button type="button" className="icon-button" aria-label="Close writing practice" title="Close" autoFocus onClick={closeWritingSheet}><X size={22} /></button>
      </div>
    </header>
    <div className="practice-playlist-content writing-overlay-content">
      <WritingStage {...props} character={request.word[index]} word={request.word} index={index} remember={request.remember}
        onBack={request.fromList ? closeWritingSheet : undefined} onGo={setIndex} onFinish={closeWritingSheet} />
    </div>
  </dialog>, document.body)
}
