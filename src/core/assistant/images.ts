import { MAX_MESSAGE_IMAGES } from './contracts'

export const MAX_IMAGE_SIDE = 1600
export const IMAGE_QUALITY = 0.85

export interface PreparedImage { id: string; blob: Blob; width: number; height: number; bytes: number; url: string }

export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
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
export async function downscaleImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  let decoded
  try { decoded = await decode(file) } catch { throw new Error('This image could not be read. Try a JPEG or PNG photo.') }
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot resize images.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.drawImage(decoded.source, 0, 0, width, height)
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
