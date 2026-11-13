import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Camera } from 'lucide-react'
import { getPack } from '../core/language'
import { useAIConnection } from './study/useAIConnection'
import { boxToImage, downscaleImage, dragBox, type Box, type Handle } from '../core/assistant/images'
import { PHOTO_READ_ERROR, readHandwritingPhoto } from '../core/assistant/photo-answer'
import { AssistantCancelledError } from '../core/ai/provider'
import type { AIConnectionInput } from '../core/assistant/contracts'

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_NAME: Record<Handle, string> = { move: 'Move', n: 'top edge', s: 'bottom edge', e: 'right edge', w: 'left edge', nw: 'top left corner', ne: 'top right corner', sw: 'bottom left corner', se: 'bottom right corner' }

function CropStep({ file, busy, onRead, onRetake }: { file: File; busy: boolean; onRead: (crop: Box | undefined) => void; onRetake: () => void }) {
  const [url, setUrl] = useState('')
  const image = useRef<HTMLImageElement>(null)
  const [box, setBox] = useState<Box>()
  const touched = useRef(false)
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Box }>()
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next) }, [file])
  const size = () => ({ width: image.current?.clientWidth ?? 0, height: image.current?.clientHeight ?? 0 })
  const reset = () => { const { width, height } = size(); setBox({ x: 0, y: 0, width, height }) }
  const down = (handle: Handle) => (event: ReactPointerEvent) => {
    if (!box || busy) return
    event.preventDefault(); event.stopPropagation()
    try { (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId) } catch { /* a pointer that cannot be captured still drags */ }
    drag.current = { handle, x: event.clientX, y: event.clientY, start: box }
  }
  const move = (event: ReactPointerEvent) => {
    const current = drag.current
    if (!current) return
    touched.current = true
    setBox(dragBox(current.start, current.handle, event.clientX - current.x, event.clientY - current.y, size()))
  }
  const up = () => { drag.current = undefined }
  const read = () => {
    const element = image.current
    const display = size()
    const natural = { width: element?.naturalWidth ?? 0, height: element?.naturalHeight ?? 0 }
    // Untouched: the whole photo, with no crop at all.
    onRead(touched.current && box && display.width > 0 && natural.width > 0 ? boxToImage(box, display, natural) : undefined)
  }
  return <div className="photo-crop" role="group" aria-label="Crop your photo">
    <p className="small muted">Drag the corners or edges to keep only your answer, or read the whole photo.</p>
    <div className="photo-crop-frame">
      {url && <img ref={image} src={url} alt="Your photo, to crop" draggable={false} onLoad={reset} />}
      {box && <div className="photo-crop-box" role="group" aria-label="Crop box: drag it, or its corners and edges, to choose the part to read" data-touched={touched.current || undefined}
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }} onPointerDown={down('move')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {HANDLES.map(handle => <span key={handle} className={`photo-crop-handle photo-crop-${handle}`} data-handle={handle} title={HANDLE_NAME[handle]} onPointerDown={down(handle)} />)}
      </div>}
    </div>
    <div className="button-row">
      <button type="button" className="button primary" disabled={busy} onClick={read}>{busy ? 'Reading…' : 'Read this part'}</button>
      <button type="button" className="button secondary" disabled={busy} onClick={onRetake}>Retake</button>
    </div>
  </div>
}

/**
 * "Answer with a photo": the learner photographs a handwritten answer, can crop it, and the learner's own AI connection reads it. The reading goes to onText
 * to be shown as editable text; the app's usual check follows only when the learner presses Check answer. The photo is never stored: it lives in memory
 * until the reading comes back.
 */
export function PhotoAnswer({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const connection = useAIConnection()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [read, setRead] = useState(false)
  const [needConnection, setNeedConnection] = useState(false)
  const controller = useRef<AbortController>()
  useEffect(() => () => controller.current?.abort(), [])
  const open = () => {
    setError('')
    if (connection === null) { setNeedConnection(value => !value); return }
    setNeedConnection(false)
    input.current?.click()
  }
  const pick = (picked: File | undefined) => {
    if (input.current) input.current.value = ''
    if (!picked) return
    setError(''); setRead(false); setFile(picked)
  }
  const send = async (crop: Box | undefined) => {
    if (!file || !connection) return
    const abort = new AbortController()
    controller.current = abort
    setBusy(true); setError('')
    try {
      const { blob } = await downscaleImage(file, crop)
      const text = await readHandwritingPhoto(connection as AIConnectionInput, blob, getPack().practiceWording.languageName, abort.signal)
      if (abort.signal.aborted) return
      setFile(null); setRead(true)
      onText(text)
    } catch (caught) {
      if (caught instanceof AssistantCancelledError || abort.signal.aborted) return
      setError(caught instanceof Error && caught.message ? caught.message : PHOTO_READ_ERROR)
    } finally { if (!abort.signal.aborted) setBusy(false) }
  }
  return <div className="photo-answer">
    <input ref={input} type="file" accept="image/*" capture="environment" className="visually-hidden" tabIndex={-1} aria-hidden="true" data-testid="photo-input" onChange={event => pick(event.target.files?.[0])} />
    {!file && <button type="button" className="button secondary" disabled={disabled} onClick={open}><Camera size={16} /> Answer with a photo</button>}
    {needConnection && !file && <div className="notice" role="status"><p className="small">Photo answers need an AI connection, which reads your handwriting. <a className="text-link" href="#settings">Set up an AI connection in Settings</a></p></div>}
    {file && <CropStep file={file} busy={busy} onRead={crop => void send(crop)} onRetake={() => { controller.current?.abort(); setFile(null); setBusy(false); setError(''); window.setTimeout(() => input.current?.click(), 0) }} />}
    {error && <p className="small error-text" role="alert">{error}</p>}
    {read && !file && !error && <p className="small muted" role="status">Read from your photo, check it before you submit.</p>}
  </div>
}
