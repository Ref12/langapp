import { MAX_MESSAGE_IMAGES } from './contracts'

export const MAX_IMAGE_SIDE = 1600
export const IMAGE_QUALITY = 0.85

export interface PreparedImage { id: string; blob: Blob; width: number; height: number; bytes: number; url: string }

export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export interface Box { x: number; y: number; width: number; height: number }

/**
 * A box in screen pixels, over a photo shown at displayWidth x displayHeight, as the same area in image pixels. Rounded and kept inside the image,
 * at least 1 px wide and high. A display of no size gives the whole image.
 */
export function boxToImage(box: Box, display: { width: number; height: number }, image: { width: number; height: number }): Box {
  if (display.width <= 0 || display.height <= 0) return { x: 0, y: 0, width: image.width, height: image.height }
  const scaleX = image.width / display.width, scaleY = image.height / display.height
  const x = Math.min(image.width - 1, Math.max(0, Math.round(box.x * scaleX)))
  const y = Math.min(image.height - 1, Math.max(0, Math.round(box.y * scaleY)))
  const right = Math.min(image.width, Math.max(x + 1, Math.round((box.x + box.width) * scaleX)))
  const bottom = Math.min(image.height, Math.max(y + 1, Math.round((box.y + box.height) * scaleY)))
  return { x, y, width: right - x, height: bottom - y }
}

const MIN_SIDE = 24
export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

/** The box after dragging one handle by (dx, dy) screen pixels, kept inside the photo and at least MIN_SIDE wide and high. */
export function dragBox(start: Box, handle: Handle, dx: number, dy: number, bounds: { width: number; height: number }): Box {
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height
  if (handle === 'move') {
    const mx = Math.min(Math.max(dx, -left), bounds.width - right), my = Math.min(Math.max(dy, -top), bounds.height - bottom)
    return { x: left + mx, y: top + my, width: start.width, height: start.height }
  }
  const minW = Math.min(MIN_SIDE, bounds.width), minH = Math.min(MIN_SIDE, bounds.height)
  if (handle.includes('w')) left = Math.min(Math.max(0, left + dx), right - minW)
  if (handle.includes('e')) right = Math.max(Math.min(bounds.width, right + dx), left + minW)
  if (handle.includes('n')) top = Math.min(Math.max(0, top + dy), bottom - minH)
  if (handle.includes('s')) bottom = Math.max(Math.min(bounds.height, bottom + dy), top + minH)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    // 'from-image' applies the EXIF orientation so the stored pixels are upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined }
  } finally { URL.revokeObjectURL(url) }
}

/** Downscale (longest side 1600 px) and re-encode as JPEG before anything is stored or sent. */
export async function downscaleImage(file: Blob, crop?: Box): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  let decoded
  try { decoded = await decode(file) } catch { throw new Error('This image could not be read. Try a JPEG or PNG photo.') }
  try {
    // The crop is taken from the full-size photo first, so the chosen area keeps all its detail; then it is scaled down.
    const region: Box = crop ? { x: Math.max(0, Math.min(decoded.width - 1, crop.x)), y: Math.max(0, Math.min(decoded.height - 1, crop.y)), width: crop.width, height: crop.height } : { x: 0, y: 0, width: decoded.width, height: decoded.height }
    region.width = Math.max(1, Math.min(region.width, decoded.width - region.x))
    region.height = Math.max(1, Math.min(region.height, decoded.height - region.y))
    const { width, height } = fitWithin(region.width, region.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot resize images.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    if (crop) context.drawImage(decoded.source, region.x, region.y, region.width, region.height, 0, 0, width, height)
    else context.drawImage(decoded.source, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY))
    if (!blob) throw new Error('This image could not be converted.')
    return { blob, width, height }
  } finally { decoded.close() }
}

export async function prepareImages(files: Blob[], existing: number): Promise<PreparedImage[]> {
  const room = MAX_MESSAGE_IMAGES - existing
  if (room <= 0) throw new Error(`You can attach up to ${MAX_MESSAGE_IMAGES} images per message.`)
  const prepared: PreparedImage[] = []
  for (const file of files.filter(item => item.type.startsWith('image/')).slice(0, room)) {
    const { blob, width, height } = await downscaleImage(file)
    prepared.push({ id: crypto.randomUUID(), blob, width, height, bytes: blob.size, url: URL.createObjectURL(blob) })
  }
  return prepared
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`
}

/** Diagnostics copies never carry image data. */
export function redactImageData(text: string): string {
  return text.replace(/data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)/gi, (_match, data: string) => `<image ${Math.floor(data.length * 3 / 4)} bytes>`)
}
