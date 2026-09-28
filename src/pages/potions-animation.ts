import { useCallback, useEffect, useRef } from 'react'

export function capturePotionPour(source: HTMLElement, destination: HTMLElement) {
  return {
    tile: source.cloneNode(true) as HTMLElement,
    start: source.getBoundingClientRect(),
    end: destination.getBoundingClientRect(),
    fontSize: getComputedStyle(source).fontSize,
  }
}

export function usePotionAnimation() {
  const current = useRef<(() => void) | undefined>(undefined)
  const cancel = useCallback(() => current.current?.(), [])
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel() }
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const changed = () => { if (motion?.matches) cancel() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', cancel)
    window.addEventListener('resize', cancel)
    window.addEventListener('scroll', cancel, true)
    motion?.addEventListener('change', changed)
    return () => {
      cancel()
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', cancel)
      window.removeEventListener('resize', cancel)
      window.removeEventListener('scroll', cancel, true)
      motion?.removeEventListener('change', changed)
    }
  }, [cancel])
  const pour = useCallback(async ({ tile, start, end, fontSize }: ReturnType<typeof capturePotionPour>) => {
    cancel()
    if (document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      || !tile.animate || !start.width || !end.width) return false
    tile.className = 'potions-tile potions-fly'
    tile.removeAttribute('data-potions-tile')
    tile.setAttribute('aria-hidden', 'true')
    tile.setAttribute('data-assistant-exclude', '')
    Object.assign(tile.style, {
      left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`,
      height: `${start.height}px`, fontSize,
    })
    document.body.appendChild(tile)
    const dx = end.left - start.left, dy = end.top - start.top
    const arc = Math.min(70, 30 + Math.abs(dy) * .2 + Math.abs(dx) * .05)
    let animation: Animation | undefined
    try {
      animation = tile.animate([
        { transform: 'translate(0, 0) scale(1.07)' },
        { transform: 'translate(0, -4px) scale(1.07)', offset: .25 },
        { transform: `translate(${dx * .5}px, ${Math.min(0, dy) * .5 - arc}px) scale(1.14) rotate(${dx >= 0 ? 7 : -7}deg)`, offset: .6 },
        { transform: `translate(${dx}px, ${dy}px) scale(${end.width / start.width}, ${end.height / start.height})` },
      ], { duration: 520, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' })
      return await new Promise<boolean>(resolve => {
        current.current = () => { animation?.cancel(); tile.remove(); resolve(false) }
        animation?.addEventListener('finish', () => resolve(true), { once: true })
        animation?.addEventListener('cancel', () => resolve(false), { once: true })
      })
    } finally {
      current.current = undefined
      animation?.cancel()
      tile.remove()
    }
  }, [cancel])
  return pour
}
