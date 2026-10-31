import { useRef, type PointerEvent, type MouseEvent } from 'react'
import { isHan } from '../../core/characters/writing-route'
import { openWritingSheet } from '../../core/characters/writing-sheet'

export const LONG_PRESS_MS = 500

function offsetAt(event: { clientX: number; clientY: number }, element: HTMLElement): number | undefined {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
  const hit = doc.caretPositionFromPoint?.(event.clientX, event.clientY)
  const range = hit ? undefined : document.caretRangeFromPoint?.(event.clientX, event.clientY)
  const node = hit?.offsetNode ?? range?.startContainer
  const offset = hit?.offset ?? range?.startOffset
  if (!node || offset === undefined || !element.contains(node)) return undefined
  const before = document.createRange()
  before.selectNodeContents(element)
  before.setEnd(node, offset)
  return before.toString().length
}

/** The word (Intl segmentation) around a UTF-16 offset, or the whole text when the point is unknown. */
export function wordAt(text: string, offset: number | undefined): { word: string; start: number } {
  if (offset !== undefined && typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const Segmenter = (Intl as unknown as { Segmenter: new (locale: string, options: { granularity: 'word' }) => { segment(text: string): Iterable<{ segment: string; index: number }> } }).Segmenter
    for (const part of new Segmenter('zh', { granularity: 'word' }).segment(text)) {
      if (offset >= part.index && offset < part.index + part.segment.length && Array.from(part.segment).some(isHan)) return { word: part.segment, start: part.index }
    }
  }
  return { word: text, start: 0 }
}

/** Phone only: a 500 ms touch press on Chinese text opens the writing exercise for the word; a tap does nothing extra. */
export function useWriteLongPress() {
  const timer = useRef<number>()
  const fired = useRef(false)
  const cancel = () => { window.clearTimeout(timer.current); timer.current = undefined }
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.pointerType !== 'touch') return
      fired.current = false
      const { clientX, clientY, currentTarget } = event
      cancel()
      timer.current = window.setTimeout(() => {
        const text = currentTarget.textContent ?? ''
        const { word } = wordAt(text, offsetAt({ clientX, clientY }, currentTarget))
        if (!openWritingSheet(word)) return
        fired.current = true
      }, LONG_PRESS_MS)
    },
    onPointerUp: cancel, onPointerCancel: cancel, onPointerMove: cancel, onPointerLeave: cancel,
    onClickCapture(event: MouseEvent<HTMLElement>) { if (fired.current) { fired.current = false; event.preventDefault(); event.stopPropagation() } },
    onContextMenu(event: MouseEvent<HTMLElement>) { if (fired.current || timer.current) event.preventDefault() },
  }
}
