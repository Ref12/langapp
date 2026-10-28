import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Paperclip, X } from 'lucide-react'
import { db } from '../../core/database'
import { MAX_MESSAGE_IMAGES } from '../../core/assistant/contracts'
import type { PreparedImage } from '../../core/assistant/images'
import { imageFiles, createUrl, revokeUrl } from './useAttachments'


export function AttachButton({ add, disabled, count }: { add: (files: Blob[]) => void; disabled: boolean; count: number }) {
  const input = useRef<HTMLInputElement>(null)
  return <>
    <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden data-testid="assistant-image-input" tabIndex={-1}
      onChange={event => { const files = imageFiles(event.target.files); event.target.value = ''; if (files.length) add(files) }} />
    <button className="icon-button composer-attach" type="button" aria-label="Attach image" title={count >= MAX_MESSAGE_IMAGES ? 'Up to 4 images per message' : 'Attach a photo or image'}
      disabled={disabled || count >= MAX_MESSAGE_IMAGES} onClick={() => input.current?.click()}><Paperclip size={20} /></button>
  </>
}

export function ComposerAttachments({ items, remove }: { items: PreparedImage[]; remove: (id: string) => void }) {
  const [viewing, setViewing] = useState<string>()
  if (!items.length) return null
  return <>
    <ul className="composer-thumbs" aria-label="Attached images">
      {items.map((item, index) => <li key={item.id}>
        <button type="button" className="thumb-open" aria-label={`View image ${index + 1}`} onClick={() => setViewing(item.url)}><img src={item.url} alt={`Attachment ${index + 1}`} /></button>
        <button type="button" className="thumb-remove" aria-label={`Remove image ${index + 1}`} onClick={() => remove(item.id)}><X size={14} /></button>
      </li>)}
    </ul>
    {viewing && <ImageViewer url={viewing} onClose={() => setViewing(undefined)} />}
  </>
}

/** Thumbnails inside a sent user bubble; a missing row (restored backup) shows a placeholder. */
export function AssistantImageStrip({ ids }: { ids: string[] }) {
  const rows = useLiveQuery(() => db.assistantImages.bulkGet(ids), [ids.join('|')])
  const [urls, setUrls] = useState<(string | undefined)[]>([])
  const [viewing, setViewing] = useState<string>()
  useEffect(() => {
    const next = (rows ?? []).map(row => row ? createUrl(row.blob) : undefined)
    setUrls(next)
    return () => next.forEach(url => url && revokeUrl(url))
  }, [rows])
  if (!rows) return null
  return <>
    <ul className="message-thumbs" aria-label="Attached images">
      {ids.map((id, index) => rows[index]
        ? <li key={id}><button type="button" className="thumb-open" aria-label={`Open image ${index + 1}`} onClick={() => urls[index] && setViewing(urls[index])}>
          <img src={urls[index] ?? ''} alt={`Image ${index + 1}`} width={rows[index]!.width} height={rows[index]!.height} /></button></li>
        : <li key={id} className="thumb-missing small muted">image not included in backup</li>)}
    </ul>
    {viewing && <ImageViewer url={viewing} onClose={() => setViewing(undefined)} />}
  </>
}

function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    close.current?.focus()
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  // Native pinch-zoom and panning work on the scrollable surface; a tap on the backdrop closes it.
  return <div className="image-viewer" role="dialog" aria-modal="true" aria-label="Image viewer" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <button ref={close} type="button" className="icon-button image-viewer-close" aria-label="Close image" onClick={onClose}><X size={22} /></button>
    <div className="image-viewer-surface" onClick={event => { if (event.target === event.currentTarget) onClose() }}><img src={url} alt="Full-size attachment" /></div>
  </div>
}
