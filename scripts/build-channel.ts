import { execSync } from 'node:child_process'

export type BuildChannel = 'stable' | 'lab'

export function buildCommit(): string {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev' } catch { return 'dev' }
}

/** The compile-time constants `__BUILD_CHANNEL__` ('stable' | 'lab') and `__BUILD_COMMIT__` (short sha). */
export function buildDefines(channel: BuildChannel): Record<string, string> {
  return { __BUILD_CHANNEL__: JSON.stringify(channel), __BUILD_COMMIT__: JSON.stringify(buildCommit()) }
}
