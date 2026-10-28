import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { prepareImages, type PreparedImage } from '../../core/assistant/images'

export const createUrl = (blob: Blob) => typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : ''
export const revokeUrl = (url: string) => { if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url) }

/** Images chosen for the next message: downscaled on arrival, held in memory until the message is sent. */
export function useAttachments(onError: (message: string) => void) {
  const [items, setItems] = useState<PreparedImage[]>([])
  const current = useRef<PreparedImage[]>([])
  current.current = items
  const add = useCallback(async (files: Blob[]) => {
    try {
      const prepared = await prepareImages(files, current.current.length)
      if (!prepared.length) { onError('Choose an image file.'); return }
      const next = [...current.current, ...prepared]
      current.current = next
      setItems(next)
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'This image could not be attached.') }
  }, [onError])
  const remove = useCallback((id: string) => {
    setItems(list => { list.filter(item => item.id === id).forEach(item => revokeUrl(item.url)); return list.filter(item => item.id !== id) })
  }, [])
  const clear = useCallback(() => {
    current.current.forEach(item => revokeUrl(item.url))
    current.current = []
    setItems([])
  }, [])
  const restore = useCallback((list: PreparedImage[]) => {
    const next = list.map(item => ({ ...item, url: createUrl(item.blob) }))
    current.current = next
    setItems(next)
  }, [])
  useEffect(() => () => current.current.forEach(item => revokeUrl(item.url)), [])
  return { items, current, add, remove, clear, restore }
}

export function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return []
  return Array.from(list as ArrayLike<File | DataTransferItem>).flatMap(entry => {
    const file = entry instanceof File ? entry : entry.kind === 'file' ? entry.getAsFile() : null
    return file && file.type.startsWith('image/') ? [file] : []
  })
}

export function attachmentHandlers(add: (files: Blob[]) => void) {
  return {
    onPaste: (event: ClipboardEvent) => {
      const files = imageFiles(event.clipboardData?.files)
      if (files.length) { event.preventDefault(); add(files) }
    },
    onDragOver: (event: DragEvent) => { if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault() },
    onDrop: (event: DragEvent) => {
      const files = imageFiles(event.dataTransfer?.files)
      if (files.length) { event.preventDefault(); add(files) }
    },
  }
}

