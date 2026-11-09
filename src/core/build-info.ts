// __BUILD_CHANNEL__ and __BUILD_COMMIT__ are replaced at build time by vite.config.ts. Unit tests and tools that do not go through Vite see them undefined.
export const buildChannel: 'stable' | 'lab' = typeof __BUILD_CHANNEL__ === 'string' ? __BUILD_CHANNEL__ : 'stable'
export const buildCommit: string = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'unknown'
