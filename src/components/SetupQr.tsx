import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { Camera, Copy, QrCode } from 'lucide-react'
import { applySetup, encodeSetupLink, pendingSetupFragment } from '../core/backup/setup-link'
import type { BackupConfig } from '../core/backup/service'

export const QR_VISIBLE_MS = 2 * 60 * 1000
const message = (error: unknown) => error instanceof Error ? error.message : 'The operation failed.'

/** Shows the setup QR only after a click; hides it on close or after two minutes. */
export function ShowSetupQr({ config }: { config: BackupConfig }) {
  const [url, setUrl] = useState('')
  const [image, setImage] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!url) { setImage(''); return undefined }
    let live = true
    void QRCode.toDataURL(url, { margin: 2, width: 320, errorCorrectionLevel: 'L' }).then(data => { if (live) setImage(data) }, () => undefined)
    const timer = window.setTimeout(() => setUrl(''), QR_VISIBLE_MS)
    return () => { live = false; window.clearTimeout(timer) }
  }, [url])
  const link = () => encodeSetupLink(config)
  return <div className="settings-form">
    <div className="button-row">
      <button type="button" className="button secondary" onClick={() => setUrl(link())}><QrCode size={16} /> Show setup QR code</button>
      <button type="button" className="button secondary" onClick={() => { void navigator.clipboard?.writeText(link()).then(() => setCopied(true), () => undefined) }}><Copy size={16} /> Copy setup link</button>
    </div>
    {copied && <p className="small muted" role="status">Setup link copied. It contains the backup token.</p>}
    {url && <div className="notice" aria-label="Setup QR code">
      <p><strong>This code contains your backup token.</strong> Only scan it on your own devices. It hides after 2 minutes.</p>
      {image && <img src={image} width={320} height={320} alt="Cloud backup setup QR code" style={{ background: '#fff', maxWidth: '100%', height: 'auto' }} />}
      <button type="button" className="button secondary" onClick={() => setUrl('')}>Hide QR code</button>
    </div>}
  </div>
}

type Detector = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
function nativeDetector(): Detector | undefined {
  const Ctor = (globalThis as { BarcodeDetector?: new (options: { formats: string[] }) => Detector }).BarcodeDetector
  try { return Ctor ? new Ctor({ formats: ['qr_code'] }) : undefined } catch { return undefined }
}

/** Opens the camera and applies the first setup QR code seen, with no confirmation. */
export function ScanSetupQr({ onStatus }: { onStatus?: (text: string, error: boolean) => void }) {
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const report = (text: string, error: boolean) => { setStatus(text); setFailed(error); onStatus?.(text, error) }

  useEffect(() => {
    if (!scanning) return undefined
    let live = true
    let stream: MediaStream | undefined
    const canvas = document.createElement('canvas')
    const detector = nativeDetector()
    const finish = () => { live = false; stream?.getTracks().forEach(track => track.stop()); setScanning(false) }
    const read = async (element: HTMLVideoElement): Promise<string | undefined> => {
      if (detector) return (await detector.detect(element))[0]?.rawValue
      canvas.width = element.videoWidth; canvas.height = element.videoHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context || !canvas.width) return undefined
      context.drawImage(element, 0, 0)
      const data = context.getImageData(0, 0, canvas.width, canvas.height)
      return jsQR(data.data, data.width, data.height)?.data
    }
    const loop = async (element: HTMLVideoElement) => {
      while (live) {
        await new Promise(resolve => window.setTimeout(resolve, 200))
        if (!live) return
        let text: string | undefined
        try { text = await read(element) } catch { text = undefined }
        if (!text) continue
        finish()
        try { report((await applySetup(text)).message, false) } catch (error) { report(message(error), true) }
        return
      }
    }
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (!live) { stream.getTracks().forEach(track => track.stop()); return }
        const element = video.current
        if (!element) return
        element.srcObject = stream
        await element.play()
        await loop(element)
      } catch (error) {
        finish(); report(navigator.mediaDevices ? 'Could not open the camera: ' + message(error) : 'This browser cannot open the camera.', true)
      }
    })()
    return () => { live = false; stream?.getTracks().forEach(track => track.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning])

  return <div className="settings-form">
    <button type="button" className="button secondary" onClick={() => { setStatus(''); setScanning(value => !value) }}><Camera size={16} /> {scanning ? 'Stop scanning' : 'Scan setup QR code'}</button>
    {scanning && <video ref={video} muted playsInline aria-label="Camera preview" style={{ width: '100%', maxWidth: 360, borderRadius: 8 }} />}
    {status && <p className={failed ? 'notice error' : 'notice success'} role={failed ? 'alert' : 'status'}>{status}</p>}
  </div>
}

/** Applies a #backup= link that opened the app (the fragment was already stripped when the page loaded). */
export function SetupLinkStatus() {
  const [state, setState] = useState<{ text: string; error: boolean } | undefined>(pendingSetupFragment ? { text: 'Connecting cloud backup...', error: false } : undefined)
  const started = useRef(false)
  useEffect(() => {
    if (!pendingSetupFragment || started.current) return
    started.current = true
    applySetup(pendingSetupFragment).then(result => setState({ text: result.message, error: false }), error => setState({ text: message(error), error: true }))
  }, [])
  if (!state) return null
  return <p className={state.error ? 'notice error' : 'notice success'} role={state.error ? 'alert' : 'status'} style={{ position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 50, margin: 0 }}>
    {state.text} <button type="button" className="button secondary" onClick={() => setState(undefined)}>Dismiss</button>
  </p>
}
