/// <reference types="vite/client" />

/** Build channel, defined in vite.config.ts: 'stable' on the Stable branch. */
declare const __BUILD_CHANNEL__: 'stable' | 'lab'
/** Short commit sha of the build, defined in vite.config.ts ('unknown' outside a git checkout). */
declare const __BUILD_COMMIT__: string
