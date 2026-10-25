// Change signalling for cloud backup. Kept free of imports so the database layer can use it.
// The unsent-changes flag itself lives in the backup state database (see state.ts), which a service worker can read.
let handler: (() => void) | undefined

export function setDirtyHandler(next: (() => void) | undefined): void { handler = next }

/** Called after a local write that a backup should capture. Must stay cheap: it runs inside the writer's transaction. */
export function notifyLocalChange(): void { handler?.() }
