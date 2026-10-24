// Builds the static site served by hexad at /apps/lang/ (Cloudflare Worker with assets).
// Only the new app; the archived v1 is deliberately not built or published here.
import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'

const env = { ...process.env, LANGAPP_BASE: process.env.LANGAPP_BASE ?? '/apps/lang/', LANGAPP_PWA: '1', LANGAPP_OUT: process.env.LANGAPP_OUT ?? 'dist-hexad/apps/lang', VITE_LANGAPP_PWA: '1' }
await rm(new URL('../dist-hexad/', import.meta.url), { recursive: true, force: true })
for (const args of [['tsc', '-b'], ['node', '--experimental-global-webcrypto', './node_modules/vite/bin/vite.js', 'build']]) {
  const [cmd, ...rest] = args
  const result = spawnSync(cmd === 'tsc' ? 'npx' : cmd, cmd === 'tsc' ? ['tsc', ...rest] : rest, { stdio: 'inherit', env, shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
