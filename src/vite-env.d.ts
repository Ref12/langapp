/// <reference types="vite/client" />

/** 'stable' or 'lab': which build this bundle is (defined in vite.config.ts / vitest.config.ts). */
declare const __BUILD_CHANNEL__: 'stable' | 'lab'
/** Short commit sha this bundle was built from. */
declare const __BUILD_COMMIT__: string
