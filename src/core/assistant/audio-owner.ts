export interface AudioLease {
  isCurrent(): boolean
  release(): void
}

interface Owner {
  interrupt(): void
}

let current: Owner | undefined

export function acquireAudio(onInterrupt: () => void): AudioLease {
  const owner: Owner = { interrupt: onInterrupt }
  const previous = current
  current = owner
  const lease: AudioLease = {
    isCurrent: () => current === owner,
    release: () => { if (current === owner) current = undefined },
  }
  try {
    previous?.interrupt()
  } catch (cause) {
    lease.release()
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Previous audio could not be interrupted. Stop audio before trying again.${detail ? ` ${detail}` : ''}`)
  }
  // A previous owner's cancellation may synchronously claim a newer lease.
  // In that case this lease is already stale, and its caller must not start.
  return lease
}

export function interruptAudio(): void {
  const lease = acquireAudio(() => {})
  if (!lease.isCurrent()) {
    throw new Error('Audio changed while it was being interrupted. Stop audio before trying again.')
  }
  lease.release()
}
